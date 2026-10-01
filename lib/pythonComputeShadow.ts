/**
 * Python compute shadow evaluation (plan §17 Phase 6, live shadow
 * rollout). Mirrors lib/geomagneticShadow.ts's evaluateGeomagneticShadow()
 * pattern deliberately -- this repo already has one established,
 * well-isolated shadow-mode pattern (catalog loader -> evaluate -> persist
 * -> internal route on an external cron), and this is the second
 * application of it rather than a new one.
 *
 * Unlike the geomagnetic shadow (which is pure/synchronous -- both sides
 * are local TS calls), this one makes real HTTP calls to the compute
 * engine, so it is deliberately sampled (see
 * lib/pythonComputeShadowSampling.ts) rather than evaluating the whole
 * catalog every run. Concurrency is capped the same way
 * lib/jobs/computeObjectTrends.ts caps its own DB-bound work, so this
 * doesn't open more simultaneous connections to the compute engine than
 * is reasonable for a single internal service instance.
 *
 * Two entry points, split deliberately:
 *   - runShadowComparisons() takes an ALREADY-SELECTED sample and just
 *     runs + aggregates comparisons. Used by the production route, which
 *     samples via lib/shadowCatalog.ts's loadCurrentTrendSample() --
 *     pushed down to the database query itself so the full trend
 *     population is never materialized in memory (see that function's
 *     docstring for why: the first live run loaded all ~23,600 eligible
 *     objects in full just to pick 20).
 *   - evaluatePythonComputeShadow() is the older, still-supported entry
 *     point: given a FULLY LOADED catalog (e.g. in tests, or a caller
 *     that already has one for other reasons), it samples in-memory via
 *     selectStratifiedShadowSample() and then calls
 *     runShadowComparisons(). Not what the production route uses
 *     anymore, but kept because loading a full catalog and letting this
 *     function sample it is still a legitimate, simpler shape for
 *     smaller inputs.
 */
import type { ObjectTrend, ReentryRisk, TleEntry } from './types';
import {
  selectStratifiedShadowSample,
  type ShadowSampleCandidate,
} from './pythonComputeShadowSampling';
import {
  shadowCompareReentryRisk,
  type ShadowFailureType,
  type FieldDifference,
} from './shadowCompareReentryRisk';

const DEFAULT_CONCURRENCY = 5;

export type PythonComputeShadowRow = {
  noradId: number;
  requestId: string;
  durationMs: number;
  matched: boolean;
  pythonFailureType: ShadowFailureType | null;
  differenceCount: number;
  differences: FieldDifference[];
  tsTier: ReentryRisk['tier'];
  pythonTier: ReentryRisk['tier'] | null;
};

export type PythonComputeShadowSummary = {
  generatedAt: string;
  expectedModelId: string;
  expectedModelVersion: string;
  catalogSize: number;
  /** Size of the eligible population the sample was drawn from -- not
   * necessarily materialized in full (see loadCurrentTrendSample()). */
  eligibleCount: number;
  sampledCount: number;
  /** matchedCount + valueMismatchCount -- calls that got a real response. */
  successCount: number;
  matchedCount: number;
  valueMismatchCount: number;
  /** Calls that never got a usable response (network/timeout/HTTP/contract). */
  failureCount: number;
  failuresByType: Record<string, number>;
  durationMsP50: number | null;
  durationMsP95: number | null;
  durationMsP99: number | null;
  sampleRate: number;
  maxSampleSize: number;
  /** Only non-matching rows (mismatches + failures) -- mirrors
   * evaluateGeomagneticShadow's changedRows: a run where everything
   * agreed should produce zero of these, not a wall of identical
   * "matched" rows. */
  rows: PythonComputeShadowRow[];
};

export type RunShadowComparisonsOptions = {
  /** Per-call timeout -- should be derived from the caller's remaining
   * execution budget, not a fixed constant. See
   * resolveReentryRiskViaComputeEngine's option docs. */
  timeoutMs?: number;
  expectedModelVersion?: string;
  concurrency?: number;
  nowMs?: number;
  /** Reported in the summary as-is -- the caller already knows these
   * from however it loaded/sampled, so this function doesn't need (and
   * shouldn't need) the full catalog just to report their sizes. */
  catalogSize: number;
  eligibleCount: number;
  /** Reported in the summary; the sampling parameters that were actually
   * used to produce `sample`, even though this function didn't do the
   * sampling itself. */
  sampleRate: number;
  maxSampleSize: number;
};

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  for (let i = 0; i < items.length; i += concurrency) {
    const slice = items.slice(i, i + concurrency);
    const sliceResults = await Promise.all(slice.map(fn));
    for (let j = 0; j < sliceResults.length; j++) {
      results[i + j] = sliceResults[j];
    }
  }
  return results;
}

function percentile(sortedDurations: number[], p: number): number | null {
  if (sortedDurations.length === 0) return null;
  const idx = Math.min(
    sortedDurations.length - 1,
    Math.floor((p / 100) * sortedDurations.length)
  );
  return sortedDurations[idx];
}

/** Runs shadow comparisons against an already-selected sample and
 * aggregates the result. Does no sampling of its own -- see this
 * module's docstring for why that split matters. */
export async function runShadowComparisons(
  sample: ShadowSampleCandidate[],
  solarFluxMultiplier: number,
  options: RunShadowComparisonsOptions
): Promise<PythonComputeShadowSummary> {
  const nowMs = options.nowMs ?? Date.now();
  const expectedModelVersion = options.expectedModelVersion ?? '0.1.0';
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;

  const comparisons = await mapWithConcurrency(sample, concurrency, (candidate) =>
    shadowCompareReentryRisk(candidate.entry, candidate.trend, solarFluxMultiplier, {
      timeoutMs: options.timeoutMs,
      expectedModelVersion,
    })
  );

  const rows: PythonComputeShadowRow[] = [];
  const failuresByType: Record<string, number> = {};
  const durations: number[] = [];
  let matchedCount = 0;
  let valueMismatchCount = 0;
  let failureCount = 0;

  for (let i = 0; i < sample.length; i++) {
    const candidate = sample[i];
    const comparison = comparisons[i];
    durations.push(comparison.durationMs);

    if (comparison.matched) {
      matchedCount++;
      continue;
    }

    if (comparison.pythonFailureType === 'MODEL_VALUE_MISMATCH') {
      valueMismatchCount++;
    } else if (comparison.pythonFailureType) {
      failureCount++;
      failuresByType[comparison.pythonFailureType] =
        (failuresByType[comparison.pythonFailureType] ?? 0) + 1;
    }

    rows.push({
      noradId: candidate.noradId,
      requestId: comparison.requestId,
      durationMs: comparison.durationMs,
      matched: comparison.matched,
      pythonFailureType: comparison.pythonFailureType,
      differenceCount: comparison.differenceCount,
      differences: comparison.differences,
      tsTier: comparison.result.tier,
      pythonTier: comparison.pythonResult?.tier ?? null,
    });
  }

  const sortedDurations = [...durations].sort((a, b) => a - b);

  return {
    generatedAt: new Date(nowMs).toISOString(),
    expectedModelId: 'reentry_resolution',
    expectedModelVersion,
    catalogSize: options.catalogSize,
    eligibleCount: options.eligibleCount,
    sampledCount: sample.length,
    successCount: matchedCount + valueMismatchCount,
    matchedCount,
    valueMismatchCount,
    failureCount,
    failuresByType,
    durationMsP50: percentile(sortedDurations, 50),
    durationMsP95: percentile(sortedDurations, 95),
    durationMsP99: percentile(sortedDurations, 99),
    sampleRate: options.sampleRate,
    maxSampleSize: options.maxSampleSize,
    rows,
  };
}

export type EvaluatePythonComputeShadowOptions = {
  sampleRate: number;
  maxSampleSize: number;
  timeoutMs?: number;
  expectedModelVersion?: string;
  concurrency?: number;
  random?: () => number;
  nowMs?: number;
};

/** Given a FULLY LOADED catalog, samples it in-memory and runs
 * comparisons. See this module's docstring: the production route no
 * longer uses this (it samples at the database layer instead via
 * lib/shadowCatalog.ts), but this remains a legitimate entry point when
 * a full catalog is already available. */
export async function evaluatePythonComputeShadow(
  entries: TleEntry[],
  objectTrendsById: Map<number, ObjectTrend> | undefined,
  solarFluxMultiplier: number,
  options: EvaluatePythonComputeShadowOptions
): Promise<PythonComputeShadowSummary> {
  const candidates: ShadowSampleCandidate[] = entries.map((entry) => ({
    noradId: entry.id,
    entry,
    trend: objectTrendsById?.get(entry.id),
  }));

  const sample = selectStratifiedShadowSample(candidates, {
    sampleRate: options.sampleRate,
    maxSampleSize: options.maxSampleSize,
    random: options.random,
  });

  return runShadowComparisons(sample, solarFluxMultiplier, {
    timeoutMs: options.timeoutMs,
    expectedModelVersion: options.expectedModelVersion,
    concurrency: options.concurrency,
    nowMs: options.nowMs,
    catalogSize: entries.length,
    eligibleCount: candidates.length,
    sampleRate: options.sampleRate,
    maxSampleSize: options.maxSampleSize,
  });
}
