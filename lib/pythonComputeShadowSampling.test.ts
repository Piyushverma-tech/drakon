import {
  selectStratifiedNoradIds,
  selectStratifiedShadowSample,
  type ShadowSampleCandidate,
} from './pythonComputeShadowSampling';
import type { ObjectTrend, TleEntry } from './types';

function makeEntry(id: number): TleEntry {
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
    perigeeKm: 400,
    apogeeKm: 420,
    semiMajorAxisKm: 6778,
    tleEpoch: '2026-01-01T00:00:00.000Z',
    isDebris: false,
  };
}

function makeTrend(
  noradId: number,
  reentryTier: ObjectTrend['reentryTier'],
  decaySignal: ObjectTrend['decaySignal']
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
    perigeeLatest: 400,
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

// Deterministic PRNG (mulberry32) so tests are exactly reproducible without
// relying on Math.random.
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildCandidates(spec: [ObjectTrend['reentryTier'], ObjectTrend['decaySignal'], number][]): ShadowSampleCandidate[] {
  const candidates: ShadowSampleCandidate[] = [];
  let id = 1;
  for (const [tier, signal, count] of spec) {
    for (let i = 0; i < count; i++) {
      candidates.push({ noradId: id, entry: makeEntry(id), trend: makeTrend(id, tier, signal) });
      id++;
    }
  }
  return candidates;
}

describe('selectStratifiedShadowSample', () => {
  it('returns empty for empty input', () => {
    expect(selectStratifiedShadowSample([], { sampleRate: 0.2, maxSampleSize: 25 })).toEqual([]);
  });

  it('returns empty when maxSampleSize is 0', () => {
    const candidates = buildCandidates([['stable', 'stable', 10]]);
    expect(
      selectStratifiedShadowSample(candidates, { sampleRate: 0.2, maxSampleSize: 0 })
    ).toEqual([]);
  });

  it('never exceeds maxSampleSize even with a huge catalog', () => {
    const candidates = buildCandidates([
      ['stable', 'stable', 1000],
      ['nominal', 'decaying', 500],
      ['warning', 'decaying', 100],
      ['critical', 'decaying', 20],
    ]);
    const sample = selectStratifiedShadowSample(candidates, {
      sampleRate: 0.15,
      maxSampleSize: 25,
      random: seededRandom(1),
    });
    expect(sample.length).toBeLessThanOrEqual(25);
  });

  it('never exceeds a stratum size when the stratum is tiny', () => {
    const candidates = buildCandidates([
      ['critical', 'decaying', 2], // tiny stratum
      ['stable', 'stable', 500],
    ]);
    const sample = selectStratifiedShadowSample(candidates, {
      sampleRate: 0.5,
      maxSampleSize: 25,
      random: seededRandom(2),
    });
    const criticalCount = sample.filter((c) => c.trend?.reentryTier === 'critical').length;
    expect(criticalCount).toBeLessThanOrEqual(2);
  });

  it('represents every non-empty stratum at least once when the cap allows it', () => {
    const candidates = buildCandidates([
      ['critical', 'decaying', 3], // rare but important
      ['warning', 'decaying', 5],
      ['nominal', 'decaying', 50],
      ['stable', 'stable', 2000], // by far the largest stratum
    ]);
    const sample = selectStratifiedShadowSample(candidates, {
      sampleRate: 0.05, // low rate -- a pure proportional sample could easily miss 'critical' entirely
      maxSampleSize: 25,
      random: seededRandom(3),
    });
    const tiers = new Set(sample.map((c) => c.trend?.reentryTier));
    expect(tiers.has('critical')).toBe(true);
    expect(tiers.has('warning')).toBe(true);
    expect(tiers.has('nominal')).toBe(true);
    expect(tiers.has('stable')).toBe(true);
  });

  it('includes a "no_trend" stratum for entries with no matching trend row', () => {
    const candidates = buildCandidates([['stable', 'stable', 20]]);
    candidates.push({ noradId: 9001, entry: makeEntry(9001), trend: undefined });
    candidates.push({ noradId: 9002, entry: makeEntry(9002), trend: undefined });
    const sample = selectStratifiedShadowSample(candidates, {
      sampleRate: 0.5,
      maxSampleSize: 25,
      random: seededRandom(4),
    });
    expect(sample.some((c) => c.trend === undefined)).toBe(true);
  });

  it('approximately respects sampleRate proportions when there is no cap pressure', () => {
    const candidates = buildCandidates([['stable', 'stable', 200]]);
    const sample = selectStratifiedShadowSample(candidates, {
      sampleRate: 0.1,
      maxSampleSize: 1000, // cap far above what 10% of 200 would need
      random: seededRandom(5),
    });
    expect(sample.length).toBe(20); // round(200 * 0.1)
  });

  it('is deterministic given the same seeded random source', () => {
    const candidates = buildCandidates([
      ['critical', 'decaying', 5],
      ['stable', 'stable', 100],
    ]);
    const a = selectStratifiedShadowSample(candidates, {
      sampleRate: 0.1,
      maxSampleSize: 25,
      random: seededRandom(42),
    });
    const b = selectStratifiedShadowSample(candidates, {
      sampleRate: 0.1,
      maxSampleSize: 25,
      random: seededRandom(42),
    });
    expect(a.map((c) => c.noradId)).toEqual(b.map((c) => c.noradId));
  });

  it('produces a different sample with a different seed (sanity check it is not silently constant)', () => {
    const candidates = buildCandidates([['stable', 'stable', 200]]);
    const a = selectStratifiedShadowSample(candidates, {
      sampleRate: 0.1,
      maxSampleSize: 25,
      random: seededRandom(1),
    });
    const b = selectStratifiedShadowSample(candidates, {
      sampleRate: 0.1,
      maxSampleSize: 25,
      random: seededRandom(2),
    });
    expect(a.map((c) => c.noradId)).not.toEqual(b.map((c) => c.noradId));
  });

  it('every returned candidate actually belongs to the input set (no duplication, no fabrication)', () => {
    const candidates = buildCandidates([
      ['critical', 'decaying', 5],
      ['warning', 'maneuvering', 8],
      ['stable', 'stable', 300],
    ]);
    const sample = selectStratifiedShadowSample(candidates, {
      sampleRate: 0.2,
      maxSampleSize: 25,
      random: seededRandom(7),
    });
    const inputIds = new Set(candidates.map((c) => c.noradId));
    const seen = new Set<number>();
    for (const c of sample) {
      expect(inputIds.has(c.noradId)).toBe(true);
      expect(seen.has(c.noradId)).toBe(false); // no duplicates
      seen.add(c.noradId);
    }
  });
});

describe('selectStratifiedNoradIds', () => {
  function buildLightRows(
    spec: [ObjectTrend['reentryTier'], ObjectTrend['decaySignal'], number][]
  ): { noradId: number; stratumKey: string }[] {
    const rows: { noradId: number; stratumKey: string }[] = [];
    let id = 1;
    for (const [tier, signal, count] of spec) {
      for (let i = 0; i < count; i++) {
        rows.push({ noradId: id, stratumKey: `${tier}:${signal}` });
        id++;
      }
    }
    return rows;
  }

  it('never exceeds maxSampleSize', () => {
    const rows = buildLightRows([
      ['stable', 'stable', 1000],
      ['critical', 'decaying', 20],
    ]);
    const ids = selectStratifiedNoradIds(rows, {
      sampleRate: 0.15,
      maxSampleSize: 25,
      random: seededRandom(1),
    });
    expect(ids.length).toBeLessThanOrEqual(25);
  });

  it('returns unique, valid noradIds only', () => {
    const rows = buildLightRows([
      ['critical', 'decaying', 5],
      ['stable', 'stable', 300],
    ]);
    const ids = selectStratifiedNoradIds(rows, {
      sampleRate: 0.2,
      maxSampleSize: 25,
      random: seededRandom(9),
    });
    const validIds = new Set(rows.map((r) => r.noradId));
    const seen = new Set<number>();
    for (const id of ids) {
      expect(validIds.has(id)).toBe(true);
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
  });

  it('produces the same selection as selectStratifiedShadowSample given equivalent data and seed', () => {
    // Two views of the same underlying population: the lightweight
    // {noradId, stratumKey} rows loadCurrentTrendSample() queries for,
    // and the full ShadowSampleCandidate shape selectStratifiedShadowSample
    // works with. Both should select the identical set of noradIds when
    // driven by the same seed, since they share the same core algorithm --
    // this is the property that makes it safe for lib/shadowCatalog.ts to
    // sample on the light rows and fetch full data only for the winners.
    const tiers: [ObjectTrend['reentryTier'], ObjectTrend['decaySignal'], number][] = [
      ['critical', 'decaying', 4],
      ['warning', 'decaying', 6],
      ['nominal', 'decaying', 40],
      ['stable', 'stable', 200],
    ];

    const lightRows = buildLightRows(tiers);

    const candidates: ShadowSampleCandidate[] = [];
    let id = 1;
    for (const [tier, signal, count] of tiers) {
      for (let i = 0; i < count; i++) {
        candidates.push({
          noradId: id,
          entry: {} as TleEntry, // shape irrelevant to sampling itself
          trend: { reentryTier: tier, decaySignal: signal } as ObjectTrend,
        });
        id++;
      }
    }

    const idsFromLight = selectStratifiedNoradIds(lightRows, {
      sampleRate: 0.1,
      maxSampleSize: 25,
      random: seededRandom(123),
    });
    const idsFromFull = selectStratifiedShadowSample(candidates, {
      sampleRate: 0.1,
      maxSampleSize: 25,
      random: seededRandom(123),
    }).map((c) => c.noradId);

    expect([...idsFromLight].sort((a, b) => a - b)).toEqual(
      [...idsFromFull].sort((a, b) => a - b)
    );
  });
});
