jest.mock('@/lib/spacetrack/session', () => ({
  getSpaceTrackSession: jest.fn(),
  invalidateSpaceTrackSession: jest.fn(),
}));

import {
  getSpaceTrackSession,
  invalidateSpaceTrackSession,
} from '@/lib/spacetrack/session';
import {
  dedupeLatestTip,
  fetchTipPredictions,
  parseTipRow,
} from './spacetrackTip';
import type { TipPrediction } from '@/lib/types';

const mockedGetSession = getSpaceTrackSession as jest.MockedFunction<
  typeof getSpaceTrackSession
>;
const mockedInvalidate = invalidateSpaceTrackSession as jest.MockedFunction<
  typeof invalidateSpaceTrackSession
>;

function tip(
  overrides: Partial<TipPrediction> & Pick<TipPrediction, 'noradId'>
): TipPrediction {
  return {
    decayEpoch: '2026-08-12T12:00:00.000Z',
    windowMinutes: 60,
    msgEpoch: '2026-08-11T10:00:00.000Z',
    insertEpoch: '2026-08-11T10:05:00.000Z',
    direction: 'ascending',
    lat: 10,
    lon: -20,
    highInterest: false,
    ...overrides,
  };
}

describe('parseTipRow', () => {
  it('normalizes naive Space-Track timestamps to ISO UTC', () => {
    const parsed = parseTipRow({
      NORAD_CAT_ID: '40589',
      DECAY_EPOCH: '2015-09-07 02:28:00',
      WINDOW: '960',
      MSG_EPOCH: '2015-09-06 12:00:00',
      INSERT_EPOCH: '2015-09-06 12:05:00',
      DIRECTION: 'descending',
      LAT: '-45.1',
      LON: '120.5',
      HIGH_INTEREST: 'Y',
    });

    expect(parsed).toEqual({
      noradId: 40589,
      decayEpoch: '2015-09-07T02:28:00.000Z',
      windowMinutes: 960,
      msgEpoch: '2015-09-06T12:00:00.000Z',
      insertEpoch: '2015-09-06T12:05:00.000Z',
      direction: 'descending',
      lat: -45.1,
      lon: 120.5,
      highInterest: true,
    });
  });

  it('returns null when NORAD id or decay epoch is missing', () => {
    expect(parseTipRow({ DECAY_EPOCH: '2015-09-07 02:28:00' })).toBeNull();
    expect(parseTipRow({ NORAD_CAT_ID: '40589' })).toBeNull();
  });
});

describe('dedupeLatestTip', () => {
  it('keeps one row per NORAD_CAT_ID with the latest insertEpoch', () => {
    const rows = [
      tip({
        noradId: 40589,
        insertEpoch: '2015-09-06T12:05:00.000Z',
        windowMinutes: 960,
      }),
      tip({
        noradId: 40589,
        insertEpoch: '2015-09-07T10:00:00.000Z',
        windowMinutes: 1,
      }),
      tip({
        noradId: 99999,
        insertEpoch: '2015-09-07T01:00:00.000Z',
      }),
    ];

    const deduped = dedupeLatestTip(rows);
    expect(deduped).toHaveLength(2);

    const latest = deduped.find((r) => r.noradId === 40589);
    expect(latest?.windowMinutes).toBe(1);
    expect(latest?.insertEpoch).toBe('2015-09-07T10:00:00.000Z');
  });
});

describe('fetchTipPredictions', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch') as unknown as jest.SpyInstance;
    mockedGetSession.mockReset();
    mockedInvalidate.mockReset();
    mockedGetSession.mockResolvedValue('chocolatechip=tok');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('queries class/tip with the expected predicates and accepts an empty array', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [],
    });

    const result = await fetchTipPredictions();

    expect(result).toEqual([]);
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain('/class/tip/');
    expect(url).toContain('decay_epoch/>now');
    expect(url).not.toContain('insert_epoch/>now');
    expect(url).toContain('orderby/INSERT_EPOCH desc');
    expect(url).toContain('format/json');
  });

  it('parses and dedupes raw TIP messages', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [
        {
          NORAD_CAT_ID: 40589,
          DECAY_EPOCH: '2015-09-07 02:28:00',
          WINDOW: '960',
          INSERT_EPOCH: '2015-09-06 12:05:00',
          HIGH_INTEREST: 'N',
        },
        {
          NORAD_CAT_ID: 40589,
          DECAY_EPOCH: '2015-09-07 02:30:00',
          WINDOW: '1',
          INSERT_EPOCH: '2015-09-07 10:00:00',
          HIGH_INTEREST: 'Y',
        },
      ],
    });

    const result = await fetchTipPredictions();
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      noradId: 40589,
      windowMinutes: 1,
      highInterest: true,
      decayEpoch: '2015-09-07T02:30:00.000Z',
    });
  });

  it('invalidates the session and throws on a 401', async () => {
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 401 });

    await expect(fetchTipPredictions()).rejects.toThrow(/session rejected/);
    expect(mockedInvalidate).toHaveBeenCalled();
  });
});
