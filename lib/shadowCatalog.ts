/**
 * Shared catalog-input loaders for shadow evaluation work (plan §17
 * Phase 6; plan §21 geomagnetic Stage 2). Split into composable pieces
 * deliberately: the geomagnetic shadow evaluates the WHOLE catalog
 * locally (cheap -- no network calls, both sides are TS), so it wants
 * everything. The Python compute shadow evaluates a small SAMPLE over
 * real HTTP calls (expensive per object), so it should never pay for
 * data it isn't going to use -- see loadCurrentTrendSample()'s docstring
 * for the specific optimization that motivated this split.
 *
 * Read-only; nothing here writes.
 */
import { and, eq, inArray, ne } from 'drizzle-orm';
import { db } from './db';
import { objectTrends } from './db/schema';
import { CURRENT_TREND_VERSION } from './jobs/computeObjectTrends';
import redis from './redis';
import { CACHE_KEY, STALE_CACHE_KEY, normalizeNewlines } from './tleCache';
import { parseTleText } from './tle';
import { getSolarFlux } from './solarFlux';
import { getTipPredictions } from './tip/tipStore';
import { selectStratifiedNoradIds } from './pythonComputeShadowSampling';
import type { ObjectTrend, TipPrediction, TleEntry } from './types';

/** Current TLE snapshot (Redis, live with a stale fallback) -- cheap,
 * shared by every shadow evaluator. Returns null when neither the live
 * nor stale cache has anything yet. */
export async function loadCurrentTLECatalog(): Promise<TleEntry[] | null> {
  const [tleRaw, staleTleRaw] = await Promise.all([
    redis.get<string>(CACHE_KEY),
    redis.get<string>(STALE_CACHE_KEY),
  ]);
  const tleText = tleRaw ?? staleTleRaw;
  if (!tleText || !tleText.trim()) return null;
  return parseTleText(normalizeNewlines(tleText));
}

/** Current solar-flux density multiplier (Redis-backed, see
 * lib/solarFlux.ts) -- cheap, shared. */
export async function loadSolarFlux(): Promise<number> {
  const { multiplier } = await getSolarFlux();
  return multiplier;
}

/** Current TIP (Two-Line-Element Information Prediction) snapshot,
 * keyed by NORAD id. Only the geomagnetic shadow uses this -- it's an
 * external prediction the geomagnetic work compares its own estimate
 * against. The Python compute shadow has no use for it at all and must
 * not load it. */
export async function loadTIP(): Promise<Map<number, TipPrediction>> {
  const tip = await getTipPredictions();
  return tip.byNoradId;
}

function rowToObjectTrend(
  row: typeof objectTrends.$inferSelect
): ObjectTrend {
  return {
    ...row,
    updatedAt: row.updatedAt.toISOString(),
    estimatedReentryAt: row.estimatedReentryAt?.toISOString() ?? null,
  } as ObjectTrend;
}

const CURRENT_TREND_FILTER = and(
  eq(objectTrends.trendVersion, CURRENT_TREND_VERSION),
  ne(objectTrends.decaySignal, 'insufficient_data')
);

/** Every current-version, non-insufficient-data object_trends row, in
 * full. This is the expensive query (a full-width SELECT * across the
 * whole eligible population -- tens of thousands of rows in production)
 * that only the geomagnetic shadow actually needs, since it evaluates
 * every object locally. Anything that only needs a SAMPLE should use
 * loadCurrentTrendSample() below instead of calling this and sampling
 * client-side after the fact. */
export async function loadFullCurrentTrendPopulation(): Promise<
  Map<number, ObjectTrend>
> {
  const rows = await db.select().from(objectTrends).where(CURRENT_TREND_FILTER);
  return new Map(rows.map((row) => [row.noradId, rowToObjectTrend(row)]));
}

export type TrendSampleResult = {
  trendsById: Map<number, ObjectTrend>;
  /** Size of the eligible population the sample was drawn from --
   * derived from the light query's row count, not from materializing the
   * full population. */
  eligibleCount: number;
};

/**
 * The Python-compute-shadow-specific loader: samples the eligible
 * population WITHOUT ever pulling it in full.
 *
 * Two queries instead of one, but far cheaper overall:
 *  1. A narrow query (noradId, reentryTier, decaySignal only) across the
 *     whole eligible population -- still touches every row, but at maybe
 *     a tenth the bytes of the full 36-column row, since stratification
 *     only needs these three columns to pick a sample.
 *  2. A full-width query filtered to ONLY the ~20-25 sampled noradIds
 *     (via IN (...)), so the expensive full row payload is paid for
 *     exactly the objects that get used, not the other ~23,600.
 *
 * This is a real, measured production concern, not speculative: the
 * first live shadow run pulled the full 23,627-row population to select
 * 20 objects, which is wasteful egress against a constrained Neon plan.
 * A true single-query SQL-level stratified sample (e.g. per-stratum
 * TABLESAMPLE/ORDER BY random() LIMIT n) would avoid touching all rows
 * even once, but would mean re-implementing selectStratifiedNoradIds's
 * proportional/capped/minimum-1-per-stratum logic in SQL rather than
 * reusing the already-tested TS implementation -- not worth the
 * complexity/risk trade-off for a query that's already a large
 * improvement over loading full rows for the whole population.
 */
export async function loadCurrentTrendSample(options: {
  sampleRate: number;
  maxSampleSize: number;
  random?: () => number;
}): Promise<TrendSampleResult> {
  const lightRows = await db
    .select({
      noradId: objectTrends.noradId,
      reentryTier: objectTrends.reentryTier,
      decaySignal: objectTrends.decaySignal,
    })
    .from(objectTrends)
    .where(CURRENT_TREND_FILTER);

  if (lightRows.length === 0) {
    return { trendsById: new Map(), eligibleCount: 0 };
  }

  const sampledIds = selectStratifiedNoradIds(
    lightRows.map((row) => ({
      noradId: row.noradId,
      stratumKey: `${row.reentryTier}:${row.decaySignal}`,
    })),
    {
      sampleRate: options.sampleRate,
      maxSampleSize: options.maxSampleSize,
      random: options.random,
    }
  );

  if (sampledIds.length === 0) {
    return { trendsById: new Map(), eligibleCount: lightRows.length };
  }

  const fullRows = await db
    .select()
    .from(objectTrends)
    .where(inArray(objectTrends.noradId, sampledIds));

  return {
    trendsById: new Map(fullRows.map((row) => [row.noradId, rowToObjectTrend(row)])),
    eligibleCount: lightRows.length,
  };
}
