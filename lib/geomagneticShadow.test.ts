import { evaluateGeomagneticShadow } from './geomagneticShadow';
import type { GeomagneticState } from './geomagneticIndex';
import type { ObjectTrend, TleEntry } from './types';

function makeEntry(overrides: Partial<TleEntry> = {}): TleEntry {
  return {
    id: 25544,
    name: 'TEST DEBRIS',
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
    perigeeKm: 230,
    apogeeKm: 245,
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
    perigeeLatest: 350,
    perigeeSlope7d: null,
    perigeeSlope14d: -0.5,
    perigeeSlope30d: null,
    apogeeLatest: null,
    apogeeSlope14d: null,
    smaLatest: null,
    smaSlope7d: null,
    smaSlope14d: -0.3,
    meanMotionDotLatest: null,
    meanMotionDotMean14d: null,
    decaySignal: 'decaying',
    maneuverLikelihood: 0.05,
    decayConfidence: 0.85,
    bstarSignalStrength: null,
    ndotSignalStrength: null,
    altitudeSignalStrength: null,
    consensusRequired: 'none',
    consensusMet: null,
    estimatedDaysRemaining: 40,
    estimatedReentryAt: null,
    reentryTier: 'nominal',
    objectType: 'payload',
    isDebris: false,
    ...overrides,
  };
}

function makeGeomagneticState(
  overrides: Partial<GeomagneticState> = {}
): GeomagneticState {
  return {
    kp: 6,
    kpClass: '6o',
    estimatedAp: 80,
    observedAt: '2026-08-23T12:00:00.000Z',
    ageMinutes: 30,
    history: [],
    activity: 80,
    persistence: 0.6,
    stormPhase: 'sustained',
    multiplier: 1.3,
    source: 'noaa-swpc',
    freshness: 'live',
    modelVersion: 0,
    ...overrides,
  };
}

describe('geomagneticShadow — evaluateGeomagneticShadow', () => {
  it('flags a real tier change on the multiplier-sensitive altitude path', () => {
    // Empirically verified against resolveReentryRisk: at perigeeKm=230
    // with no trend, multiplier 1.0 -> nominal/15d, multiplier 1.3 -> warning/12d.
    const entry = makeEntry();
    const geomagneticState = makeGeomagneticState({ multiplier: 1.3 });

    const summary = evaluateGeomagneticShadow(
      [entry],
      undefined,
      1.0,
      geomagneticState
    );

    expect(summary.combinedMultiplier).toBeCloseTo(1.3, 5);
    expect(summary.changedRows).toHaveLength(1);

    const row = summary.changedRows[0];
    expect(row.satId).toBe(25544);
    expect(row.solarOnlyTier).toBe('nominal');
    expect(row.solarOnlyDays).toBe(15);
    expect(row.correctedTier).toBe('warning');
    expect(row.correctedDays).toBe(12);
    expect(row.tierChanged).toBe(true);
    expect(row.daysDelta).toBe(-3);
    expect(summary.objectsWithTierChange).toBe(1);
  });

  it('produces an empty changedRows array under quiet conditions (geomagneticMultiplier = 1.0)', () => {
    const entry = makeEntry();
    const quietState = makeGeomagneticState({
      multiplier: 1.0,
      estimatedAp: 4,
      kpClass: '1-',
      activity: 4,
      stormPhase: 'quiet',
    });

    const summary = evaluateGeomagneticShadow(
      [entry],
      undefined,
      1.0,
      quietState
    );

    expect(summary.combinedMultiplier).toBe(1.0);
    expect(summary.changedRows).toEqual([]);
    expect(summary.objectsWithTierChange).toBe(0);
  });

  it('never shows a delta for an object resolved purely from the trend path (multiplier-insensitive)', () => {
    // perigeeKm=350 is above the 240km altitude threshold, so resolveReentryRisk
    // never touches the altitude-based (multiplier-sensitive) formula at all.
    const entry = makeEntry({ perigeeKm: 350, apogeeKm: 360 });
    const trend = makeTrend();
    const objectTrendsById = new Map([[entry.id, trend]]);
    const geomagneticState = makeGeomagneticState({ multiplier: 1.4 });

    const summary = evaluateGeomagneticShadow(
      [entry],
      objectTrendsById,
      1.0,
      geomagneticState
    );

    expect(summary.changedRows).toEqual([]);
    expect(summary.objectsWithTierChange).toBe(0);
  });

  it('reports objectsEvaluated as the union of objects with an estimate on either side', () => {
    const changing = makeEntry({ id: 1 });
    const unaffected = makeEntry({ id: 2, perigeeKm: 350, apogeeKm: 360 });
    const trend = makeTrend({ noradId: 2 });
    const objectTrendsById = new Map([[2, trend]]);
    const geomagneticState = makeGeomagneticState({ multiplier: 1.3 });

    const summary = evaluateGeomagneticShadow(
      [changing, unaffected],
      objectTrendsById,
      1.0,
      geomagneticState
    );

    expect(summary.objectsEvaluated).toBe(2);
    expect(summary.objectsWithTierChange).toBe(1);
    expect(summary.changedRows.map((r) => r.satId)).toEqual([1]);
  });

  it('passes through the geomagnetic state fields into the summary without mutating them', () => {
    const entry = makeEntry();
    const geomagneticState = makeGeomagneticState({
      kpClass: '7-',
      estimatedAp: 111,
      activity: 95,
      freshness: 'stale',
      modelVersion: 0,
      multiplier: 1.2,
    });

    const summary = evaluateGeomagneticShadow(
      [entry],
      undefined,
      1.05,
      geomagneticState
    );

    expect(summary.kpClass).toBe('7-');
    expect(summary.observedAt).toBe(geomagneticState.observedAt);
    expect(summary.estimatedAp).toBe(111);
    expect(summary.activity).toBe(95);
    expect(summary.freshness).toBe('stale');
    expect(summary.modelVersion).toBe(0);
    expect(summary.solarFluxMultiplier).toBe(1.05);
    expect(summary.geomagneticMultiplier).toBe(1.2);
    expect(summary.combinedMultiplier).toBeCloseTo(1.05 * 1.2, 5);
  });
});
