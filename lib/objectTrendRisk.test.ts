import {
  attachTipData,
  buildReentryRiskMap,
  resolveReentryRisk,
} from './objectTrendRisk';
import type { ObjectTrend, TipPrediction, TleEntry } from './types';

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

// TIP tests

function makeTip(overrides: Partial<TipPrediction> = {}): TipPrediction {
  return {
    noradId: 25544,
    decayEpoch: '2026-01-04T00:00:00.000Z', // 3 days after makeEntry's tleEpoch
    windowMinutes: 60,
    msgEpoch: '2026-01-01T00:00:00.000Z',
    insertEpoch: '2026-01-01T00:06:00.000Z',
    direction: 'descending',
    lat: 0,
    lon: 0,
    highInterest: false,
    ...overrides,
  };
}

describe('attachTipData', () => {
  const nowMs = Date.parse('2026-01-01T00:00:00.000Z');

  it('returns the risk unchanged when there is no TIP prediction', () => {
    const risk = resolveReentryRisk(makeEntry(), undefined, 1);
    expect(attachTipData(risk, undefined, nowMs)).toBe(risk); // same reference, not just equal
  });

  it('computes a positive delta when DRAKON is later than TIP', () => {
    const risk = {
      ...resolveReentryRisk(makeEntry(), undefined, 1),
      estimatedDaysRemaining: 10,
    };
    const tip = makeTip({ decayEpoch: '2026-01-04T00:00:00.000Z' }); // 3 days out
    const result = attachTipData(risk, tip, nowMs);
    expect(result.tipDeltaDays).toBe(7);
    expect(result.tipAgreement).toBe('diverges');
  });

  it('computes a negative delta when DRAKON is earlier than TIP', () => {
    const risk = {
      ...resolveReentryRisk(makeEntry(), undefined, 1),
      estimatedDaysRemaining: 2,
    };
    const tip = makeTip({ decayEpoch: '2026-01-09T00:00:00.000Z' }); // 8 days out
    const result = attachTipData(risk, tip, nowMs);
    expect(result.tipDeltaDays).toBe(-6);
    expect(result.tipAgreement).toBe('diverges');
  });

  it('classifies as aligned within the 5-day threshold, inclusive', () => {
    const risk = {
      ...resolveReentryRisk(makeEntry(), undefined, 1),
      estimatedDaysRemaining: 8,
    };
    const tip = makeTip({ decayEpoch: '2026-01-04T00:00:00.000Z' }); // 3 days out -> delta 5
    expect(attachTipData(risk, tip, nowMs).tipAgreement).toBe('aligned');
  });

  it('classifies as diverges once past the threshold', () => {
    const risk = {
      ...resolveReentryRisk(makeEntry(), undefined, 1),
      estimatedDaysRemaining: 9,
    };
    const tip = makeTip({ decayEpoch: '2026-01-03T00:00:00.000Z' }); // 2 days out -> delta 7, past the 5-day threshold
    expect(attachTipData(risk, tip, nowMs).tipAgreement).toBe('diverges');
  });

  it('leaves tipDeltaDays and tipAgreement null when DRAKON has no estimate', () => {
    // perigee above the 240km threshold, no trend, not debris -> falls through to stableReentryRisk()
    const risk = resolveReentryRisk(
      makeEntry({ perigeeKm: 500, apogeeKm: 520 }),
      undefined,
      1
    );
    expect(risk.estimatedDaysRemaining).toBeNull();
    const tip = makeTip();
    const result = attachTipData(risk, tip, nowMs);
    expect(result.tipDeltaDays).toBeNull();
    expect(result.tipAgreement).toBeNull();
    expect(result.tip).toBe(tip); // tip itself still attached even with no delta
  });
});

describe('buildReentryRiskMap — TIP inclusion override', () => {
  it('excludes a stable-tier object when there is no TIP data (unchanged baseline behavior)', () => {
    const entry = makeEntry({ id: 99001, perigeeKm: 500, apogeeKm: 520 }); // above threshold, no trend -> stable
    const map = buildReentryRiskMap([entry], undefined, 1);
    expect(map.has(99001)).toBe(false);
  });

  it('includes a stable-tier object when it has an active TIP prediction', () => {
    const entry = makeEntry({ id: 99002, perigeeKm: 500, apogeeKm: 520 });
    const tipByNoradId = new Map([[99002, makeTip({ noradId: 99002 })]]);
    const map = buildReentryRiskMap([entry], undefined, 1, tipByNoradId);
    const risk = map.get(99002);
    expect(risk).toBeDefined();
    expect(risk!.tier).toBe('stable');
    expect(risk!.tip).toBeDefined();
  });

  it('is identical to the 3-argument call when tipByNoradId is undefined', () => {
    const entries = [
      makeEntry({ id: 1 }),
      makeEntry({ id: 2, perigeeKm: 500, apogeeKm: 520 }),
    ];
    const withoutTip = buildReentryRiskMap(entries, undefined, 1);
    const withUndefinedTip = buildReentryRiskMap(
      entries,
      undefined,
      1,
      undefined
    );
    expect(withUndefinedTip).toEqual(withoutTip);
  });

  it('does not change tier or estimatedDaysRemaining for a critical object, even when TIP disagrees sharply', () => {
    const entry = makeEntry({ id: 99003 }); // critical, single-epoch, per the existing suite's baseline case
    const tipByNoradId = new Map([
      [
        99003,
        makeTip({ noradId: 99003, decayEpoch: '2026-06-01T00:00:00.000Z' }),
      ], // months out
    ]);
    const withoutTip = buildReentryRiskMap([entry], undefined, 1).get(99003)!;
    const withTip = buildReentryRiskMap(
      [entry],
      undefined,
      1,
      tipByNoradId
    ).get(99003)!;
    expect(withTip.tier).toBe(withoutTip.tier);
    expect(withTip.estimatedDaysRemaining).toBe(
      withoutTip.estimatedDaysRemaining
    );
    expect(withTip.tipAgreement).toBe('diverges');
  });
});
