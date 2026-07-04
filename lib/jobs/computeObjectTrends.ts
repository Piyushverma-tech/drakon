import { db } from '@/lib/db';
import {
  objectTrends,
  tleArchive,
  tleHistory,
  trendJobs,
  trendSnapshots,
} from '@/lib/db/schema';
import {
  explainReentryTrend,
  type RegressionResult,
} from '@/lib/explainReentryTrend';
import { classifyObjectType } from '@/lib/tle';
import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm';

type TrendValues = typeof objectTrends.$inferInsert;

const MS_PER_DAY = 86_400_000;
const MIN_EPOCHS_FOR_TREND = 3;
// const MIN_HISTORY_DAYS_FOR_TREND = 1;
const MAX_RETRIES = 3;
const MIN_HISTORY_DAYS_PAYLOAD = 7;
const MIN_HISTORY_DAYS_DEBRIS = 1;

// Bump this when the regression algorithm or confidence formula changes.
export const CURRENT_TREND_VERSION = 4;

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

function weightedRegression(
  rows: { x: number; y: number; weight: number }[]
): RegressionResult {
  const n = rows.length;
  if (n < MIN_EPOCHS_FOR_TREND) return null;

  const totalWeight = rows.reduce((sum, r) => sum + r.weight, 0);
  if (totalWeight === 0) return null;

  const meanX = rows.reduce((sum, r) => sum + r.x * r.weight, 0) / totalWeight;
  const meanY = rows.reduce((sum, r) => sum + r.y * r.weight, 0) / totalWeight;

  let ssXX = 0,
    ssXY = 0,
    ssTot = 0;
  for (const r of rows) {
    ssXX += r.weight * (r.x - meanX) ** 2;
    ssXY += r.weight * (r.x - meanX) * (r.y - meanY);
    ssTot += r.weight * (r.y - meanY) ** 2;
  }

  if (ssXX === 0) return null;

  const slope = ssXY / ssXX;
  let ssRes = 0;
  for (const r of rows) {
    const predicted = meanY + slope * (r.x - meanX);
    ssRes += r.weight * (r.y - predicted) ** 2;
  }

  const rSquared = ssTot === 0 ? 0 : Math.max(0, 1 - ssRes / ssTot);
  const variance =
    rows.reduce((sum, r) => sum + r.weight * (r.y - meanY) ** 2, 0) /
    totalWeight;
  const stddev = Math.sqrt(variance);

  return { slope, rSquared, mean: meanY, stddev, n };
}

// function slopeOverWindow(
//   rows: { epochMs: number; value: number }[],
//   windowDays: number,
//   nowMs: number
// ): RegressionResult {
//   const cutoff = nowMs - windowDays * MS_PER_DAY;
//   return regression(
//     rows
//       .filter((row) => row.epochMs >= cutoff)
//       .map((row) => ({ x: (row.epochMs - cutoff) / MS_PER_DAY, y: row.value }))
//   );
// }

function slopeOverWindowWeighted(
  rows: { epochMs: number; value: number }[],
  windowDays: number,
  nowMs: number,
  halfLifeDays = 2 // recent epochs weighted ~4x more than week-old ones
): RegressionResult {
  const cutoff = nowMs - windowDays * MS_PER_DAY;
  const windowRows = rows.filter((r) => r.epochMs >= cutoff);
  if (!windowRows.length) return null;

  const halfLifeMs = halfLifeDays * MS_PER_DAY;
  return weightedRegression(
    windowRows.map((r) => ({
      x: (r.epochMs - cutoff) / MS_PER_DAY,
      y: r.value,
      // Exponential decay weighting: most recent epoch has weight 1,
      // an epoch halfLifeDays ago has weight 0.5
      weight: Math.exp((r.epochMs - nowMs) / halfLifeMs),
    }))
  );
}

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
    smaSlope7d: values.smaSlope7d,
    smaSlope14d: values.smaSlope14d,
    meanMotionDotLatest: values.meanMotionDotLatest,
    meanMotionDotMean14d: values.meanMotionDotMean14d,
    decaySignal: values.decaySignal,
    maneuverLikelihood: values.maneuverLikelihood,
    decayConfidence: values.decayConfidence,
    bstarSignalStrength: values.bstarSignalStrength,
    ndotSignalStrength: values.ndotSignalStrength,
    altitudeSignalStrength: values.altitudeSignalStrength,
    consensusRequired: values.consensusRequired,
    consensusMet: values.consensusMet,
    estimatedDaysRemaining: values.estimatedDaysRemaining,
    estimatedReentryAt: values.estimatedReentryAt,
    reentryTier: values.reentryTier,
    objectType: values.objectType,
    isDebris: values.isDebris,
  };
}

async function upsertTrend(values: TrendValues): Promise<void> {
  const [previous] = await db
    .select({
      reentryTier: objectTrends.reentryTier,
      decaySignal: objectTrends.decaySignal,
    })
    .from(objectTrends)
    .where(eq(objectTrends.noradId, values.noradId));

  await db
    .insert(objectTrends)
    .values(values)
    .onConflictDoUpdate({
      target: objectTrends.noradId,
      set: buildTrendSet(values),
    });

  const outcomeChanged =
    !previous ||
    previous.reentryTier !== values.reentryTier ||
    previous.decaySignal !== values.decaySignal;

  if (outcomeChanged) {
    await db.insert(trendSnapshots).values({
      noradId: values.noradId,
      reentryTier: values.reentryTier ?? 'stable',
      decaySignal: values.decaySignal ?? 'insufficient_data',
      decayConfidence: values.decayConfidence ?? null,
      estimatedDaysRemaining: values.estimatedDaysRemaining ?? null,
    });
  }
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
    .orderBy(asc(tleArchive.noradId), desc(tleArchive.epoch));

  // Keep only the latest name per noradId
  const nameByNoradId = new Map<number, string>();
  for (const row of archiveRows) {
    if (!nameByNoradId.has(row.noradId))
      nameByNoradId.set(row.noradId, row.name);
  }

  const CONCURRENCY = 10;

  for (let i = 0; i < claimed.rows.length; i += CONCURRENCY) {
    const slice = claimed.rows.slice(i, i + CONCURRENCY);

    const results = await Promise.allSettled(
      slice.map(async (job) => {
        const objectName = nameByNoradId.get(job.norad_id) ?? '';
        await recomputeTrends(job.norad_id, objectName);
        return job.id;
      })
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        doneIds.push(result.value);
      } else {
        const job = slice[results.indexOf(result)];
        failedJobs.push({
          id: job.id,
          error:
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason),
        });
      }
    }
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

  const minHistoryDays = isDebris
    ? MIN_HISTORY_DAYS_DEBRIS
    : MIN_HISTORY_DAYS_PAYLOAD;

  if (
    rows.length < MIN_EPOCHS_FOR_TREND ||
    historyDaysAvailable < minHistoryDays ||
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
      bstarSignalStrength: null,
      ndotSignalStrength: null,
      altitudeSignalStrength: null,
      consensusRequired: 'none',
      consensusMet: false,
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

  // Detect terminal decay: latest perigee below 250km
  const isTerminal = (latest?.perigeeKm ?? 999) < 250;
  const halfLife = isTerminal ? 1 : 3; // 1-day half-life for terminal, 3-day otherwise

  const bstar7d = slopeOverWindowWeighted(toSeries('bstar'), 7, now, halfLife);
  const bstar14d = slopeOverWindowWeighted(
    toSeries('bstar'),
    14,
    now,
    halfLife
  );
  const bstar30d = slopeOverWindowWeighted(
    toSeries('bstar'),
    30,
    now,
    halfLife
  );
  const perigee7d = slopeOverWindowWeighted(
    toSeries('perigeeKm'),
    7,
    now,
    halfLife
  );
  const perigee14d = slopeOverWindowWeighted(
    toSeries('perigeeKm'),
    14,
    now,
    halfLife
  );
  const perigee30d = slopeOverWindowWeighted(
    toSeries('perigeeKm'),
    30,
    now,
    halfLife
  );
  const apogee14d = slopeOverWindowWeighted(
    toSeries('apogeeKm'),
    14,
    now,
    halfLife
  );
  const sma14d = slopeOverWindowWeighted(
    toSeries('semiMajorAxisKm'),
    14,
    now,
    halfLife
  );
  const sma7d = slopeOverWindowWeighted(
    toSeries('semiMajorAxisKm'),
    7,
    now,
    halfLife
  );
  const ndot14d = slopeOverWindowWeighted(
    toSeries('meanMotionDot'),
    14,
    now,
    halfLife
  );

  const ndotWindow = rows.filter((row) => row.epochMs >= now - 14 * MS_PER_DAY);
  const ndotMean14d = ndotWindow.length
    ? ndotWindow.reduce((sum, row) => sum + row.meanMotionDot, 0) /
      ndotWindow.length
    : null;

  const explanation = explainReentryTrend({
    bstarReg: bstar14d,
    ndotReg: ndot14d,
    perigeeReg: perigee14d,
    perigeeReg7d: perigee7d,
    smaReg: sma14d,
    smaReg7d: sma7d,
    ndotLatest: latest.meanMotionDot,
    ndotMean14d,
    decayAltKm,
    objectType,
    perigeeLatest: latest.perigeeKm,
    nowMs: now,
  });
  const bstarSignal = explanation.signals.find(
    (signal) => signal.name === 'bstar'
  );
  const ndotSignal = explanation.signals.find(
    (signal) => signal.name === 'ndot'
  );
  const altitudeSignal = explanation.signals.find(
    (signal) => signal.name === 'altitude'
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
    smaSlope7d: sma7d?.slope ?? null,
    smaSlope14d: sma14d?.slope ?? null,
    meanMotionDotLatest: latest.meanMotionDot,
    meanMotionDotMean14d: ndotMean14d,
    decaySignal: explanation.signal,
    maneuverLikelihood: explanation.maneuverLikelihood,
    decayConfidence: explanation.decayConfidence,
    bstarSignalStrength: bstarSignal?.strength ?? null,
    ndotSignalStrength: ndotSignal?.strength ?? null,
    altitudeSignalStrength: altitudeSignal?.strength ?? null,
    consensusRequired: explanation.consensus.required,
    consensusMet: explanation.consensus.met,
    estimatedDaysRemaining: explanation.reentry.estimatedDaysRemaining,
    estimatedReentryAt: explanation.reentry.estimatedReentryAt,
    reentryTier: explanation.reentry.reentryTier,
    objectType,
    isDebris,
  });
}
