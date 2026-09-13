/**
 * Stratified sampling for Python compute shadow evaluation (plan §17
 * Phase 6, live shadow rollout). Golden fixtures prove the port is
 * correct against hand-picked cases; they can't prove anything about how
 * the model behaves across the real, messy distribution of catalog data
 * (rare object classes, odd TLEs, missing trend fields, boundary
 * altitudes, real BSTAR distributions, real maneuvering candidates). A
 * pure random sample would eventually cover that, but a stratified one
 * covers the branches that actually matter (tier, decay signal) far
 * faster and doesn't risk under-sampling a rare-but-important stratum
 * (e.g. 'critical' tier objects, which should be a tiny fraction of any
 * healthy catalog) purely by chance.
 *
 * Deliberately capped and never a full-catalog sweep: every sampled
 * object costs one HTTP call to the compute engine, and this runs inside
 * a cron job with a bounded execution budget shared with everything else
 * the job does -- see docs/PYTHON_COMPUTE_SHADOW_ROLLOUT.md.
 */
import type { ObjectTrend, TleEntry } from './types';

export type ShadowSampleCandidate = {
  noradId: number;
  entry: TleEntry;
  /** Undefined when the catalog has no current-version trend row for this
   * object (new object, stale trend version, or insufficient_data) --
   * still sampled, under its own 'no_trend' stratum, since the
   * single-epoch fallback path is itself worth exercising. */
  trend: ObjectTrend | undefined;
};

export type ShadowSampleOptions = {
  /** Fraction of each stratum to target, e.g. 0.15 for 15%. Each non-empty
   * stratum gets at least 1 regardless of this rate (subject to the cap). */
  sampleRate: number;
  /** Hard cap on total sampled objects across all strata, regardless of
   * catalog size or sampleRate. */
  maxSampleSize: number;
  /** Injectable for deterministic tests. Defaults to Math.random. */
  random?: () => number;
};

function stratumKey(trend: ObjectTrend | undefined): string {
  return trend ? `${trend.reentryTier}:${trend.decaySignal}` : 'no_trend';
}

function shuffled<T>(items: T[], random: () => number): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Groups candidates by (reentryTier, decaySignal) [or 'no_trend'],
 * targets max(1, round(stratumSize * sampleRate)) from each non-empty
 * stratum, then scales down (by repeatedly trimming the currently-largest
 * target) if the sum exceeds maxSampleSize. When maxSampleSize is smaller
 * than the number of non-empty strata, some strata are dropped entirely
 * rather than sampled fractionally -- an edge case that shouldn't occur
 * in practice (the cap is expected to comfortably exceed the number of
 * (tier, signal) combinations a real catalog produces).
 */
export function selectStratifiedShadowSample(
  candidates: ShadowSampleCandidate[],
  options: ShadowSampleOptions
): ShadowSampleCandidate[] {
  const { sampleRate, maxSampleSize, random = Math.random } = options;
  if (candidates.length === 0 || maxSampleSize <= 0 || sampleRate <= 0) return [];

  const strata = new Map<string, ShadowSampleCandidate[]>();
  for (const candidate of candidates) {
    const key = stratumKey(candidate.trend);
    const list = strata.get(key);
    if (list) list.push(candidate);
    else strata.set(key, [candidate]);
  }

  const shuffledStrata = new Map<string, ShadowSampleCandidate[]>();
  for (const [key, list] of strata) {
    shuffledStrata.set(key, shuffled(list, random));
  }

  const keys = [...shuffledStrata.keys()];
  const targets = new Map<string, number>();
  for (const key of keys) {
    const size = shuffledStrata.get(key)!.length;
    targets.set(key, Math.min(size, Math.max(1, Math.round(size * sampleRate))));
  }

  let total = [...targets.values()].reduce((sum, v) => sum + v, 0);

  while (total > maxSampleSize) {
    let largestKey: string | null = null;
    let largestVal = 0;
    for (const key of keys) {
      const val = targets.get(key)!;
      if (val > largestVal) {
        largestVal = val;
        largestKey = key;
      }
    }
    if (largestKey === null || largestVal === 0) break;
    targets.set(largestKey, largestVal - 1);
    total -= 1;
  }

  const result: ShadowSampleCandidate[] = [];
  for (const key of keys) {
    const take = targets.get(key)!;
    if (take <= 0) continue;
    result.push(...shuffledStrata.get(key)!.slice(0, take));
  }
  return result;
}
