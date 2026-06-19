import {
  allTrendSignalsAgree,
  isDebrisEntry,
  trendSignalsAgree,
} from './reentrySignals';
import type { ObjectTrend, ReentryRisk, TleEntry } from './types';
import { DEFAULT_SOLAR_FLUX_MULTIPLIER } from '@/lib/solarFlux';
import {
  altitudeBasedReentryEstimate,
  getReentryRisk,
  parseBSTAR,
} from './satelliteHelpers';

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

  // Gate 1: HEO objects.
  const isHEO = apogeeKm > perigeeKm * 10 && apogeeKm > 2000;
  if (isHEO) {
    return stableReentryRisk(entry);
  }

  // Gate 2: Altitude override.
  const altThreshold = debris ? 300 : 230;

  if (perigeeKm < altThreshold) {
    const bstar = parseBSTAR(entry.l1);
    const nDot = entry.meanMotionDot;

    const isRaisingOrbit = nDot < -1e-6;
    const isBstarNegative = bstar < 0;

    // Orbital energy direction check
    if (isRaisingOrbit || (isBstarNegative && nDot < 0)) {
      return stableReentryRisk(entry);
    }

    // For non-debris: consult trend data if available
    if (!debris && trend) {
      if (
        trend.decaySignal === 'maneuvering' ||
        (trend.decaySignal === 'stable' && trend.epochsAvailable >= 5)
      ) {
        return stableReentryRisk(entry);
      }
    }

    // Mild eccentricity correction (for objects that are somewhat elliptical but not true HEO
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

    if (adjustedTier === 'stable') {
      return stableReentryRisk(entry);
    }

    if (
      !debris ||
      altEstimate.tier === 'critical' ||
      altEstimate.tier === 'warning'
    ) {
      return {
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
    }
  }

  // Multi-epoch trend path
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
