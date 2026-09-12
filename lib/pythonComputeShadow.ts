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
  /** Candidates actually available for sampling (== catalogSize; kept
   * distinct in case future filtering narrows this before sampling). */
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

export type EvaluatePythonComputeShadowOptions = {
  sampleRate: number;
  maxSampleSize: number;
  /** Per-call timeout -- should be derived from the caller's remaining
   * execution budget, not a fixed constant. See
   * resolveReentryRiskViaComputeEngine's option docs. */
  timeoutMs?: number;
  expectedModelVersion?: string;
  concurrency?: number;
  random?: () => number;
  nowMs?: number;
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

export async function evaluatePythonComputeShadow(
  entries: TleEntry[],
  objectTrendsById: Map<number, ObjectTrend> | undefined,
  solarFluxMultiplier: number,
  options: EvaluatePythonComputeShadowOptions
): Promise<PythonComputeShadowSummary> {
  const nowMs = options.nowMs ?? Date.now();
  const expectedModelVersion = options.expectedModelVersion ?? '0.1.0';
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;

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
    catalogSize: entries.length,
    eligibleCount: candidates.length,
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
