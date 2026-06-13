import { ndotIndicatesDecay } from './satelliteHelpers';
import type { ObjectTrend, TleEntry } from './types';

export function isDebrisEntry(entry: TleEntry): boolean {
  const nameUpper = entry.name.toUpperCase();
  return (
    entry.isDebris ||
    nameUpper.includes('DEB') ||
    nameUpper.includes('DEBRIS')
  );
}

export function decayAltKmFromTrend(trend: ObjectTrend): number {
  if (trend.smaLatest) return Math.max(0, trend.smaLatest - 6378.137);
  return trend.perigeeLatest ?? 0;
}

type SignalInput = {
  bstarSlope14d: number | null;
  ndotSlope14d: number | null;
  ndotLatest: number | null;
  ndotMean14d: number | null;
  perigeeSlope14d: number | null;
  smaSlope14d: number | null;
  decayAltKm: number;
};

export function decaySignalFlags(input: SignalInput) {
  const bstarAgrees = (input.bstarSlope14d ?? 0) > 0;
  const ndotAgrees =
    (input.ndotSlope14d !== null && input.ndotSlope14d > 0) ||
    (input.ndotLatest !== null &&
      ndotIndicatesDecay(input.ndotLatest, input.decayAltKm)) ||
    (input.ndotMean14d !== null &&
      ndotIndicatesDecay(input.ndotMean14d, input.decayAltKm));
  const altAgrees =
    (input.perigeeSlope14d ?? 0) < -0.01 ||
    (input.smaSlope14d ?? 0) < -0.01;

  return { bstarAgrees, ndotAgrees, altAgrees };
}

export function allTrendSignalsAgree(trend: ObjectTrend): boolean {
  const decayAltKm = decayAltKmFromTrend(trend);
  const flags = decaySignalFlags({
    bstarSlope14d: trend.bstarSlope14d,
    ndotSlope14d: null,
    ndotLatest: trend.meanMotionDotLatest,
    ndotMean14d: trend.meanMotionDotMean14d,
    perigeeSlope14d: trend.perigeeSlope14d,
    smaSlope14d: trend.smaSlope14d,
    decayAltKm,
  });
  return flags.bstarAgrees && flags.ndotAgrees && flags.altAgrees;
}

export function trendSignalsAgree(trend: ObjectTrend): boolean {
  const decayAltKm = decayAltKmFromTrend(trend);
  const flags = decaySignalFlags({
    bstarSlope14d: trend.bstarSlope14d,
    ndotSlope14d: null,
    ndotLatest: trend.meanMotionDotLatest,
    ndotMean14d: trend.meanMotionDotMean14d,
    perigeeSlope14d: trend.perigeeSlope14d,
    smaSlope14d: trend.smaSlope14d,
    decayAltKm,
  });
  return [flags.bstarAgrees, flags.ndotAgrees, flags.altAgrees].filter(
    Boolean
  ).length >= 2;
}

export function allSignalsAgreeFromSlopes(
  input: SignalInput
): boolean {
  const flags = decaySignalFlags(input);
  return flags.bstarAgrees && flags.ndotAgrees && flags.altAgrees;
}
