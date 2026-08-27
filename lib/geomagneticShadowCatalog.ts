/**
 * Shared catalog-input loader for Stage 2 shadow evaluation. Assembles
 * the same inputs the live app uses — current TLE snapshot, current-
 * version object trends, current solar multiplier, current TIP
 * predictions — so both the scheduled run route and the replay route
 * evaluate against the same real catalog state without duplicating this
 * assembly logic. Read-only; writes nothing.
 */

import { and, eq, ne } from 'drizzle-orm';
import { db } from './db';
import { objectTrends } from './db/schema';
import { CURRENT_TREND_VERSION } from './jobs/computeObjectTrends';
import redis from './redis';
import { CACHE_KEY, STALE_CACHE_KEY, normalizeNewlines } from './tleCache';
import { parseTleText } from './tle';
import { getSolarFlux } from './solarFlux';
import { getTipPredictions } from './tip/tipStore';
import type { ObjectTrend, TipPrediction, TleEntry } from './types';

export type ShadowCatalogInputs = {
  entries: TleEntry[];
  objectTrendsById: Map<number, ObjectTrend>;
  solarFluxMultiplier: number;
  tipByNoradId: Map<number, TipPrediction>;
};

/** Returns null when no TLE data (live or stale) is available yet. */
export async function loadCurrentCatalogForShadow(): Promise<ShadowCatalogInputs | null> {
  const [tleRaw, staleTleRaw, trendRows, { multiplier: solarFluxMultiplier }, tip] =
    await Promise.all([
      redis.get<string>(CACHE_KEY),
      redis.get<string>(STALE_CACHE_KEY),
      db
        .select()
        .from(objectTrends)
        .where(
          and(
            eq(objectTrends.trendVersion, CURRENT_TREND_VERSION),
            ne(objectTrends.decaySignal, 'insufficient_data')
          )
        ),
      getSolarFlux(),
      getTipPredictions(),
    ]);

  const tleText = tleRaw ?? staleTleRaw;
  if (!tleText || !tleText.trim()) return null;

  const entries = parseTleText(normalizeNewlines(tleText));

  const objectTrendsById = new Map<number, ObjectTrend>(
    trendRows.map((row) => [
      row.noradId,
      {
        ...row,
        updatedAt: row.updatedAt.toISOString(),
        estimatedReentryAt: row.estimatedReentryAt?.toISOString() ?? null,
      } as ObjectTrend,
    ])
  );

  return {
    entries,
    objectTrendsById,
    solarFluxMultiplier,
    tipByNoradId: tip.byNoradId,
  };
}
