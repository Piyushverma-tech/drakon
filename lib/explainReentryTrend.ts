import {
  applyConfidenceCeiling,
  assignReentryTier,
  ndotIndicatesDecay,
} from './satelliteHelpers';
import { allSignalsAgreeFromSlopes } from './reentrySignals';

export type DecaySignal =
  | 'decaying'
  | 'stable'
  | 'maneuvering'
  | 'insufficient_data';
export type ReentryTier = 'critical' | 'warning' | 'nominal' | 'stable';
export type ObjectType = 'debris' | 'rocket_body' | 'payload' | 'unknown';

export type RegressionResult = {
  slope: number;
  rSquared: number;
  mean: number;
  stddev: number;
  n: number;
} | null;

export interface SignalContribution {
  name: 'bstar' | 'ndot' | 'altitude';
  strength: number;
  weight: number;
  contribution: number;
  agrees: boolean;
}

export interface ReentryExplanation {
  signal: DecaySignal;
  decayConfidence: number;
  maneuverLikelihood: number;
  signals: SignalContribution[];
  consensus: { required: 'full' | 'partial' | 'none'; met: boolean };
  reentry: {
    estimatedDaysRemaining: number | null;
    estimatedReentryAt: Date | null;
    reentryTier: ReentryTier;
    decayRateKmPerDay: number | null;
  };
}

const MS_PER_DAY = 86_400_000;
const REENTRY_ALTITUDE_KM = 120;

export const SIGNAL_WEIGHTS = { bstar: 0.35, ndot: 0.25, altitude: 0.4 };
export const SIGNAL_AGREE_THRESHOLDS = { bstar: 0.3, ndot: 0.3, altitude: 0.2 };

export function bstarSignalStrength(bstarReg: RegressionResult): number {
  if (!bstarReg || bstarReg.slope <= 0) return 0;
  return Math.min(1, bstarReg.rSquared * Math.min(1, bstarReg.slope / 1e-7));
}

export function ndotSignalStrength(
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

export function altitudeSignalStrength(
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

export function computeManeuverLikelihood(
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
  signals: SignalContribution[];
} {
  const bstarSig = bstarSignalStrength(bstarReg);
  const ndotSig = ndotSignalStrength(ndotReg, ndotLatest, decayAltKm);
  const altSig = altitudeSignalStrength(perigeeReg, smaReg);
  const maneuverLikelihood = computeManeuverLikelihood(bstarReg, altSig);

  const signals: SignalContribution[] = [
    {
      name: 'bstar',
      strength: bstarSig,
      weight: SIGNAL_WEIGHTS.bstar,
      contribution: bstarSig * SIGNAL_WEIGHTS.bstar,
      agrees: bstarSig >= SIGNAL_AGREE_THRESHOLDS.bstar,
    },
    {
      name: 'ndot',
      strength: ndotSig,
      weight: SIGNAL_WEIGHTS.ndot,
      contribution: ndotSig * SIGNAL_WEIGHTS.ndot,
      agrees: ndotSig >= SIGNAL_AGREE_THRESHOLDS.ndot,
    },
    {
      name: 'altitude',
      strength: altSig,
      weight: SIGNAL_WEIGHTS.altitude,
      contribution: altSig * SIGNAL_WEIGHTS.altitude,
      agrees: altSig >= SIGNAL_AGREE_THRESHOLDS.altitude,
    },
  ];

  const rawConfidence =
    SIGNAL_WEIGHTS.bstar * bstarSig +
    SIGNAL_WEIGHTS.ndot * ndotSig +
    SIGNAL_WEIGHTS.altitude * altSig;

  const decayConfidence = Math.max(
    0,
    Math.min(1, rawConfidence * (1 - maneuverLikelihood * 0.75))
  );

  if (maneuverLikelihood > 0.5) {
    return {
      signal: 'maneuvering',
      maneuverLikelihood,
      decayConfidence: decayConfidence * 0.2,
      signals,
    };
  }

  const decaying =
    decayConfidence >= 0.35 &&
    (altSig >= 0.2 || (bstarSig >= 0.3 && ndotSig >= 0.3));

  if (decaying) {
    return {
      signal: 'decaying',
      maneuverLikelihood: 0,
      decayConfidence,
      signals,
    };
  }

  if (decayConfidence < 0.15 && (bstarReg?.n ?? 0) >= 5) {
    return {
      signal: 'stable',
      maneuverLikelihood: 0,
      decayConfidence: Math.max(decayConfidence, 0.8),
      signals,
    };
  }

  return {
    signal: 'insufficient_data',
    maneuverLikelihood,
    decayConfidence,
    signals,
  };
}

export function payloadConsensusRequired(
  objectType: ObjectType,
  perigeeLatest: number | null
): boolean {
  // Below 220km, altitude drop alone is sufficient evidence.
  // Drag overwhelms maneuver authority at this altitude, even if
  // BSTAR is contaminated by prior burns.
  if (perigeeLatest !== null && perigeeLatest < 220) return false;

  if (perigeeLatest !== null && perigeeLatest < 300) {
    return false;
  }

  return objectType === 'payload' || objectType === 'unknown';
}

export function partialConsensusRequired(
  perigeeLatest: number | null
): boolean {
  return perigeeLatest !== null && perigeeLatest >= 220 && perigeeLatest < 300;
}

function estimateReentry(input: {
  signal: DecaySignal;
  decayConfidence: number;
  objectType: ObjectType;
  perigeeLatest: number | null;
  decayAltKm: number;
  perigeeReg: RegressionResult;
  perigeeReg7d: RegressionResult;
  smaReg: RegressionResult;
  smaReg7d: RegressionResult;
  bstarReg: RegressionResult;
  ndotReg: RegressionResult;
  ndotLatest: number | null;
  ndotMean14d: number | null;
  nowMs: number;
  maneuverLikelihood: number;
}): ReentryExplanation['reentry'] & {
  consensus: ReentryExplanation['consensus'];
} {
  const {
    signal,
    decayConfidence,
    objectType,
    perigeeLatest,
    decayAltKm,
    perigeeReg,
    perigeeReg7d,
    smaReg,
    smaReg7d,
    bstarReg,
    ndotReg,
    ndotLatest,
    ndotMean14d,
    nowMs,
    maneuverLikelihood,
  } = input;

  const fullConsensusRequired = payloadConsensusRequired(
    objectType,
    perigeeLatest
  );
  const allAgree = allSignalsAgreeFromSlopes({
    bstarSlope14d: bstarReg?.slope ?? null,
    ndotSlope14d: ndotReg?.slope ?? null,
    ndotLatest,
    ndotMean14d,
    perigeeSlope14d: perigeeReg?.slope ?? null,
    smaSlope14d: smaReg?.slope ?? null,
    decayAltKm,
  });

  const partialConsensus = partialConsensusRequired(perigeeLatest);
  const altAgrees =
    (perigeeReg?.slope ?? 0) < -0.01 || (smaReg?.slope ?? 0) < -0.01;

  const consensus: ReentryExplanation['consensus'] = fullConsensusRequired
    ? { required: 'full', met: allAgree }
    : partialConsensus
      ? { required: 'partial', met: altAgrees }
      : { required: 'none', met: true };

  const consensusBlocks = !consensus.met;

  if (
    signal === 'maneuvering' ||
    signal === 'insufficient_data' ||
    (signal !== 'decaying' && decayConfidence < 0.35) ||
    consensusBlocks ||
    perigeeLatest === null ||
    perigeeLatest <= REENTRY_ALTITUDE_KM
  ) {
    return {
      estimatedDaysRemaining: null,
      estimatedReentryAt: null,
      reentryTier: 'stable',
      decayRateKmPerDay: null,
      consensus,
    };
  }

  const decayRateKmPerDay = Math.max(
    perigeeReg7d?.slope && perigeeReg7d.slope < 0
      ? Math.abs(perigeeReg7d.slope)
      : 0,
    smaReg7d?.slope && smaReg7d.slope < 0 ? Math.abs(smaReg7d.slope) : 0,
    perigeeReg?.slope && perigeeReg.slope < 0 ? Math.abs(perigeeReg.slope) : 0,
    smaReg?.slope && smaReg.slope < 0 ? Math.abs(smaReg.slope) : 0
  );

  if (decayRateKmPerDay < 0.001) {
    return {
      estimatedDaysRemaining: null,
      estimatedReentryAt: null,
      reentryTier: 'stable',
      decayRateKmPerDay,
      consensus,
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

  const rawTier = assignReentryTier(estimatedDaysRemaining, decayAltKm);
  const tier =
    perigeeLatest !== null && perigeeLatest < 220 && maneuverLikelihood === 0
      ? rawTier
      : applyConfidenceCeiling(rawTier, decayConfidence);

  return {
    estimatedDaysRemaining,
    estimatedReentryAt,
    reentryTier: tier,
    decayRateKmPerDay,
    consensus,
  };
}

export function explainReentryTrend(input: {
  bstarReg: RegressionResult;
  ndotReg: RegressionResult;
  perigeeReg: RegressionResult;
  perigeeReg7d: RegressionResult;
  smaReg: RegressionResult;
  smaReg7d: RegressionResult;
  ndotLatest: number | null;
  ndotMean14d: number | null;
  decayAltKm: number;
  objectType: ObjectType;
  perigeeLatest: number | null;
  nowMs: number;
}): ReentryExplanation {
  const classification = classifyDecaySignal(
    input.bstarReg,
    input.ndotReg,
    input.perigeeReg,
    input.smaReg,
    input.ndotLatest,
    input.decayAltKm
  );

  const { consensus, ...reentry } = estimateReentry({
    signal: classification.signal,
    decayConfidence: classification.decayConfidence,
    objectType: input.objectType,
    perigeeLatest: input.perigeeLatest,
    decayAltKm: input.decayAltKm,
    perigeeReg: input.perigeeReg,
    perigeeReg7d: input.perigeeReg7d,
    smaReg: input.smaReg,
    smaReg7d: input.smaReg7d,
    bstarReg: input.bstarReg,
    ndotReg: input.ndotReg,
    ndotLatest: input.ndotLatest,
    ndotMean14d: input.ndotMean14d,
    nowMs: input.nowMs,
    maneuverLikelihood: classification.maneuverLikelihood,
  });

  return {
    signal: classification.signal,
    decayConfidence: classification.decayConfidence,
    maneuverLikelihood: classification.maneuverLikelihood,
    signals: classification.signals,
    consensus,
    reentry,
  };
}
