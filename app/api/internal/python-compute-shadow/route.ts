import { NextResponse } from 'next/server';
import { runShadowComparisons } from '@/lib/pythonComputeShadow';
import {
  loadCurrentTLECatalog,
  loadCurrentTrendSample,
  loadSolarFlux,
} from '@/lib/shadowCatalog';
import type { ShadowSampleCandidate } from '@/lib/pythonComputeShadowSampling';
import {
  getPythonComputeShadowRunDeltas,
  listRecentPythonComputeShadowRuns,
  persistPythonComputeShadowRun,
  recordPythonComputeShadowRunTiming,
  summarizePythonComputeShadowWindow,
} from '@/lib/pythonComputeShadowStore';

/**
 * Python compute shadow (plan §17 Phase 6, live shadow rollout). Same
 * shape as the established geomagnetic-shadow route: internal/ops-only,
 * nothing here is read by the production risk path (see
 * lib/pythonComputeShadowStore.ts's isolation note).
 *
 * GET  — read durable history: recent runs, one run's object deltas, or
 *        a rollup over a time window (for evaluating rollout exit
 *        criteria -- see docs/PYTHON_COMPUTE_SHADOW_ROLLOUT.md).
 * POST — run a LIVE, SAMPLED evaluation against the current catalog,
 *        persist it, and return the summary. Safe to call on an external
 *        schedule (this repo's existing external-cron pattern -- see
 *        README.md's Scheduling row and
 *        app/api/internal/geomagnetic-shadow/route.ts for precedent).
 *        Deliberately sampled, never the full catalog -- see
 *        lib/pythonComputeShadowSampling.ts's module docstring for why.
 *
 * Catalog loading is deliberately narrow: this route uses
 * lib/shadowCatalog.ts's loadCurrentTLECatalog + loadCurrentTrendSample +
 * loadSolarFlux -- NOT loadCurrentCatalogForShadow (which loads the full
 * trend population AND TIP data, neither of which this route needs; TIP
 * is a geomagnetic-shadow-only comparison input). The first live run
 * loaded all ~23,600 eligible trend rows in full just to sample 20 of
 * them, which is wasteful egress against a constrained Neon plan -- see
 * loadCurrentTrendSample()'s docstring for the two-phase query that
 * fixes this.
 */
export const maxDuration = 60;

// Reserve for persisting the run, leaving the remainder (after the
// catalog load, which is measured, not assumed) for the actual sampled
// compute-engine calls. Keeps this route comfortably under maxDuration
// rather than racing it.
const PERSISTENCE_RESERVE_MS = 8_000;
const DEFAULT_SAMPLE_RATE = 0.15;
const DEFAULT_MAX_SAMPLE_SIZE = 20;
const MAX_ALLOWED_SAMPLE_SIZE = 25;

function checkAuth(req: Request): boolean {
  return req.headers.get('x-internal-secret') === process.env.INTERNAL_JOB_SECRET;
}

function parseFloatParam(
  searchParams: URLSearchParams,
  name: string,
  fallback: number
): number | null {
  const raw = searchParams.get(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export async function GET(req: Request) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const runIdParam = searchParams.get('runId');

  if (runIdParam !== null) {
    const runId = Number(runIdParam);
    if (!Number.isInteger(runId)) {
      return NextResponse.json({ error: 'runId must be an integer' }, { status: 400 });
    }
    const deltas = await getPythonComputeShadowRunDeltas(runId);
    return NextResponse.json({ runId, deltas });
  }

  const sinceParam = searchParams.get('sinceDays');
  if (sinceParam !== null) {
    const days = Number(sinceParam);
    if (!Number.isFinite(days) || days <= 0) {
      return NextResponse.json({ error: 'sinceDays must be a positive number' }, { status: 400 });
    }
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const rollup = await summarizePythonComputeShadowWindow(since);
    return NextResponse.json({ sinceDays: days, since: since.toISOString(), ...rollup });
  }

  const limitParam = searchParams.get('limit');
  const limit = limitParam !== null ? Number(limitParam) : undefined;
  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
    return NextResponse.json({ error: 'limit must be a positive integer' }, { status: 400 });
  }

  const runs = await listRecentPythonComputeShadowRuns({ limit });
  return NextResponse.json({ runs });
}

export async function POST(req: Request) {
  const routeStartedAt = Date.now();

  if (!checkAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const sampleRate = parseFloatParam(searchParams, 'sampleRate', DEFAULT_SAMPLE_RATE);
  const maxSampleSizeRaw = parseFloatParam(
    searchParams,
    'maxSampleSize',
    DEFAULT_MAX_SAMPLE_SIZE
  );

  if (sampleRate === null || sampleRate <= 0 || sampleRate > 1) {
    return NextResponse.json(
      { error: 'sampleRate must be a number in (0, 1]' },
      { status: 400 }
    );
  }
  if (maxSampleSizeRaw === null || maxSampleSizeRaw <= 0) {
    return NextResponse.json(
      { error: 'maxSampleSize must be a positive number' },
      { status: 400 }
    );
  }
  const maxSampleSize = Math.min(Math.floor(maxSampleSizeRaw), MAX_ALLOWED_SAMPLE_SIZE);

  const catalogLoadStartedAt = Date.now();

  // Only what this route actually needs: the TLE snapshot (cheap,
  // Redis), an ALREADY-SAMPLED slice of the trend population (see
  // loadCurrentTrendSample's two-phase query), and the solar-flux
  // multiplier. Deliberately does NOT call loadCurrentCatalogForShadow
  // (which pulls the FULL trend population and TIP data -- neither of
  // which this route uses) or loadTIP directly.
  const [entries, trendSample, solarFluxMultiplier] = await Promise.all([
    loadCurrentTLECatalog(),
    loadCurrentTrendSample({ sampleRate, maxSampleSize }),
    loadSolarFlux(),
  ]);

  const catalogLoadMs = Date.now() - catalogLoadStartedAt;

  if (!entries) {
    return NextResponse.json(
      { error: 'No TLE data available yet' },
      { status: 503 }
    );
  }

  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
  const sample: ShadowSampleCandidate[] = [];
  for (const [noradId, trend] of trendSample.trendsById) {
    const entry = entriesById.get(noradId);
    // A sampled trend row with no matching TLE entry (object dropped
    // from the live/stale snapshot since its trend was last computed) --
    // skip rather than fabricate an entry; this shows up as a slightly
    // smaller sampledCount than requested, which is honest.
    if (entry) sample.push({ noradId, entry, trend });
  }

  // Budget-aware per-call timeout: whatever's left of this route's own
  // maxDuration after the (now-measured, not assumed) catalog load and a
  // reserve for persisting the result, spread across the sample.
  const elapsedSoFarMs = Date.now() - routeStartedAt;
  const remainingBudgetMs =
    maxDuration * 1000 - elapsedSoFarMs - PERSISTENCE_RESERVE_MS;
  const perCallTimeoutMs = Math.max(
    1000,
    Math.floor(remainingBudgetMs / Math.max(1, sample.length))
  );

  const pythonComputeStartedAt = Date.now();
  const summary = await runShadowComparisons(sample, solarFluxMultiplier, {
    timeoutMs: perCallTimeoutMs,
    catalogSize: entries.length,
    eligibleCount: trendSample.eligibleCount,
    sampleRate,
    maxSampleSize,
  });
  const pythonComputeMs = Date.now() - pythonComputeStartedAt;

  const persistenceStartedAt = Date.now();
  const runId = await persistPythonComputeShadowRun(summary, {
    catalogLoadMs,
    pythonComputeMs,
  });
  const persistenceMs = Date.now() - persistenceStartedAt;
  const totalRouteMs = Date.now() - routeStartedAt;

  // Fast, single-row follow-up write -- persistenceMs/totalRouteMs can't
  // be known until after the first insert completes, so they land in the
  // durable run record via a second, cheap update rather than only ever
  // appearing in this HTTP response. persistenceMs necessarily excludes
  // this second write's own time; not used for anything safety-critical.
  await recordPythonComputeShadowRunTiming(runId, { persistenceMs, totalRouteMs });

  return NextResponse.json({
    runId,
    summary,
    timing: { catalogLoadMs, pythonComputeMs, persistenceMs, totalRouteMs },
  });
}
