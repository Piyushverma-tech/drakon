const selectMock = jest.fn();

jest.mock('./db', () => ({
  db: { select: (...args: unknown[]) => selectMock(...args) },
}));

jest.mock('./redis', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

jest.mock('./solarFlux', () => ({
  getSolarFlux: jest.fn(),
}));

jest.mock('./tip/tipStore', () => ({
  getTipPredictions: jest.fn(),
}));

jest.mock('./jobs/computeObjectTrends', () => ({
  CURRENT_TREND_VERSION: 4,
}));

import redis from './redis';
import { getSolarFlux } from './solarFlux';
import { getTipPredictions } from './tip/tipStore';
import {
  loadCurrentTLECatalog,
  loadCurrentTrendSample,
  loadFullCurrentTrendPopulation,
  loadSolarFlux,
  loadTIP,
} from './shadowCatalog';

function makeRow(
  noradId: number,
  reentryTier: string,
  decaySignal: string
): Record<string, unknown> {
  return {
    noradId,
    reentryTier,
    decaySignal,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    estimatedReentryAt: null,
    trendVersion: 4,
    epochsAvailable: 10,
    historyDaysAvailable: 12,
  };
}

// Chainable query-builder mock: db.select(fields).from(table).where(cond)
// resolves to whatever rows this call was configured to return.
function mockSelectChain(rows: unknown[]) {
  selectMock.mockReturnValueOnce({
    from: () => ({
      where: () => Promise.resolve(rows),
    }),
  });
}

beforeEach(() => {
  selectMock.mockReset();
});

describe('loadCurrentTrendSample', () => {
  it('queries a light row set first, then a full row set filtered to only the sampled ids', async () => {
    const lightRows = [
      makeRow(1, 'critical', 'decaying'),
      makeRow(2, 'stable', 'stable'),
      makeRow(3, 'stable', 'stable'),
      makeRow(4, 'stable', 'stable'),
    ].map((r) => ({
      noradId: r.noradId,
      reentryTier: r.reentryTier,
      decaySignal: r.decaySignal,
    }));
    const fullRowForCritical = makeRow(1, 'critical', 'decaying');

    mockSelectChain(lightRows);
    mockSelectChain([fullRowForCritical]); // pretend only norad 1 got sampled

    const result = await loadCurrentTrendSample({
      sampleRate: 1,
      maxSampleSize: 1,
      random: () => 0, // deterministic: first shuffled item stays first
    });

    expect(selectMock).toHaveBeenCalledTimes(2);
    // First call: the narrow field selector (light query) -- only 3 keys.
    const firstCallArg = selectMock.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(firstCallArg).sort()).toEqual([
      'decaySignal',
      'noradId',
      'reentryTier',
    ]);
    // Second call: no field selector at all -- a full SELECT * for the
    // (small) sampled set only.
    expect(selectMock.mock.calls[1]).toEqual([]);

    expect(result.eligibleCount).toBe(4);
    expect(result.trendsById.size).toBe(1);
    expect(result.trendsById.has(1)).toBe(true);
  });

  it('returns an empty map without a second query when the light query is empty', async () => {
    mockSelectChain([]);

    const result = await loadCurrentTrendSample({
      sampleRate: 0.15,
      maxSampleSize: 20,
    });

    expect(selectMock).toHaveBeenCalledTimes(1);
    expect(result.eligibleCount).toBe(0);
    expect(result.trendsById.size).toBe(0);
  });

  it('returns an empty map without a second query when sampling selects nothing', async () => {
    const lightRows = [
      { noradId: 1, reentryTier: 'stable', decaySignal: 'stable' },
    ];
    mockSelectChain(lightRows);

    const result = await loadCurrentTrendSample({
      sampleRate: 0.15,
      maxSampleSize: 0, // cap of 0 -> sampler selects nothing
    });

    expect(selectMock).toHaveBeenCalledTimes(1);
    expect(result.eligibleCount).toBe(1);
    expect(result.trendsById.size).toBe(0);
  });

  it('converts row dates to ISO strings the same way the full-population loader does', async () => {
    const lightRows = [
      { noradId: 5, reentryTier: 'warning', decaySignal: 'decaying' },
    ];
    const fullRow = makeRow(5, 'warning', 'decaying');
    mockSelectChain(lightRows);
    mockSelectChain([fullRow]);

    const result = await loadCurrentTrendSample({
      sampleRate: 1,
      maxSampleSize: 5,
    });

    const trend = result.trendsById.get(5)!;
    expect(trend.updatedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(trend.estimatedReentryAt).toBeNull();
  });
});

describe('loadFullCurrentTrendPopulation', () => {
  it('issues a single full-row query with no field narrowing', async () => {
    const rows = [
      makeRow(1, 'stable', 'stable'),
      makeRow(2, 'critical', 'decaying'),
    ];
    mockSelectChain(rows);

    const result = await loadFullCurrentTrendPopulation();

    expect(selectMock).toHaveBeenCalledTimes(1);
    expect(selectMock.mock.calls[0]).toEqual([]); // no narrowing -- SELECT *
    expect(result.size).toBe(2);
  });
});

describe('loadSolarFlux', () => {
  it('returns just the multiplier', async () => {
    (getSolarFlux as jest.Mock).mockResolvedValueOnce({
      f107: 150,
      multiplier: 1.18,
    });
    await expect(loadSolarFlux()).resolves.toBe(1.18);
  });
});

describe('loadTIP', () => {
  it('returns the byNoradId map from the TIP snapshot', async () => {
    const map = new Map([[1, { noradId: 1 } as never]]);
    (getTipPredictions as jest.Mock).mockResolvedValueOnce({ byNoradId: map });
    await expect(loadTIP()).resolves.toBe(map);
  });
});

describe('loadCurrentTLECatalog', () => {
  it('returns null when neither live nor stale cache has data', async () => {
    (redis.get as jest.Mock).mockResolvedValue(null);
    await expect(loadCurrentTLECatalog()).resolves.toBeNull();
  });
});
