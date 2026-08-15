import {
  allTrendSignalsAgree,
  isDebrisEntry,
  trendSignalsAgree,
} from './reentrySignals';
import type {
  ObjectTrend,
  ReentryRisk,
  TipPrediction,
  TleEntry,
} from './types';
import { DEFAULT_SOLAR_FLUX_MULTIPLIER } from '@/lib/solarFlux';
import {
  altitudeBasedReentryEstimate,
  getReentryRisk,
  parseBSTAR,
} from './satelliteHelpers';

const TIP_AGREEMENT_THRESHOLD_DAYS = 5;

function tipDaysRemaining(tip: TipPrediction, nowMs: number): number {
  return (new Date(tip.decayEpoch).getTime() - nowMs) / 86_400_000;
}

/** Attach TIP comparison fields without mutating DRAKON's own resolution. */
export function attachTipData(
  risk: ReentryRisk,
  tip: TipPrediction | undefined,
  nowMs: number = Date.now()
): ReentryRisk {
  if (!tip) return risk;

  const tipDays = tipDaysRemaining(tip, nowMs);
  const tipDeltaDays =
    risk.estimatedDaysRemaining === null
      ? null
      : Math.round((risk.estimatedDaysRemaining - tipDays) * 10) / 10;

  const tipAgreement: ReentryRisk['tipAgreement'] =
    tipDeltaDays === null
      ? null
      : Math.abs(tipDeltaDays) <= TIP_AGREEMENT_THRESHOLD_DAYS
        ? 'aligned'
        : 'diverges';

  return { ...risk, tip, tipDeltaDays, tipAgreement };
}

/** DRAKON's own estimate if it has one; otherwise TIP's, if available. Display/sort only -- never write this back onto risk.estimatedDaysRemaining. */
export function effectiveDaysRemaining(
  risk: ReentryRisk,
  nowMs: number = Date.now()
): number | null {
  if (risk.estimatedDaysRemaining !== null) return risk.estimatedDaysRemaining;
  if (!risk.tip) return null;
  return Math.round(
    (new Date(risk.tip.decayEpoch).getTime() - nowMs) / 86_400_000
  );
}

function confidenceLabel(confidence: number | null): ReentryRisk['confidence'] {
  if ((confidence ?? 0) >= 0.75) return 'high';
  if ((confidence ?? 0) >= 0.4) return 'medium';
  return 'low';
}

/** True when multi-epoch history is sufficient for trend-based screening. */
export function isActionableTrend(trend: ObjectTrend): boolean {
  return (
    trend.epochsAvailable >= 3 &&
    trend.historyDaysAvailable >= 1 &&
    trend.decaySignal !== 'insufficient_data'
  );
}

function stableReentryRisk(entry: TleEntry): ReentryRisk {
  const bstar = parseBSTAR(entry.l1);
  return {
    satId: entry.id,
    bstar,
    meanMotionDot: entry.meanMotionDot,
    signalsAgree: false,
    confidence: 'low',
    perigeeKm: entry.perigeeKm,
    decayAltKm: entry.perigeeKm,
    decayRateKmPerDay: 0,
    estimatedDaysRemaining: null,
    tier: 'stable',
    source: 'single_epoch',
  };
}

export function resolveReentryRisk(
  entry: TleEntry,
  trend: ObjectTrend | undefined,
  solarFluxMultiplier: number = DEFAULT_SOLAR_FLUX_MULTIPLIER
): ReentryRisk {
  const debris = isDebrisEntry(entry);
  const perigeeKm = entry.perigeeKm;
  const apogeeKm = entry.apogeeKm;

  const isHEO = apogeeKm > perigeeKm * 10 && apogeeKm > 2000;
  if (isHEO) return stableReentryRisk(entry);

  const altThreshold = debris ? 300 : 240;

  if (perigeeKm < altThreshold) {
    const bstar = parseBSTAR(entry.l1);
    const nDot = entry.meanMotionDot;
    const isRaisingOrbit = nDot < -1e-6;
    const isBstarNegative = bstar < 0;

    if (isRaisingOrbit || (isBstarNegative && nDot < 0)) {
      return stableReentryRisk(entry);
    }

    // Check trend data for maneuvering signal
    if (!debris && trend) {
      if (
        trend.decaySignal === 'maneuvering' ||
        (trend.decaySignal === 'stable' && trend.epochsAvailable >= 5)
      ) {
        return stableReentryRisk(entry);
      }
    }

    const eccentricityFactor =
      apogeeKm > perigeeKm * 3 && apogeeKm > 500 ? perigeeKm / apogeeKm : 1.0;

    const altEstimate = altitudeBasedReentryEstimate(
      perigeeKm,
      solarFluxMultiplier
    );
    const adjustedDays = Math.max(
      1,
      Math.ceil((altEstimate.estimatedDaysRemaining / eccentricityFactor) * 0.8)
    );

    const adjustedTier: ReentryRisk['tier'] =
      adjustedDays > 3650
        ? 'stable'
        : adjustedDays < 5
          ? 'critical'
          : adjustedDays < 14
            ? 'warning'
            : adjustedDays < 90
              ? 'nominal'
              : 'stable';

    if (adjustedTier === 'stable') return stableReentryRisk(entry);

    const altRisk: ReentryRisk = {
      satId: entry.id,
      bstar,
      meanMotionDot: entry.meanMotionDot,
      signalsAgree: true,
      confidence: perigeeKm < 220 ? 'high' : 'medium',
      perigeeKm,
      decayAltKm: perigeeKm,
      decayRateKmPerDay: altEstimate.decayRateKmPerDay,
      estimatedDaysRemaining: adjustedDays,
      tier: adjustedTier,
      source: 'single_epoch',
      decaySignal: 'decaying',
    };

    // if trend is actionable, pick the more pessimistic estimate
    if (
      trend &&
      isActionableTrend(trend) &&
      trend.estimatedDaysRemaining !== null
    ) {
      const trendRisk = objectTrendToReentryRisk(trend, entry, debris);
      if (
        trendRisk.tier !== 'stable' &&
        trendRisk.estimatedDaysRemaining !== null &&
        trendRisk.estimatedDaysRemaining < adjustedDays
      ) {
        return trendRisk;
      }
    }

    // Altitude-based is more pessimistic (or no actionable trend)
    if (
      !debris ||
      altEstimate.tier === 'critical' ||
      altEstimate.tier === 'warning'
    ) {
      return altRisk;
    }
  }

  // Standard multi-epoch path for perigee >= threshold
  if (trend && isActionableTrend(trend)) {
    if (!debris) {
      if (trend.decaySignal !== 'decaying' || !allTrendSignalsAgree(trend)) {
        return stableReentryRisk(entry);
      }
    }
    return objectTrendToReentryRisk(trend, entry, debris);
  }

  if (debris) {
    return getReentryRisk(entry, undefined, solarFluxMultiplier);
  }

  return stableReentryRisk(entry);
}

export function objectTrendToReentryRisk(
  trend: ObjectTrend,
  entry: TleEntry,
  debris = isDebrisEntry(entry)
): ReentryRisk {
  const tier = trend.reentryTier;
  const decayConfidence = trend.decayConfidence ?? 0;
  const decayRateKmPerDay = Math.max(
    trend.perigeeSlope14d && trend.perigeeSlope14d < 0
      ? Math.abs(trend.perigeeSlope14d)
      : 0,
    trend.smaSlope14d && trend.smaSlope14d < 0 ? Math.abs(trend.smaSlope14d) : 0
  );

  return {
    satId: trend.noradId,
    bstar: trend.bstarLatest ?? 0,
    meanMotionDot: trend.meanMotionDotLatest ?? entry.meanMotionDot,
    signalsAgree: debris
      ? trendSignalsAgree(trend)
      : allTrendSignalsAgree(trend),
    confidence: confidenceLabel(decayConfidence),
    perigeeKm: trend.perigeeLatest ?? entry.perigeeKm,
    decayAltKm: trend.smaLatest
      ? Math.max(0, trend.smaLatest - 6378.137)
      : entry.perigeeKm,
    decayRateKmPerDay,
    estimatedDaysRemaining: trend.estimatedDaysRemaining,
    tier,
    source: 'multi_epoch',
    decaySignal: trend.decaySignal,
    decayConfidence: trend.decayConfidence,
    maneuverLikelihood: trend.maneuverLikelihood,
    epochsAvailable: trend.epochsAvailable,
    historyDaysAvailable: trend.historyDaysAvailable,
    estimatedReentryAt: trend.estimatedReentryAt,
  };
}

export function buildReentryRiskMap(
  entries: TleEntry[],
  objectTrendsById: Map<number, ObjectTrend> | undefined,
  solarFluxMultiplier: number = DEFAULT_SOLAR_FLUX_MULTIPLIER,
  tipByNoradId?: Map<number, TipPrediction>
): Map<number, ReentryRisk> {
  const map = new Map<number, ReentryRisk>();
  for (const entry of entries) {
    let risk = resolveReentryRisk(
      entry,
      objectTrendsById?.get(entry.id),
      solarFluxMultiplier
    );
    const tip = tipByNoradId?.get(entry.id);
    risk = attachTipData(risk, tip);
    if (risk.tier !== 'stable' || tip) map.set(entry.id, risk);
  }
  return map;
}
