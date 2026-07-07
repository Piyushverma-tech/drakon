import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { objectTrends } from '@/lib/db/schema';
import { CURRENT_TREND_VERSION } from '@/lib/jobs/computeObjectTrends';
import {
  SIGNAL_WEIGHTS,
  SIGNAL_AGREE_THRESHOLDS,
  type SignalContribution,
} from '@/lib/explainReentryTrend';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ noradId: string }> }
) {
  const { noradId: noradIdParam } = await params;
  const noradId = Number(noradIdParam);

  if (!Number.isInteger(noradId) || noradId <= 0) {
    return NextResponse.json(
      { error: 'noradId must be a positive integer' },
      { status: 400 }
    );
  }

  const [trend] = await db
    .select()
    .from(objectTrends)
    .where(eq(objectTrends.noradId, noradId));

  if (!trend) {
    return NextResponse.json(
      { error: `No trend data for object ${noradId}` },
      { status: 404 }
    );
  }

  const strengths = {
    bstar: trend.bstarSignalStrength,
    ndot: trend.ndotSignalStrength,
    altitude: trend.altitudeSignalStrength,
  };
  const signalsPersisted =
    strengths.bstar !== null &&
    strengths.ndot !== null &&
    strengths.altitude !== null;

  const signals: SignalContribution[] = signalsPersisted
    ? (['bstar', 'ndot', 'altitude'] as const).map((name) => {
        const strength = strengths[name] as number;
        const weight = SIGNAL_WEIGHTS[name];
        return {
          name,
          strength,
          weight,
          contribution: strength * weight,
          agrees: strength >= SIGNAL_AGREE_THRESHOLDS[name],
        };
      })
    : [];

  return NextResponse.json({
    noradId,
    updatedAt: trend.updatedAt.toISOString(),
    trendVersion: trend.trendVersion,
    // False if a schema/model upgrade has run since this row was last
    // recomputed — the cron will refresh it on its next pass.
    isCurrentModelVersion: trend.trendVersion === CURRENT_TREND_VERSION,
    signalsPersisted,
    signal: trend.decaySignal,
    decayConfidence: trend.decayConfidence,
    maneuverLikelihood: trend.maneuverLikelihood,
    signals,
    consensus: {
      required: trend.consensusRequired,
      met: trend.consensusMet,
    },
    reentry: {
      estimatedDaysRemaining: trend.estimatedDaysRemaining,
      estimatedReentryAt: trend.estimatedReentryAt?.toISOString() ?? null,
      reentryTier: trend.reentryTier,
    },
    dataQuality: {
      epochsAvailable: trend.epochsAvailable,
      historyDaysAvailable: trend.historyDaysAvailable,
      perigeeLatest: trend.perigeeLatest,
      apogeeLatest: trend.apogeeLatest,
    },
  });
}
