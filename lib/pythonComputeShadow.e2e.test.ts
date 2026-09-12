/**
 * Verifies evaluatePythonComputeShadow end-to-end against a real running
 * compute engine: sampling actually ran, comparisons actually happened,
 * and the aggregated summary (counts, percentiles) is internally
 * consistent. Skips cleanly without BACKEND_URL, same as
 * reentryComputeClient.e2e.test.ts.
 */
import { evaluatePythonComputeShadow } from './pythonComputeShadow';
import type { ObjectTrend, TleEntry } from './types';

const hasBackend = Boolean(process.env.BACKEND_URL);
const describeIfBackend = hasBackend ? describe : describe.skip;

function makeEntry(id: number, perigeeKm: number): TleEntry {
  return {
    id,
    name: `OBJECT ${id}`,
    operator: 'TEST',
    l1: ' '.repeat(53) + '50000-6 ',
    l2: '2 00000  51.6000 000.0000 0000000 000.0000 000.0000 16.00000000',
    inclination: 51.6,
    raan: 0,
    argPerigee: 0,
    meanAnomaly: 0,
    meanMotion: 16,
    meanMotionDot: 0.00002182,
    ecc: 0,
    perigeeKm,
    apogeeKm: perigeeKm + 20,
    semiMajorAxisKm: 6378.137 + perigeeKm,
    tleEpoch: '2026-01-01T00:00:00.000Z',
    isDebris: false,
  };
}

function makeTrend(
  noradId: number,
  reentryTier: ObjectTrend['reentryTier'],
  decaySignal: ObjectTrend['decaySignal'],
  perigeeKm: number
): ObjectTrend {
  return {
    noradId,
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
    perigeeLatest: perigeeKm,
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
    decaySignal,
    maneuverLikelihood: 0,
    decayConfidence: 0.5,
    bstarSignalStrength: null,
    ndotSignalStrength: null,
    altitudeSignalStrength: null,
    consensusRequired: null,
    consensusMet: null,
    estimatedDaysRemaining: 30,
    estimatedReentryAt: null,
    reentryTier,
    objectType: 'payload',
    isDebris: false,
  };
}

describeIfBackend('evaluatePythonComputeShadow — live compute engine', () => {
  it('samples, compares, and aggregates a synthetic catalog correctly', async () => {
    const entries: TleEntry[] = [];
    const objectTrendsById = new Map<number, ObjectTrend>();

    let id = 1;
    const spec: [ObjectTrend['reentryTier'], ObjectTrend['decaySignal'], number][] = [
      ['stable', 'stable', 30],
      ['nominal', 'decaying', 10],
      ['warning', 'decaying', 5],
      ['critical', 'decaying', 3],
    ];
    for (const [tier, signal, count] of spec) {
      for (let i = 0; i < count; i++) {
        const perigeeKm = 500;
        entries.push(makeEntry(id, perigeeKm));
        objectTrendsById.set(id, makeTrend(id, tier, signal, perigeeKm));
        id++;
      }
    }

    const summary = await evaluatePythonComputeShadow(entries, objectTrendsById, 1, {
      sampleRate: 0.3,
      maxSampleSize: 20,
      timeoutMs: 5000,
      random: () => 0.42, // deterministic-ish; exact values don't matter here
    });

    expect(summary.catalogSize).toBe(entries.length);
    expect(summary.eligibleCount).toBe(entries.length);
    expect(summary.sampledCount).toBeGreaterThan(0);
    expect(summary.sampledCount).toBeLessThanOrEqual(20);
    expect(summary.successCount + summary.failureCount).toBe(summary.sampledCount);
    expect(summary.matchedCount + summary.valueMismatchCount).toBe(summary.successCount);
    expect(summary.expectedModelId).toBe('reentry_resolution');
    expect(summary.expectedModelVersion).toBe('0.1.0');

    // Same TS entries/trends round-tripped through the real Python
    // backend should match -- this is exactly what the golden fixtures
    // already prove, so failureCount/valueMismatchCount should be 0 and
    // rows should be empty (mirrors evaluateGeomagneticShadow's
    // changedRows: quiet agreement produces zero persisted rows).
    expect(summary.failureCount).toBe(0);
    expect(summary.valueMismatchCount).toBe(0);
    expect(summary.rows).toEqual([]);

    expect(summary.durationMsP50).not.toBeNull();
    expect(summary.durationMsP95).not.toBeNull();
    expect(summary.durationMsP99).not.toBeNull();
    expect(summary.durationMsP50!).toBeLessThanOrEqual(summary.durationMsP95!);
    expect(summary.durationMsP95!).toBeLessThanOrEqual(summary.durationMsP99!);
  }, 30000);

  it('respects maxSampleSize even for a large catalog', async () => {
    const entries: TleEntry[] = [];
    const objectTrendsById = new Map<number, ObjectTrend>();
    for (let id = 1; id <= 200; id++) {
      entries.push(makeEntry(id, 500));
      objectTrendsById.set(id, makeTrend(id, 'stable', 'stable', 500));
    }

    const summary = await evaluatePythonComputeShadow(entries, objectTrendsById, 1, {
      sampleRate: 0.5,
      maxSampleSize: 10,
      timeoutMs: 5000,
    });

    expect(summary.sampledCount).toBeLessThanOrEqual(10);
  }, 30000);
});
