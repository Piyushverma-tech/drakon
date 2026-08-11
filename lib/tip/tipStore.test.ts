jest.mock('@/lib/redis', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  },
}));

jest.mock('./spacetrackTip', () => ({
  fetchTipPredictions: jest.fn(),
}));

import redis from '@/lib/redis';
import { fetchTipPredictions } from './spacetrackTip';
import {
  TIP_REDIS_KEY,
  TIP_TTL_SECONDS,
  getTipPredictions,
  refreshTipPredictionsInRedis,
} from './tipStore';
import type { TipPrediction } from '@/lib/types';

const mockedRedis = redis as jest.Mocked<typeof redis>;
const mockedFetch = fetchTipPredictions as jest.MockedFunction<
  typeof fetchTipPredictions
>;

const SAMPLE: TipPrediction = {
  noradId: 40589,
  decayEpoch: '2026-08-12T12:00:00.000Z',
  windowMinutes: 60,
  msgEpoch: '2026-08-11T10:00:00.000Z',
  insertEpoch: '2026-08-11T10:05:00.000Z',
  direction: 'ascending',
  lat: 10,
  lon: -20,
  highInterest: false,
};

describe('getTipPredictions', () => {
  beforeEach(() => {
    mockedRedis.get.mockReset();
  });

  it('returns an empty snapshot when the key is missing', async () => {
    mockedRedis.get.mockResolvedValueOnce(null);
    await expect(getTipPredictions()).resolves.toEqual({
      byNoradId: new Map(),
      refreshedAt: null,
    });
  });

  it('round-trips the envelope including refreshedAt', async () => {
    mockedRedis.get.mockResolvedValueOnce({
      predictions: [SAMPLE],
      refreshedAt: '2026-08-11T11:00:00.000Z',
    });

    const snap = await getTipPredictions();
    expect(snap.refreshedAt).toBe('2026-08-11T11:00:00.000Z');
    expect(snap.byNoradId.get(40589)).toEqual(SAMPLE);
  });

  it('degrades to an empty snapshot on Redis error', async () => {
    mockedRedis.get.mockRejectedValueOnce(new Error('redis down'));
    await expect(getTipPredictions()).resolves.toEqual({
      byNoradId: new Map(),
      refreshedAt: null,
    });
  });
});

describe('refreshTipPredictionsInRedis', () => {
  beforeEach(() => {
    mockedRedis.set.mockReset();
    mockedFetch.mockReset();
  });

  it('full-replaces the envelope on success', async () => {
    mockedFetch.mockResolvedValueOnce([SAMPLE]);

    const result = await refreshTipPredictionsInRedis();

    expect(result).toEqual({
      count: 1,
      refreshedAt: expect.any(String),
    });
    expect(mockedRedis.set).toHaveBeenCalledWith(
      TIP_REDIS_KEY,
      {
        predictions: [SAMPLE],
        refreshedAt: result!.refreshedAt,
      },
      { ex: TIP_TTL_SECONDS }
    );
  });

  it('does not call redis.set when fetch fails', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockedFetch.mockRejectedValueOnce(new Error('Space-Track down'));

    const result = await refreshTipPredictionsInRedis();

    expect(result).toBeNull();
    expect(mockedRedis.set).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
