import { resolveReentryRisk } from './objectTrendRisk';
import type { ObjectTrend, TleEntry } from './types';

function makeEntry(overrides: Partial<TleEntry> = {}): TleEntry {
  return {
    id: 25544,
    name: 'TEST PAYLOAD',
    operator: 'TEST',
    l1: ' '.repeat(53) + '50000-6' + ' '.repeat(8), // positive BSTAR
    l2: '2 25544  51.6000 000.0000 0000000 000.0000 000.0000 16.00000000',
    inclination: 51.6,
    raan: 0,
    argPerigee: 0,
    meanAnomaly: 0,
    meanMotion: 16,
    meanMotionDot: 0.00002182, // positive: not "raising orbit"
    ecc: 0,
    perigeeKm: 180,
    apogeeKm: 195,
    semiMajorAxisKm: 6565,
    tleEpoch: '2026-01-01T00:00:00.000Z',
    isDebris: false,
    ...overrides,
  };
}

function makeTrend(overrides: Partial<ObjectTrend> = {}): ObjectTrend {
  return {
    noradId: 25544,
    updatedAt: '2026-01-01T00:00:00.000Z',
    trendVersion: 4,
    epochsAvailable: 10,
    historyDaysAvailable: 12,
    bstarLatest: 5e-7,
    bstarSlope7d: null,
    bstarSlope14d: null,
    bstarSlope30d: null,
    bstarMean14d: null,
    bstarStddev14d: null,
    bstarRsq14d: null,
    bstarSignalStrength: null,
    perigeeLatest: 180,
    perigeeSlope7d: null,
    perigeeSlope14d: null,
    perigeeSlope30d: null,
    apogeeLatest: null,
    apogeeSlope14d: null,
    smaLatest: null,
    smaSlope7d: null,
    smaSlope14d: null,
    meanMotionDotLatest: null,
    meanMotionDotMean14d: null,
    ndotSignalStrength: null,
    altitudeSignalStrength: null,
    consensusRequired: null,
    consensusMet: null,
    decaySignal: 'decaying',
    maneuverLikelihood: 0,
    decayConfidence: 0.5,
    estimatedDaysRemaining: 30,
    estimatedReentryAt: null,
    reentryTier: 'warning',
    objectType: 'payload',
    isDebris: false,
    ...overrides,
  };
}

describe('resolveReentryRisk — altitude-driven fallback below 240km', () => {
  it('flags a critical object from altitude alone when there is no trend row at all', () => {
    const entry = makeEntry();

    const risk = resolveReentryRisk(entry, undefined, 1);

    expect(risk.source).toBe('single_epoch');
    expect(risk.tier).toBe('critical');
    expect(risk.estimatedDaysRemaining).toBe(2);
    expect(risk.confidence).toBe('high');
  });

  it('still uses the altitude estimate when a trend row exists but has too little history to be actionable', () => {
    const entry = makeEntry();
    const trend = makeTrend({
      epochsAvailable: 2, // isActionableTrend requires >= 3
      historyDaysAvailable: 0.5,
      decaySignal: 'insufficient_data',
      estimatedDaysRemaining: null,
      reentryTier: 'stable',
      decayConfidence: 0.05,
    });

    const risk = resolveReentryRisk(entry, trend, 1);

    expect(risk.source).toBe('single_epoch');
    expect(risk.tier).toBe('critical');
    expect(risk.estimatedDaysRemaining).toBe(2);
  });

  it('picks the trend estimate when it is more pessimistic than the altitude estimate', () => {
    const entry = makeEntry();
    const trend = makeTrend({
      decaySignal: 'decaying',
      epochsAvailable: 10,
      historyDaysAvailable: 12,
      reentryTier: 'critical',
      estimatedDaysRemaining: 1, // sooner than altitude's 2-day estimate
      decayConfidence: 0.9,
      perigeeLatest: 180,
    });

    const risk = resolveReentryRisk(entry, trend, 1);

    expect(risk.source).toBe('multi_epoch');
    expect(risk.tier).toBe('critical');
    expect(risk.estimatedDaysRemaining).toBe(1);
  });

  it('overrides a too-calm trend estimate with the altitude estimate — the actual "known problem" fix', () => {
    // This is the scenario described: thin/noisy trend data at low altitude
    // produces a low-confidence, low-urgency trend read (45 days, nominal)
    // even though the object is objectively at 180km. The altitude-driven
    // fallback should win here, not the trend.
    const entry = makeEntry();
    const trend = makeTrend({
      decaySignal: 'decaying',
      epochsAvailable: 5,
      historyDaysAvailable: 4,
      reentryTier: 'nominal',
      estimatedDaysRemaining: 45, // later than altitude's 2-day estimate
      decayConfidence: 0.3,
      perigeeLatest: 180,
    });

    const risk = resolveReentryRisk(entry, trend, 1);

    expect(risk.source).toBe('single_epoch');
    expect(risk.tier).toBe('critical');
    expect(risk.estimatedDaysRemaining).toBe(2);
  });

  it('FLAG: a "maneuvering" trend read skips the altitude fallback entirely, even at 180km', () => {
    // Unlike the 'nominal'/'stable-with-data' cases above, a decaySignal of
    // 'maneuvering' short-circuits resolveReentryRisk before the altitude
    // estimate is ever computed (see the early return in objectTrendRisk.ts).
    // If 'maneuvering' is a false positive from a noisy/short BSTAR window,
    // there is currently no altitude-based safety net catching it here --
    // this test documents that gap rather than asserting it's correct.
    const entry = makeEntry();
    const trend = makeTrend({
      decaySignal: 'maneuvering',
      epochsAvailable: 6,
      maneuverLikelihood: 0.8,
    });

    const risk = resolveReentryRisk(entry, trend, 1);

    expect(risk.tier).toBe('stable');
    expect(risk.estimatedDaysRemaining).toBeNull();
  });
});
