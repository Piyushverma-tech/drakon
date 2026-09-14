/**
 * Shared catalog-input loader for Stage 2 shadow evaluation. Assembles
 * the same inputs the live app uses — current TLE snapshot, ALL
 * current-version object trends, current solar multiplier, current TIP
 * predictions — so both the scheduled run route and the replay route
 * evaluate against the same real catalog state without duplicating this
 * assembly logic. Read-only; writes nothing.
 *
 * The geomagnetic shadow evaluates the WHOLE catalog (both sides are
 * local TS computation, no network calls, so this is cheap), unlike the
 * Python compute shadow which samples via lib/shadowCatalog.ts's
 * loadCurrentTrendSample() instead of loading everything -- see that
 * function's docstring for why those two cases genuinely need different
 * loading strategies. The four primitives this composes now live in
 * lib/shadowCatalog.ts, shared by both.
 */
import {
  loadCurrentTLECatalog,
  loadFullCurrentTrendPopulation,
  loadSolarFlux,
  loadTIP,
} from './shadowCatalog';
import type { ObjectTrend, TipPrediction, TleEntry } from './types';

export type ShadowCatalogInputs = {
  entries: TleEntry[];
  objectTrendsById: Map<number, ObjectTrend>;
  solarFluxMultiplier: number;
  tipByNoradId: Map<number, TipPrediction>;
};

/** Returns null when no TLE data (live or stale) is available yet. */
export async function loadCurrentCatalogForShadow(): Promise<ShadowCatalogInputs | null> {
  const [entries, objectTrendsById, solarFluxMultiplier, tipByNoradId] = await Promise.all([
    loadCurrentTLECatalog(),
    loadFullCurrentTrendPopulation(),
    loadSolarFlux(),
    loadTIP(),
  ]);

  if (!entries) return null;

  return { entries, objectTrendsById, solarFluxMultiplier, tipByNoradId };
}
