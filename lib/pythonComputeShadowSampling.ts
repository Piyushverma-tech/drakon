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
 *
 * The core algorithm (stratifiedSample) is generic over anything with a
 * stratumKey, so it serves two shapes: full in-memory candidates
 * (selectStratifiedShadowSample, used when a catalog is already loaded --
 * e.g. tests) and bare {noradId, stratumKey} pairs
 * (selectStratifiedNoradIds, used by lib/shadowCatalog.ts's
 * loadCurrentTrendSample() to pick a sample from a lightweight query
 * BEFORE paying for the full row payload of the whole eligible
 * population -- see that function's docstring for why this split
 * matters).
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

export function trendStratumKey(trend: ObjectTrend | undefined): string {
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
 * Generic stratified sample: groups items by stratumKey, targets
 * max(1, round(stratumSize * sampleRate)) from each non-empty stratum,
 * then scales down (by repeatedly trimming the currently-largest target)
 * if the sum exceeds maxSampleSize. When maxSampleSize is smaller than
 * the number of non-empty strata, some strata are dropped entirely
 * rather than sampled fractionally -- an edge case that shouldn't occur
 * in practice (the cap is expected to comfortably exceed the number of
 * (tier, signal) combinations a real catalog produces).
 */
function stratifiedSample<T extends { stratumKey: string }>(
  items: T[],
  options: ShadowSampleOptions
): T[] {
  const { sampleRate, maxSampleSize, random = Math.random } = options;
  if (items.length === 0 || maxSampleSize <= 0 || sampleRate <= 0) return [];

  const strata = new Map<string, T[]>();
  for (const item of items) {
    const list = strata.get(item.stratumKey);
    if (list) list.push(item);
    else strata.set(item.stratumKey, [item]);
  }

  const shuffledStrata = new Map<string, T[]>();
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

  const result: T[] = [];
  for (const key of keys) {
    const take = targets.get(key)!;
    if (take <= 0) continue;
    result.push(...shuffledStrata.get(key)!.slice(0, take));
  }
  return result;
}

/** Full in-memory candidates already paired with their TleEntry/ObjectTrend
 * -- use when a catalog is already fully loaded (tests, or a caller that
 * has one for other reasons). Prefer loadCurrentTrendSample() in
 * lib/shadowCatalog.ts when loading fresh from the database, since that
 * avoids materializing the full population at all. */
export function selectStratifiedShadowSample(
  candidates: ShadowSampleCandidate[],
  options: ShadowSampleOptions
): ShadowSampleCandidate[] {
  const withKeys = candidates.map((c) => ({ ...c, stratumKey: trendStratumKey(c.trend) }));
  const selected = stratifiedSample(withKeys, options);
  return selected.map((item) => ({
    noradId: item.noradId,
    entry: item.entry,
    trend: item.trend,
  }));
}

/** Bare {noradId, stratumKey} pairs -- the lightweight path used by
 * loadCurrentTrendSample() to pick a sample from a narrow query before
 * ever fetching full rows. Returns just the selected noradIds. */
export function selectStratifiedNoradIds(
  items: { noradId: number; stratumKey: string }[],
  options: ShadowSampleOptions
): number[] {
  return stratifiedSample(items, options).map((item) => item.noradId);
}
