import { NextResponse } from 'next/server';
import { evaluatePythonComputeShadow } from '@/lib/pythonComputeShadow';
import { loadCurrentCatalogForShadow } from '@/lib/geomagneticShadowCatalog';
import {
  getPythonComputeShadowRunDeltas,
  listRecentPythonComputeShadowRuns,
  persistPythonComputeShadowRun,
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
 */
export const maxDuration = 60;

// Reserve for reading the catalog and persisting the run, leaving the
// remainder for the actual sampled compute-engine calls. Keeps this route
// comfortably under maxDuration rather than racing it -- matches the
// review's instruction to derive the per-call timeout from the remaining
// outer budget, not a fixed constant.
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
  const startedAt = Date.now();

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

  const catalog = await loadCurrentCatalogForShadow();
  if (!catalog) {
    return NextResponse.json(
      { error: 'No TLE data available yet' },
      { status: 503 }
    );
  }

  // Budget-aware per-call timeout: whatever's left of this route's own
  // maxDuration after accounting for the catalog load already spent and a
  // reserve for persisting the result, spread across the sample. Never
  // negative/zero-ish -- floors at a small minimum so a slow catalog load
  // doesn't leave individual calls with an unusably tiny timeout.
  const elapsedSoFarMs = Date.now() - startedAt;
  const remainingBudgetMs =
    maxDuration * 1000 - elapsedSoFarMs - PERSISTENCE_RESERVE_MS;
  const perCallTimeoutMs = Math.max(
    1000,
    Math.floor(remainingBudgetMs / Math.max(1, maxSampleSize))
  );

  const summary = await evaluatePythonComputeShadow(
    catalog.entries,
    catalog.objectTrendsById,
    catalog.solarFluxMultiplier,
    {
      sampleRate,
      maxSampleSize,
      timeoutMs: perCallTimeoutMs,
    }
  );

  const runId = await persistPythonComputeShadowRun(summary);

  return NextResponse.json({ runId, summary });
}
