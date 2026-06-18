import {
  allTrendSignalsAgree,
  isDebrisEntry,
  trendSignalsAgree,
} from './reentrySignals';
import type { ObjectTrend, ReentryRisk, TleEntry } from './types';
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
  trend: ObjectTrend | undefined
): ReentryRisk {
  const debris = isDebrisEntry(entry);
  const perigeeKm = entry.perigeeKm;

  // Altitude emergency gate: below 240km, compute from altitude directly.
  // at this altitude drag overwhelms maneuver authority for most platforms.
  // Debris below 300km also benefits from the altitude estimate as a sanity check.
  const altThreshold = debris ? 300 : 235;

  // Altitude emergency override: below 200km.
  // At this altitude drag dominates even for maneuvering satellites.
  if (perigeeKm < altThreshold) {
    const bstar = parseBSTAR(entry.l1);
    const nDot = entry.meanMotionDot;
    const altEstimate = altitudeBasedReentryEstimate(perigeeKm);

    const isRaisingOrbit = nDot < -1e-6;
    const isBstarNegative = bstar < 0;

    // If orbit is raising or BSTAR is negative, assume stable
    if (isRaisingOrbit || (isBstarNegative && nDot < 0)) {
      return stableReentryRisk(entry);
    }
    // If apogee >> perigee, scale the decay estimate down proportionally.
    const apogeeKm = entry.apogeeKm;
    const eccentricityFactor =
      perigeeKm < 300 && apogeeKm > perigeeKm * 3
        ? perigeeKm / apogeeKm // fraction of orbit near low altitude
        : 1.0;

    const adjustedDays = Math.max(
      1,
      Math.ceil((altEstimate.estimatedDaysRemaining / eccentricityFactor) * 0.8)
    );

    // For debris in this band, take the more pessimistic of BSTAR vs altitude estimate
    // For active payloads, altitude estimate is the primary signal
    if (
      !debris ||
      altEstimate.tier === 'critical' ||
      altEstimate.tier === 'warning'
    ) {
      return {
        satId: entry.id,
        bstar,
        meanMotionDot: entry.meanMotionDot,
        signalsAgree: true, // altitude agreement is physical, not statistical
        confidence: perigeeKm < 180 ? 'high' : 'medium',
        perigeeKm,
        decayAltKm: perigeeKm,
        decayRateKmPerDay: altEstimate.decayRateKmPerDay,
        estimatedDaysRemaining: adjustedDays,
        tier: altEstimate.tier,
        source: 'single_epoch',
        decaySignal: 'decaying',
      };
    }
  }

  if (trend && isActionableTrend(trend)) {
    // Active payloads: multi-epoch only when BSTAR + N-dot + altitude all agree.
    if (!debris) {
      if (trend.decaySignal !== 'decaying' || !allTrendSignalsAgree(trend)) {
        return stableReentryRisk(entry);
      }
    }
    return objectTrendToReentryRisk(trend, entry, debris);
  }

  if (debris) {
    return getReentryRisk(entry);
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
