import { db } from '@/lib/db';
import {
  objectTrends,
  tleArchive,
  tleHistory,
  trendJobs,
} from '@/lib/db/schema';
import { assignReentryTier, ndotIndicatesDecay } from '@/lib/satelliteHelpers';
import { allSignalsAgreeFromSlopes } from '@/lib/reentrySignals';
import { classifyObjectType } from '@/lib/tle';
import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm';

type DecaySignal = 'decaying' | 'stable' | 'maneuvering' | 'insufficient_data';
type ReentryTier = 'critical' | 'warning' | 'nominal' | 'stable';
type ObjectType = 'debris' | 'rocket_body' | 'payload' | 'unknown';

type RegressionResult = {
  slope: number;
  rSquared: number;
  mean: number;
  stddev: number;
  n: number;
} | null;

type TrendValues = typeof objectTrends.$inferInsert;

const MS_PER_DAY = 86_400_000;
const MIN_EPOCHS_FOR_TREND = 3;
const MIN_HISTORY_DAYS_FOR_TREND = 1;
const MAX_RETRIES = 3;
const REENTRY_ALTITUDE_KM = 120;

// Bump this when the regression algorithm or confidence formula changes.
export const CURRENT_TREND_VERSION = 3;

export function regression(rows: { x: number; y: number }[]): RegressionResult {
  const n = rows.length;
  if (n < MIN_EPOCHS_FOR_TREND) return null;

  const meanX = rows.reduce((sum, row) => sum + row.x, 0) / n;
  const meanY = rows.reduce((sum, row) => sum + row.y, 0) / n;

  let ssXX = 0;
  let ssXY = 0;
  let ssTot = 0;
  for (const row of rows) {
    ssXX += (row.x - meanX) ** 2;
    ssXY += (row.x - meanX) * (row.y - meanY);
    ssTot += (row.y - meanY) ** 2;
  }

  if (ssXX === 0) return null;

  const slope = ssXY / ssXX;
  let ssRes = 0;
  for (const row of rows) {
    const predicted = meanY + slope * (row.x - meanX);
    ssRes += (row.y - predicted) ** 2;
  }

  const rSquared = ssTot === 0 ? 0 : Math.max(0, 1 - ssRes / ssTot);
  const stddev = Math.sqrt(
    rows.reduce((sum, row) => sum + (row.y - meanY) ** 2, 0) / n
  );

  return { slope, rSquared, mean: meanY, stddev, n };
}

function slopeOverWindow(
  rows: { epochMs: number; value: number }[],
  windowDays: number,
  nowMs: number
): RegressionResult {
  const cutoff = nowMs - windowDays * MS_PER_DAY;
  return regression(
    rows
      .filter((row) => row.epochMs >= cutoff)
      .map((row) => ({ x: (row.epochMs - cutoff) / MS_PER_DAY, y: row.value }))
  );
}

function bstarSignalStrength(bstarReg: RegressionResult): number {
  if (!bstarReg || bstarReg.slope <= 0) return 0;
  return Math.min(1, bstarReg.rSquared * Math.min(1, bstarReg.slope / 1e-7));
}

function ndotSignalStrength(
  ndotReg: RegressionResult,
  ndotLatest: number | null,
  decayAltKm: number
): number {
  const fromTrend =
    ndotReg && ndotReg.slope > 0
      ? Math.min(1, ndotReg.rSquared * Math.min(1, ndotReg.slope / 1e-5))
      : 0;
  const fromInstant =
    ndotLatest !== null && ndotIndicatesDecay(ndotLatest, decayAltKm)
      ? 0.65
      : 0;
  return Math.max(fromTrend, fromInstant);
}

function altitudeSignalStrength(
  perigeeReg: RegressionResult,
  smaReg: RegressionResult
): number {
  const regs = [perigeeReg, smaReg].filter(
    (reg): reg is NonNullable<RegressionResult> =>
      Boolean(reg && reg.slope < -0.01)
  );
  if (!regs.length) return 0;

  return Math.max(
    ...regs.map(
      (reg) =>
        Math.min(1, Math.abs(reg.slope) / 0.5) * Math.max(reg.rSquared, 0.35)
    )
  );
}

function computeManeuverLikelihood(
  bstarReg: RegressionResult,
  altitudeSignal: number
): number {
  if (!bstarReg || Math.abs(bstarReg.mean) <= 0) return 0;
  const cv = bstarReg.stddev / Math.abs(bstarReg.mean);
  if (cv > 1.5 && altitudeSignal < 0.15) {
    return Math.min(1, cv / 3);
  }
  return 0;
}

export function classifyDecaySignal(
  bstarReg: RegressionResult,
  ndotReg: RegressionResult,
  perigeeReg: RegressionResult,
  smaReg: RegressionResult,
  ndotLatest: number | null,
  decayAltKm: number
): {
  signal: DecaySignal;
  maneuverLikelihood: number;
  decayConfidence: number;
} {
  const bstarSig = bstarSignalStrength(bstarReg);
  const ndotSig = ndotSignalStrength(ndotReg, ndotLatest, decayAltKm);
  const altSig = altitudeSignalStrength(perigeeReg, smaReg);
  const maneuverLikelihood = computeManeuverLikelihood(bstarReg, altSig);

  const rawConfidence = 0.35 * bstarSig + 0.25 * ndotSig + 0.4 * altSig;
  const decayConfidence = Math.max(
    0,
    Math.min(1, rawConfidence * (1 - maneuverLikelihood * 0.75))
  );

  if (maneuverLikelihood > 0.5) {
    return {
      signal: 'maneuvering',
      maneuverLikelihood,
      decayConfidence: decayConfidence * 0.2,
    };
  }

  const decaying =
    decayConfidence >= 0.35 &&
    (altSig >= 0.2 || (bstarSig >= 0.3 && ndotSig >= 0.3));

  if (decaying) {
    return { signal: 'decaying', maneuverLikelihood: 0, decayConfidence };
  }

  if (decayConfidence < 0.15 && (bstarReg?.n ?? 0) >= 5) {
    return {
      signal: 'stable',
      maneuverLikelihood: 0,
      decayConfidence: Math.max(decayConfidence, 0.8),
    };
  }

  return {
    signal: 'insufficient_data',
    maneuverLikelihood,
    decayConfidence,
  };
}

function estimateReentry(
  signal: DecaySignal,
  decayConfidence: number,
  objectType: ObjectType,
  perigeeLatest: number | null,
  decayAltKm: number,
  perigeeReg: RegressionResult,
  smaReg: RegressionResult,
  bstarReg: RegressionResult,
  ndotReg: RegressionResult,
  ndotLatest: number | null,
  ndotMean14d: number | null,
  nowMs: number
) {
  const payloadNeedsConsensus =
    objectType === 'payload' || objectType === 'unknown';
  const allAgree = allSignalsAgreeFromSlopes({
    bstarSlope14d: bstarReg?.slope ?? null,
    ndotSlope14d: ndotReg?.slope ?? null,
    ndotLatest,
    ndotMean14d,
    perigeeSlope14d: perigeeReg?.slope ?? null,
    smaSlope14d: smaReg?.slope ?? null,
    decayAltKm,
  });

  if (
    signal === 'maneuvering' ||
    signal === 'insufficient_data' ||
    (signal !== 'decaying' && decayConfidence < 0.35) ||
    (payloadNeedsConsensus && !allAgree) ||
    perigeeLatest === null ||
    perigeeLatest <= REENTRY_ALTITUDE_KM
  ) {
    return {
      estimatedDaysRemaining: null,
      estimatedReentryAt: null,
      reentryTier: 'stable' as ReentryTier,
    };
  }

  const decayRateKmPerDay = Math.max(
    perigeeReg?.slope && perigeeReg.slope < 0 ? Math.abs(perigeeReg.slope) : 0,
    smaReg?.slope && smaReg.slope < 0 ? Math.abs(smaReg.slope) : 0
  );

  if (decayRateKmPerDay < 0.001) {
    return {
      estimatedDaysRemaining: null,
      estimatedReentryAt: null,
      reentryTier: 'stable' as ReentryTier,
    };
  }

  const estimatedDaysRemaining = Math.max(
    1,
    Math.ceil(
      ((perigeeLatest - REENTRY_ALTITUDE_KM) / decayRateKmPerDay) * (2 / 3)
    )
  );
  const estimatedReentryAt = new Date(
    nowMs + estimatedDaysRemaining * MS_PER_DAY
  );

  return {
    estimatedDaysRemaining,
    estimatedReentryAt,
    reentryTier: assignReentryTier(estimatedDaysRemaining, decayAltKm),
  };
}

// async function getLatestObjectType(noradId: number): Promise<ObjectType> {
//   const [latestArchive] = await db
//     .select({ name: tleArchive.name })
//     .from(tleArchive)
//     .where(eq(tleArchive.noradId, noradId))
//     .orderBy(desc(tleArchive.epoch))
//     .limit(1);

//   return latestArchive ? classifyObjectType(latestArchive.name) : 'unknown';
// }

function buildTrendSet(values: TrendValues) {
  return {
    updatedAt: values.updatedAt,
    trendVersion: values.trendVersion,
    epochsAvailable: values.epochsAvailable,
    historyDaysAvailable: values.historyDaysAvailable,
    bstarLatest: values.bstarLatest,
    bstarSlope7d: values.bstarSlope7d,
    bstarSlope14d: values.bstarSlope14d,
    bstarSlope30d: values.bstarSlope30d,
    bstarMean14d: values.bstarMean14d,
    bstarStddev14d: values.bstarStddev14d,
    bstarRsq14d: values.bstarRsq14d,
    perigeeLatest: values.perigeeLatest,
    perigeeSlope7d: values.perigeeSlope7d,
    perigeeSlope14d: values.perigeeSlope14d,
    perigeeSlope30d: values.perigeeSlope30d,
    apogeeLatest: values.apogeeLatest,
    apogeeSlope14d: values.apogeeSlope14d,
    smaLatest: values.smaLatest,
    smaSlope14d: values.smaSlope14d,
    meanMotionDotLatest: values.meanMotionDotLatest,
    meanMotionDotMean14d: values.meanMotionDotMean14d,
    decaySignal: values.decaySignal,
    maneuverLikelihood: values.maneuverLikelihood,
    decayConfidence: values.decayConfidence,
    estimatedDaysRemaining: values.estimatedDaysRemaining,
    estimatedReentryAt: values.estimatedReentryAt,
    reentryTier: values.reentryTier,
    objectType: values.objectType,
    isDebris: values.isDebris,
  };
}

async function upsertTrend(values: TrendValues): Promise<void> {
  await db
    .insert(objectTrends)
    .values(values)
    .onConflictDoUpdate({
      target: objectTrends.noradId,
      set: buildTrendSet(values),
    });
}

export async function processTrendJobs(batchSize = 100): Promise<number> {
  const claimed = await db.execute<{ norad_id: number; id: number }>(sql`
    WITH claimed AS (
      SELECT id
      FROM trend_jobs
      WHERE status = 'pending'
      ORDER BY created_at
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE trend_jobs
    SET status = 'processing',
        error_message = NULL
    WHERE id IN (SELECT id FROM claimed)
    RETURNING id, norad_id
  `);

  if (!claimed.rows.length) return 0;

  const doneIds: number[] = [];
  const failedJobs: { id: number; error: string }[] = [];

  const noradIds = claimed.rows.map((job) => job.norad_id);

  // One query for all names
  const archiveRows = await db
    .select({ noradId: tleArchive.noradId, name: tleArchive.name })
    .from(tleArchive)
    .where(inArray(tleArchive.noradId, noradIds))
    .orderBy(desc(tleArchive.epoch));

  // Keep only the latest name per noradId
  const nameByNoradId = new Map<number, string>();
  for (const row of archiveRows) {
    if (!nameByNoradId.has(row.noradId))
      nameByNoradId.set(row.noradId, row.name);
  }

  for (const job of claimed.rows) {
    const objectName = nameByNoradId.get(job.norad_id) ?? '';
    await recomputeTrends(job.norad_id, objectName);
  }

  if (doneIds.length > 0) {
    await db.delete(trendJobs).where(inArray(trendJobs.id, doneIds));
  }

  for (const { id, error } of failedJobs) {
    await db.execute(sql`
      UPDATE trend_jobs
      SET retry_count = retry_count + 1,
          status = CASE
            WHEN retry_count + 1 >= ${MAX_RETRIES} THEN 'failed'
            ELSE 'pending'
          END,
          error_message = ${error}
      WHERE id = ${id}
    `);
  }

  return claimed.rows.length;
}

async function recomputeTrends(
  noradId: number,
  objectName: string
): Promise<void> {
  const now = Date.now();
  const cutoff30d = new Date(now - 30 * MS_PER_DAY);

  const rows = await db
    .select({
      epochMs: sql<number>`extract(epoch from ${tleHistory.epoch}) * 1000`,
      bstar: tleHistory.bstar,
      meanMotion: tleHistory.meanMotion,
      meanMotionDot: tleHistory.meanMotionDot,
      perigeeKm: tleHistory.perigeeKm,
      apogeeKm: tleHistory.apogeeKm,
      semiMajorAxisKm: tleHistory.semiMajorAxisKm,
    })
    .from(tleHistory)
    .where(
      and(eq(tleHistory.noradId, noradId), gte(tleHistory.epoch, cutoff30d))
    )
    .orderBy(asc(tleHistory.epoch));

  const latest = rows.at(-1) ?? null;
  const historyDaysAvailable = latest
    ? (latest.epochMs - rows[0].epochMs) / MS_PER_DAY
    : 0;
  const objectType = classifyObjectType(objectName);
  const isDebris = objectType === 'debris' || objectType === 'rocket_body';
  const decayAltKm = latest
    ? Math.max(0, latest.semiMajorAxisKm - 6378.137)
    : 0;

  if (
    rows.length < MIN_EPOCHS_FOR_TREND ||
    historyDaysAvailable < MIN_HISTORY_DAYS_FOR_TREND ||
    !latest
  ) {
    await upsertTrend({
      noradId,
      updatedAt: new Date(),
      trendVersion: CURRENT_TREND_VERSION,
      epochsAvailable: rows.length,
      historyDaysAvailable,
      bstarLatest: latest?.bstar ?? null,
      perigeeLatest: latest?.perigeeKm ?? null,
      apogeeLatest: latest?.apogeeKm ?? null,
      smaLatest: latest?.semiMajorAxisKm ?? null,
      meanMotionDotLatest: latest?.meanMotionDot ?? null,
      decaySignal: 'insufficient_data',
      maneuverLikelihood: 0,
      decayConfidence: 0,
      estimatedDaysRemaining: null,
      estimatedReentryAt: null,
      reentryTier: 'stable',
      objectType,
      isDebris,
    });
    return;
  }

  const toSeries = (value: keyof typeof latest) =>
    rows.map((row) => ({
      epochMs: row.epochMs,
      value: row[value] as number,
    }));

  const bstar7d = slopeOverWindow(toSeries('bstar'), 7, now);
  const bstar14d = slopeOverWindow(toSeries('bstar'), 14, now);
  const bstar30d = slopeOverWindow(toSeries('bstar'), 30, now);
  const perigee7d = slopeOverWindow(toSeries('perigeeKm'), 7, now);
  const perigee14d = slopeOverWindow(toSeries('perigeeKm'), 14, now);
  const perigee30d = slopeOverWindow(toSeries('perigeeKm'), 30, now);
  const apogee14d = slopeOverWindow(toSeries('apogeeKm'), 14, now);
  const sma14d = slopeOverWindow(toSeries('semiMajorAxisKm'), 14, now);
  const ndot14d = slopeOverWindow(toSeries('meanMotionDot'), 14, now);

  const ndotWindow = rows.filter((row) => row.epochMs >= now - 14 * MS_PER_DAY);
  const ndotMean14d = ndotWindow.length
    ? ndotWindow.reduce((sum, row) => sum + row.meanMotionDot, 0) /
      ndotWindow.length
    : null;

  const { signal, maneuverLikelihood, decayConfidence } = classifyDecaySignal(
    bstar14d,
    ndot14d,
    perigee14d,
    sma14d,
    latest.meanMotionDot,
    decayAltKm
  );
  const reentry = estimateReentry(
    signal,
    decayConfidence,
    objectType,
    latest.perigeeKm,
    decayAltKm,
    perigee14d,
    sma14d,
    bstar14d,
    ndot14d,
    latest.meanMotionDot,
    ndotMean14d,
    now
  );

  await upsertTrend({
    noradId,
    updatedAt: new Date(),
    trendVersion: CURRENT_TREND_VERSION,
    epochsAvailable: rows.length,
    historyDaysAvailable,
    bstarLatest: latest.bstar,
    bstarSlope7d: bstar7d?.slope ?? null,
    bstarSlope14d: bstar14d?.slope ?? null,
    bstarSlope30d: bstar30d?.slope ?? null,
    bstarMean14d: bstar14d?.mean ?? null,
    bstarStddev14d: bstar14d?.stddev ?? null,
    bstarRsq14d: bstar14d?.rSquared ?? null,
    perigeeLatest: latest.perigeeKm,
    perigeeSlope7d: perigee7d?.slope ?? null,
    perigeeSlope14d: perigee14d?.slope ?? null,
    perigeeSlope30d: perigee30d?.slope ?? null,
    apogeeLatest: latest.apogeeKm,
    apogeeSlope14d: apogee14d?.slope ?? null,
    smaLatest: latest.semiMajorAxisKm,
    smaSlope14d: sma14d?.slope ?? null,
    meanMotionDotLatest: latest.meanMotionDot,
    meanMotionDotMean14d: ndotMean14d,
    decaySignal: signal,
    maneuverLikelihood,
    decayConfidence,
    estimatedDaysRemaining: reentry.estimatedDaysRemaining,
    estimatedReentryAt: reentry.estimatedReentryAt,
    reentryTier: reentry.reentryTier,
    objectType,
    isDebris,
  });
}
