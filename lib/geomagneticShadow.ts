/**
 * Stage 2 shadow-mode comparison (GEOMAGNETIC_STORM_REENTRY_PLAN.md §21).
 *
 * Computes what the re-entry screen WOULD show under the combined
 * solar+geomagnetic multiplier and diffs it against the real solar-only
 * production result. Nothing in here writes to Redis, Postgres, or any
 * persisted state, and nothing in the live dashboard/globe path calls
 * into this module — it exists purely to "calculate and record" per the
 * plan's Stage 2 definition, not to change what production serves.
 *
 * This is the one module allowed to know about both the geomagnetic
 * environmental signal (lib/geomagneticIndex.ts) and ReentryRisk
 * resolution (lib/objectTrendRisk.ts) — each of those stays scoped to its
 * own concern (plan §7: geomagneticIndex.ts "must not own ReentryRisk
 * resolution").
 *
 * Reuses resolveReentryRisk() / buildReentryRiskMap() completely
 * unmodified for both sides of the comparison. The only difference
 * between the "solar-only" and "corrected" runs is which multiplier is
 * passed in — so this cannot drift from production's actual formulas
 * (plan §12's centralization requirement), and it costs nothing to keep
 * in sync: any future change to the risk formulas is picked up
 * automatically on both sides.
 */

import type { ObjectTrend, ReentryRisk, TipPrediction, TleEntry } from './types';
import { buildReentryRiskMap } from './objectTrendRisk';
import {
  combineAtmosphericMultipliers,
  type GeomagneticState,
} from './geomagneticIndex';

export type GeomagneticShadowRow = {
  satId: number;
  solarOnlyDays: number | null;
  solarOnlyTier: ReentryRisk['tier'];
  correctedDays: number | null;
  correctedTier: ReentryRisk['tier'];
  /** correctedDays - solarOnlyDays. Null if either side has no estimate. */
  daysDelta: number | null;
  tierChanged: boolean;
  solarOnlyTipAgreement: ReentryRisk['tipAgreement'];
  correctedTipAgreement: ReentryRisk['tipAgreement'];
};

export type GeomagneticShadowSummary = {
  generatedAt: string;
  /** When the underlying Kp/ap reading was actually taken — distinct from
   *  generatedAt during a stale/default freshness state. */
  observedAt: GeomagneticState['observedAt'];
  kpClass: GeomagneticState['kpClass'];
  estimatedAp: GeomagneticState['estimatedAp'];
  activity: GeomagneticState['activity'];
  freshness: GeomagneticState['freshness'];
  modelVersion: GeomagneticState['modelVersion'];
  solarFluxMultiplier: number;
  geomagneticMultiplier: number;
  combinedMultiplier: number;
  /** Objects with a DRAKON estimate or TIP prediction under either multiplier. */
  objectsEvaluated: number;
  objectsWithTierChange: number;
  /** Only objects where the tier or the estimate actually differs — quiet
   *  conditions (geomagneticMultiplier === 1.0) should produce an empty
   *  array (plan §19 point 7, "quiet neutrality"). */
  changedRows: GeomagneticShadowRow[];
};

export function evaluateGeomagneticShadow(
  entries: TleEntry[],
  objectTrendsById: Map<number, ObjectTrend> | undefined,
  solarFluxMultiplier: number,
  geomagneticState: GeomagneticState,
  tipByNoradId?: Map<number, TipPrediction>,
  nowMs: number = Date.now()
): GeomagneticShadowSummary {
  const combinedMultiplier = combineAtmosphericMultipliers(
    solarFluxMultiplier,
    geomagneticState.multiplier
  );

  // This IS the production call — same function, same arguments the app
  // already uses. Never substitute a re-derived or simplified version.
  const solarOnlyMap = buildReentryRiskMap(
    entries,
    objectTrendsById,
    solarFluxMultiplier,
    tipByNoradId
  );

  // Shadow-only: identical call, only the multiplier differs.
  const correctedMap = buildReentryRiskMap(
    entries,
    objectTrendsById,
    combinedMultiplier,
    tipByNoradId
  );

  const allIds = new Set([...solarOnlyMap.keys(), ...correctedMap.keys()]);
  const changedRows: GeomagneticShadowRow[] = [];

  for (const satId of allIds) {
    const solarOnly = solarOnlyMap.get(satId);
    const corrected = correctedMap.get(satId);

    const solarOnlyTier = solarOnly?.tier ?? 'stable';
    const correctedTier = corrected?.tier ?? 'stable';
    const tierChanged = solarOnlyTier !== correctedTier;

    const solarOnlyDays = solarOnly?.estimatedDaysRemaining ?? null;
    const correctedDays = corrected?.estimatedDaysRemaining ?? null;
    const daysDelta =
      solarOnlyDays !== null && correctedDays !== null
        ? correctedDays - solarOnlyDays
        : null;

    if (!tierChanged && (daysDelta === null || daysDelta === 0)) continue;

    changedRows.push({
      satId,
      solarOnlyDays,
      solarOnlyTier,
      correctedDays,
      correctedTier,
      daysDelta,
      tierChanged,
      solarOnlyTipAgreement: solarOnly?.tipAgreement ?? null,
      correctedTipAgreement: corrected?.tipAgreement ?? null,
    });
  }

  return {
    generatedAt: new Date(nowMs).toISOString(),
    observedAt: geomagneticState.observedAt,
    kpClass: geomagneticState.kpClass,
    estimatedAp: geomagneticState.estimatedAp,
    activity: geomagneticState.activity,
    freshness: geomagneticState.freshness,
    modelVersion: geomagneticState.modelVersion,
    solarFluxMultiplier,
    geomagneticMultiplier: geomagneticState.multiplier,
    combinedMultiplier,
    objectsEvaluated: allIds.size,
    objectsWithTierChange: changedRows.filter((row) => row.tierChanged).length,
    changedRows,
  };
}
