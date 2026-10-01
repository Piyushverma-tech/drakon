import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { objectTrends } from '@/lib/db/schema';
import { CURRENT_TREND_VERSION } from '@/lib/jobs/computeObjectTrends';
import { and, eq, ne } from 'drizzle-orm';
import redis from '@/lib/redis';
import type { ObjectTrendDashboardRow } from '@/lib/types';

/** Columns the dashboard's three consumers (the screening list and globe
 * via buildReentryRiskMap, and the object-detail page directly plus its
 * Decision Trace) actually read -- verified by exhaustive grep, not
 * assumed, 2026-09-25. A strict superset of shadowCatalog.ts's
 * RISK_INPUT_COLUMNS: same risk-resolution fields, plus trendVersion,
 * updatedAt, consensusRequired, consensusMet, and objectType, which only
 * the dashboard reads directly (see ObjectTrendDashboardRow in
 * lib/types.ts for exactly which consumer needs each one). Previously a
 * full 36-column SELECT * across the whole eligible population, with no
 * caching, on every dashboard load. */
const DASHBOARD_ROW_COLUMNS = {
  noradId: objectTrends.noradId,
  trendVersion: objectTrends.trendVersion,
  updatedAt: objectTrends.updatedAt,
  epochsAvailable: objectTrends.epochsAvailable,
  historyDaysAvailable: objectTrends.historyDaysAvailable,
  bstarLatest: objectTrends.bstarLatest,
  bstarSlope14d: objectTrends.bstarSlope14d,
  perigeeLatest: objectTrends.perigeeLatest,
  perigeeSlope14d: objectTrends.perigeeSlope14d,
  smaLatest: objectTrends.smaLatest,
  smaSlope14d: objectTrends.smaSlope14d,
  meanMotionDotLatest: objectTrends.meanMotionDotLatest,
  meanMotionDotMean14d: objectTrends.meanMotionDotMean14d,
  decaySignal: objectTrends.decaySignal,
  maneuverLikelihood: objectTrends.maneuverLikelihood,
  decayConfidence: objectTrends.decayConfidence,
  consensusRequired: objectTrends.consensusRequired,
  consensusMet: objectTrends.consensusMet,
  estimatedDaysRemaining: objectTrends.estimatedDaysRemaining,
  estimatedReentryAt: objectTrends.estimatedReentryAt,
  reentryTier: objectTrends.reentryTier,
  objectType: objectTrends.objectType,
  bstarSignalStrength: objectTrends.bstarSignalStrength,
  ndotSignalStrength: objectTrends.ndotSignalStrength,
  altitudeSignalStrength: objectTrends.altitudeSignalStrength,
} as const;

type CachedResponse = {
  trendVersion: number;
  trends: ObjectTrendDashboardRow[];
};

/** The trend job (lib/jobs/computeObjectTrends.ts) recomputes rows on a
 * ~15-min cadence, so anything shorter than that is re-serving data that
 * hasn't changed. Kept safely under that cadence rather than matching it
 * exactly, so a slow trend-job run can't extend the staleness window. */
const CACHE_TTL_SECONDS = 600;

function cacheKey(trendVersion: number): string {
  return `object-trends:v${trendVersion}`;
}

/** Read-only: trend jobs are drained by cron / internal POST, not this route. */
export async function GET() {
  const key = cacheKey(CURRENT_TREND_VERSION);

  const cached = await redis.get<CachedResponse>(key).catch(() => null);
  if (cached) {
    return NextResponse.json(cached);
  }

  const rows = await db
    .select(DASHBOARD_ROW_COLUMNS)
    .from(objectTrends)
    .where(
      and(
        eq(objectTrends.trendVersion, CURRENT_TREND_VERSION),
        ne(objectTrends.decaySignal, 'insufficient_data')
      )
    );

  const body: CachedResponse = {
    trendVersion: CURRENT_TREND_VERSION,
    trends: rows.map((row) => ({
      ...row,
      updatedAt: row.updatedAt.toISOString(),
      estimatedReentryAt: row.estimatedReentryAt?.toISOString() ?? null,
    })) as ObjectTrendDashboardRow[],
  };

  await redis.set(key, body, { ex: CACHE_TTL_SECONDS }).catch(() => {
    // Cache write failing shouldn't fail the request -- worst case, the
    // next load pays for another DB query.
  });

  return NextResponse.json(body);
}
