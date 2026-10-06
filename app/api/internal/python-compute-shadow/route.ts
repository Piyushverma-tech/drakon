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
import { evaluateGeomagneticShadow } from '@/lib/geomagneticShadow';
import { loadCurrentCatalogForShadow } from '@/lib/geomagneticShadowCatalog';
import { persistGeomagneticShadowRun } from '@/lib/geomagneticShadowStore';
import { getGeomagneticState } from '@/lib/geomagneticIndex';
import { acquireShadowRunLock } from '@/lib/shadowRunLock';
import {
  GEOMAGNETIC_SHADOW_LOCK_KEY,
  GEOMAGNETIC_SHADOW_LOCK_TTL_SECONDS,
  MERGED_SHADOW_RUN_LOCK_KEY,
  MERGED_SHADOW_RUN_LOCK_TTL_SECONDS,
} from '@/lib/shadowRunLockKeys';

/**
 * Python compute shadow (plan §17 Phase 6, live shadow rollout) --
 * AND, as of the Oct 2026 CPU investigation, geomagnetic shadow
 * evaluation too (see areas/drakon-compute-engine.md). Both crons ran
 * hourly as separate invocations, each independently fetching and
 * reparsing the same ~23,600-object TLE catalog -- two cold starts and
 * two redundant Redis fetches for identical data, every hour. This
 * route now does both jobs in one invocation, fetching the catalog once
 * and reusing it for both evaluations. The standalone
 * app/api/internal/geomagnetic-shadow/route.ts route still exists for
 * manual triggering and its /replay endpoint, but its external cron
 * trigger is removed -- see its POST docstring for the lock-based
 * safety net if that doesn't happen immediately.
 *
 * Internal/ops-only throughout: nothing here is read by the production
 * risk path (see lib/pythonComputeShadowStore.ts's isolation note).
 *
 * GET  — read durable history: recent runs, one run's object deltas, or
 *        a rollup over a time window (for evaluating rollout exit
 *        criteria -- see docs/PYTHON_COMPUTE_SHADOW_ROLLOUT.md). Python
 *        shadow data only; geomagnetic shadow history is still read via
 *        the standalone route's own GET.
 * POST — runs the geomagnetic evaluation (full catalog, local
 *        computation, no network calls per-object) using the shared
 *        catalog load, THEN the python-compute-shadow SAMPLED evaluation
 *        (network calls to the compute engine per sampled object) using
 *        the same already-fetched TLE entries. Sequential, not
 *        parallel, deliberately: both evaluation functions are verified
 *        read-only with respect to the shared `entries`/trend data (no
 *        in-place mutation anywhere in either call chain -- geomagnetic
 *        clones before any array reordering, python-shadow's sampler
 *        does too), so there's no correctness reason they couldn't run
 *        concurrently, but running them sequentially keeps the existing
 *        budget-aware per-call-timeout math below exactly as simple as
 *        it was before this merge: it already computes "remaining time
 *        after elapsed so far", which correctly absorbs geomagnetic's
 *        share of the budget without needing to know about it
 *        specially. A failure in the geomagnetic step is caught and
 *        logged, never allowed to block the python-shadow evaluation
 *        that follows it.
 *
 *        Guarded by two Redis locks (lib/shadowRunLock.ts) against
 *        duplicate/overlapping triggers -- a scheduler retry, or (until
 *        the standalone route's external trigger is actually removed) a
 *        stray second trigger of geomagnetic evaluation specifically:
 *        MERGED_SHADOW_RUN_LOCK_KEY covers the whole invocation,
 *        GEOMAGNETIC_SHADOW_LOCK_KEY covers just the geomagnetic piece
 *        and is shared with the standalone route's POST. Safe to call on
 *        an external schedule (this repo's existing external-cron
 *        pattern -- see README.md's Scheduling row).
 *
 * Catalog loading: entries + solarFluxMultiplier are fetched ONCE here
 * (loadCurrentTLECatalog + loadSolarFlux) and passed into
 * loadCurrentCatalogForShadow's new `preloaded` param for the
 * geomagnetic step, instead of it fetching its own copy -- see that
 * function's docstring. Geomagnetic's OWN additional inputs (the full
 * trend population, TIP data, geomagnetic state) are NOT shareable with
 * python-shadow's narrow lib/shadowCatalog.ts loaders (different query
 * shapes for a different purpose -- see loadCurrentTrendSample()'s
 * docstring) and are fetched fresh here as new cost this invocation
 * didn't carry before the merge.
 *
 * Per-stage timing, changed by this merge: `catalogLoadMs` now covers
 * only the shared TLE+solarFlux fetch (previously it also covered
 * python-shadow's own light trend-sample query, bundled into the same
 * Promise.all -- that query now runs as its own step after the
 * geomagnetic evaluation, timed separately and logged but not
 * persisted, same pattern as loadCurrentTLECatalog's redisFetchMs/
 * parseMs split). `pythonComputeMs`/`persistenceMs` are unchanged in
 * meaning (python-shadow's own compute-engine calls and its own
 * persistence write). `totalRouteMs` now covers the WHOLE invocation
 * including geomagnetic's fetch+evaluation+persistence, not just
 * python-shadow's share -- expect it to read noticeably higher than
 * historical pre-merge values when comparing; that's the merge working
 * as intended (one longer invocation instead of two shorter ones), not
 * a regression. Geomagnetic's own step duration is logged
 * (`[python-compute-shadow] geomagneticMs=...`) but has no persisted
 * column of its own, consistent with not adding schema churn for a
 * number that's mainly useful for sanity-checking this merge rather
 * than ongoing monitoring.
 */
export const maxDuration = 90;

// Was 60s for python-shadow alone (30s for geomagnetic alone, now
// folded in here). Real worst-case total for both evaluations combined
// is nowhere near this -- geomagnetic's own evaluation is synchronous,
// in-memory, no network calls, so it's fast; the TLE catalog fetch this
// route already measures (lib/shadowCatalog.ts's redisFetchMs/parseMs
// logging) tops out around 3.5s observed; python-shadow's own compute
// phase averages under 2s. 90s leaves generous multiples of margin over
// that, while staying well under Hobby's Fluid Compute maxDuration
// ceiling -- confirmed via Vercel's docs: 300s is both the default AND
// the hard maximum on Hobby, "a wall you cannot move." No plan upgrade
// needed for this change.
const PERSISTENCE_RESERVE_MS = 8_000;
const DEFAULT_SAMPLE_RATE = 0.15;
const DEFAULT_MAX_SAMPLE_SIZE = 20;
const MAX_ALLOWED_SAMPLE_SIZE = 25;

function checkAuth(req: Request): boolean {
  return (
    req.headers.get('x-internal-secret') === process.env.INTERNAL_JOB_SECRET
  );
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
      return NextResponse.json(
        { error: 'runId must be an integer' },
        { status: 400 }
      );
    }
    const deltas = await getPythonComputeShadowRunDeltas(runId);
    return NextResponse.json({ runId, deltas });
  }

  const sinceParam = searchParams.get('sinceDays');
  if (sinceParam !== null) {
    const days = Number(sinceParam);
    if (!Number.isFinite(days) || days <= 0) {
      return NextResponse.json(
        { error: 'sinceDays must be a positive number' },
        { status: 400 }
      );
    }
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const rollup = await summarizePythonComputeShadowWindow(since);
    return NextResponse.json({
      sinceDays: days,
      since: since.toISOString(),
      ...rollup,
    });
  }

  const limitParam = searchParams.get('limit');
  const limit = limitParam !== null ? Number(limitParam) : undefined;
  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
    return NextResponse.json(
      { error: 'limit must be a positive integer' },
      { status: 400 }
    );
  }

  const runs = await listRecentPythonComputeShadowRuns({ limit });
  return NextResponse.json({ runs });
}

export async function POST(req: Request) {
  const routeStartedAt = Date.now();

  if (!checkAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Guards the whole merged invocation against a scheduler retry (or a
  // manual double-trigger) causing two concurrent full runs -- see
  // lib/shadowRunLock.ts. A skip here is a 200, not an error: cron-job.org
  // sees a successful response either way, so a retry-on-timeout
  // scenario can't cascade into its own repeated retries.
  const mergedLockAcquired = await acquireShadowRunLock(
    MERGED_SHADOW_RUN_LOCK_KEY,
    MERGED_SHADOW_RUN_LOCK_TTL_SECONDS
  );
  if (!mergedLockAcquired) {
    return NextResponse.json({
      skipped: true,
      reason:
        'Another run of this route already completed or is in progress this window.',
    });
  }

  const { searchParams } = new URL(req.url);
  const sampleRate = parseFloatParam(
    searchParams,
    'sampleRate',
    DEFAULT_SAMPLE_RATE
  );
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
  const maxSampleSize = Math.min(
    Math.floor(maxSampleSizeRaw),
    MAX_ALLOWED_SAMPLE_SIZE
  );

  const catalogLoadStartedAt = Date.now();

  // Shared by both evaluations below -- fetched ONCE here instead of
  // once per route, per the Oct 2026 merge (see this route's
  // docstring). Deliberately still does NOT fetch the full trend
  // population or TIP here; those are geomagnetic-specific and fetched
  // fresh in that step, since python-shadow's own sampling needs the
  // narrow lib/shadowCatalog.ts loaders instead (see
  // loadCurrentTrendSample's docstring).
  const [entries, solarFluxMultiplier] = await Promise.all([
    loadCurrentTLECatalog(),
    loadSolarFlux(),
  ]);

  const catalogLoadMs = Date.now() - catalogLoadStartedAt;

  if (!entries) {
    return NextResponse.json(
      { error: 'No TLE data available yet' },
      { status: 503 }
    );
  }

  // --- Geomagnetic shadow evaluation (folded into this invocation as of
  // the Oct 2026 merge) -------------------------------------------------
  const geomagneticStartedAt = Date.now();
  let geomagnetic: {
    ran: boolean;
    runId: number | null;
    skippedReason?: string;
  } = {
    ran: false,
    runId: null,
  };
  const geomagneticLockAcquired = await acquireShadowRunLock(
    GEOMAGNETIC_SHADOW_LOCK_KEY,
    GEOMAGNETIC_SHADOW_LOCK_TTL_SECONDS
  );
  if (!geomagneticLockAcquired) {
    geomagnetic.skippedReason =
      'Another geomagnetic shadow run already completed or is in progress this window.';
  } else {
    try {
      const [catalog, geomagneticState] = await Promise.all([
        loadCurrentCatalogForShadow({ entries, solarFluxMultiplier }),
        getGeomagneticState(),
      ]);
      // catalog is only null when entries is null (see
      // loadCurrentCatalogForShadow's docstring), which this route
      // already ruled out above -- this check is here purely so
      // TypeScript knows catalog is non-null below, not because it's
      // expected to actually trigger.
      if (catalog) {
        const summary = evaluateGeomagneticShadow(
          catalog.entries,
          catalog.objectTrendsById,
          catalog.solarFluxMultiplier,
          geomagneticState,
          catalog.tipByNoradId
        );
        const runId = await persistGeomagneticShadowRun(summary, 'scheduled');
        geomagnetic = { ran: true, runId };
      }
    } catch (err) {
      // Never let a geomagnetic-side failure block the python-shadow
      // evaluation that follows -- log it and move on.
      console.error(
        '[python-compute-shadow] geomagnetic evaluation failed:',
        err
      );
      geomagnetic.skippedReason =
        'Geomagnetic evaluation threw; see server logs.';
    }
  }
  const geomagneticMs = Date.now() - geomagneticStartedAt;
  console.log(
    `[python-compute-shadow] geomagneticMs=${geomagneticMs} ran=${geomagnetic.ran} runId=${geomagnetic.runId ?? 'null'}`
  );
  // --- End geomagnetic shadow evaluation --------------------------------

  const trendSampleStartedAt = Date.now();
  const trendSample = await loadCurrentTrendSample({
    sampleRate,
    maxSampleSize,
  });
  const trendSampleMs = Date.now() - trendSampleStartedAt;
  console.log(`[python-compute-shadow] trendSampleMs=${trendSampleMs}`);

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
  await recordPythonComputeShadowRunTiming(runId, {
    persistenceMs,
    totalRouteMs,
  });

  return NextResponse.json({
    runId,
    summary,
    // catalogLoadMs/pythonComputeMs/persistenceMs/totalRouteMs are
    // persisted on this run's row (see this route's docstring for how
    // their meaning shifted with this merge). geomagneticMs/
    // trendSampleMs are logged but not persisted -- diagnostic-only, see
    // the docstring.
    timing: {
      catalogLoadMs,
      pythonComputeMs,
      persistenceMs,
      totalRouteMs,
      geomagneticMs,
      trendSampleMs,
    },
    geomagneticShadow: geomagnetic,
  });
}
