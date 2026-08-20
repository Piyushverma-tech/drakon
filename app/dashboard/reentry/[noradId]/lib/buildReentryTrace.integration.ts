import { resolveReentryRisk } from '@/lib/objectTrendRisk';
import { buildReentryTrace } from './buildReentryTrace';
import type { ObjectTrend, TleEntry } from '@/lib/types';

// Calls the REAL resolveReentryRisk() rather than hand-written risk/trend
// fixtures -- the fixture-only version of this test suite missed a real
// runtime crash (a missing export) precisely because synthetic fixtures
// can't catch a broken import graph. This suite exists so that class of
// bug can't slip through silently again.

const L1 =
  '1 46347U 20070A   26189.45000000  .00021000  00000-0  12000-3 0  9991';
const L2 =
  '2 46347  53.0100  38.4900 0010100 268.4300  91.5000 16.35000000123456';

function makeEntry(overrides: Partial<TleEntry> = {}): TleEntry {
  return {
    id: 46347,
    name: 'STARLINK-1547',
    operator: 'SpaceX',
    l1: L1,
    l2: L2,
    inclination: 53.01,
    raan: 38.49,
    argPerigee: 268.43,
    meanAnomaly: 91.5,
    meanMotion: 16.35,
    meanMotionDot: 0.00002,
    tleEpoch: '2026-07-08T10:48:00.000Z',
    ecc: 0.00101,
    perigeeKm: 172,
    apogeeKm: 185,
    semiMajorAxisKm: 6556.6,
    ...overrides,
  };
}

function makeTrend(overrides: Partial<ObjectTrend> = {}): ObjectTrend {
  return {
    noradId: 46347,
    updatedAt: '2026-07-05T13:50:00.000Z',
    trendVersion: 4,
    epochsAvailable: 31,
    historyDaysAvailable: 29,
    bstarLatest: 5e-7,
    bstarSlope7d: null,
    bstarSlope14d: 2e-8,
    bstarSlope30d: null,
    bstarMean14d: null,
    bstarStddev14d: null,
    bstarRsq14d: null,
    perigeeLatest: 231,
    perigeeSlope7d: -3.2,
    perigeeSlope14d: -3.2,
    perigeeSlope30d: null,
    apogeeLatest: 240,
    apogeeSlope14d: null,
    smaLatest: 6584,
    smaSlope7d: null,
    smaSlope14d: -3,
    meanMotionDotLatest: 0.00002,
    meanMotionDotMean14d: 0.00002,
    decaySignal: 'decaying',
    maneuverLikelihood: 0,
    decayConfidence: 0.76,
    bstarSignalStrength: 0.55,
    ndotSignalStrength: 0.72,
    altitudeSignalStrength: 0.96,
    consensusRequired: 'partial',
    consensusMet: true,
    estimatedDaysRemaining: 9,
    estimatedReentryAt: '2026-07-17T00:00:00.000Z',
    reentryTier: 'warning',
    objectType: 'payload',
    isDebris: false,
    ...overrides,
  };
}

describe('resolveReentryRisk -> buildReentryTrace (integration, real functions end to end)', () => {
  it('handles a low-perigee payload with no trend row at all', () => {
    const entry = makeEntry();
    expect(() => {
      const risk = resolveReentryRisk(entry, undefined, 1);
      const trace = buildReentryTrace({
        risk,
        trend: undefined,
        isCurrentModelVersion: true,
      });
      expect(trace.verdict.tier).toBe('critical');
      expect(trace.steps.map((s) => s.id)).toEqual(['tier']);
    }).not.toThrow();
  });

  it('handles the exact reported STARLINK-1547 case end to end for real', () => {
    const entry = makeEntry({ perigeeKm: 172, apogeeKm: 185 });
    const trend = makeTrend();

    expect(() => {
      const risk = resolveReentryRisk(entry, trend, 1);
      const trace = buildReentryTrace({
        risk,
        trend,
        isCurrentModelVersion: true,
      });

      expect(risk.tier).toBe('critical');
      expect(trace.verdict.tier).toBe('critical');
      expect(trace.steps.find((s) => s.id === 'override')).toBeDefined();
    }).not.toThrow();
  });

  it('handles a stable object with no decaySignal set on risk (the common, undertested path)', () => {
    const entry = makeEntry({ perigeeKm: 550, apogeeKm: 560 });

    expect(() => {
      const risk = resolveReentryRisk(entry, undefined, 1);
      expect(risk.decaySignal).toBeUndefined();
      const trace = buildReentryTrace({
        risk,
        trend: undefined,
        isCurrentModelVersion: true,
      });
      expect(trace.verdict.headline).toBe('No significant decay detected');
    }).not.toThrow();
  });

  it('handles a debris object routed through the legacy getReentryRisk path', () => {
    const entry = makeEntry({
      isDebris: true,
      name: 'FENGYUN 1C DEB',
      perigeeKm: 780,
      apogeeKm: 820,
    });

    expect(() => {
      const risk = resolveReentryRisk(entry, undefined, 1);
      const trace = buildReentryTrace({
        risk,
        trend: undefined,
        isCurrentModelVersion: true,
      });
      expect(trace).toBeDefined();
    }).not.toThrow();
  });

  it('handles an object flagged as maneuvering by the trend model', () => {
    const entry = makeEntry({ perigeeKm: 210, apogeeKm: 220 });
    const trend = makeTrend({
      decaySignal: 'maneuvering',
      maneuverLikelihood: 0.8,
      estimatedDaysRemaining: null,
      reentryTier: 'stable',
    });

    expect(() => {
      const risk = resolveReentryRisk(entry, trend, 1);
      const trace = buildReentryTrace({
        risk,
        trend,
        isCurrentModelVersion: true,
      });
      expect(trace.verdict.tier).toBe('stable');
    }).not.toThrow();
  });

  it('handles a HEO object', () => {
    const entry = makeEntry({ perigeeKm: 500, apogeeKm: 35786 });

    expect(() => {
      const risk = resolveReentryRisk(entry, undefined, 1);
      const trace = buildReentryTrace({
        risk,
        trend: undefined,
        isCurrentModelVersion: true,
      });
      expect(trace.verdict.tier).toBe('stable');
    }).not.toThrow();
  });
});
