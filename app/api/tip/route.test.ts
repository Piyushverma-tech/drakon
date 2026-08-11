jest.mock('@/lib/tip/tipStore', () => ({
  getTipPredictions: jest.fn(),
  refreshTipPredictionsInRedis: jest.fn(),
}));

import {
  getTipPredictions,
  refreshTipPredictionsInRedis,
} from '@/lib/tip/tipStore';
import { GET, POST } from './route';
import type { TipPrediction } from '@/lib/types';

const mockedGet = getTipPredictions as jest.MockedFunction<
  typeof getTipPredictions
>;
const mockedRefresh = refreshTipPredictionsInRedis as jest.MockedFunction<
  typeof refreshTipPredictionsInRedis
>;

const SAMPLE: TipPrediction = {
  noradId: 40589,
  decayEpoch: '2026-08-12T12:00:00.000Z',
  windowMinutes: 60,
  msgEpoch: null,
  insertEpoch: '2026-08-11T10:05:00.000Z',
  direction: null,
  lat: null,
  lon: null,
  highInterest: false,
};

describe('GET /api/tip', () => {
  beforeEach(() => {
    mockedGet.mockReset();
  });

  it('returns predictions and refreshedAt from the Redis envelope', async () => {
    mockedGet.mockResolvedValueOnce({
      byNoradId: new Map([[40589, SAMPLE]]),
      refreshedAt: '2026-08-11T11:00:00.000Z',
    });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      predictions: [SAMPLE],
      refreshedAt: '2026-08-11T11:00:00.000Z',
    });
  });

  it('returns an empty list when TIP data is absent', async () => {
    mockedGet.mockResolvedValueOnce({
      byNoradId: new Map(),
      refreshedAt: null,
    });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ predictions: [], refreshedAt: null });
  });
});

describe('POST /api/tip', () => {
  const originalSecret = process.env.INTERNAL_JOB_SECRET;

  beforeEach(() => {
    mockedRefresh.mockReset();
    process.env.INTERNAL_JOB_SECRET = 'test-secret';
  });

  afterEach(() => {
    process.env.INTERNAL_JOB_SECRET = originalSecret;
  });

  it('rejects missing or wrong x-internal-secret', async () => {
    const missing = await POST(new Request('http://localhost/api/tip', { method: 'POST' }));
    expect(missing.status).toBe(401);

    const wrong = await POST(
      new Request('http://localhost/api/tip', {
        method: 'POST',
        headers: { 'x-internal-secret': 'nope' },
      })
    );
    expect(wrong.status).toBe(401);
    expect(mockedRefresh).not.toHaveBeenCalled();
  });

  it('returns 502 when refresh fails', async () => {
    mockedRefresh.mockResolvedValueOnce(null);

    const res = await POST(
      new Request('http://localhost/api/tip', {
        method: 'POST',
        headers: { 'x-internal-secret': 'test-secret' },
      })
    );

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'TIP refresh failed' });
  });

  it('returns count and refreshedAt on success', async () => {
    mockedRefresh.mockResolvedValueOnce({
      count: 2,
      refreshedAt: '2026-08-11T12:00:00.000Z',
    });

    const res = await POST(
      new Request('http://localhost/api/tip', {
        method: 'POST',
        headers: { 'x-internal-secret': 'test-secret' },
      })
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      count: 2,
      refreshedAt: '2026-08-11T12:00:00.000Z',
    });
  });
});
