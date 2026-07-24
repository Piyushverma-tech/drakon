jest.mock('@/lib/redis', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  },
}));

import redis from '@/lib/redis';
import { spacetrackProvider, extractSessionCookie } from './spacetrack';

const mockedRedis = redis as jest.Mocked<typeof redis>;

const VALID_3LE = `ISS (ZARYA)\n1 25544U 98067A   26199.50000000  .00016717  00000-0  10270-3 0  9994\n2 25544  51.6400 208.9163 0007540  69.9862  25.2906 15.49560000123456\n`;

describe('extractSessionCookie', () => {
  it('pulls just the name=value pair out of a raw Set-Cookie header', () => {
    const raw =
      'chocolatechip=abc123; Path=/; Expires=Wed, 09 Jun 2027 10:18:14 GMT; HttpOnly';
    expect(extractSessionCookie(raw)).toBe('chocolatechip=abc123');
  });

  it('throws when the header has no chocolatechip cookie', () => {
    expect(() => extractSessionCookie('sessionid=xyz; Path=/')).toThrow(
      /chocolatechip/
    );
  });
});

describe('spacetrackProvider.fetch', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch') as unknown as jest.SpyInstance;
    mockedRedis.get.mockReset();
    mockedRedis.set.mockReset();
    mockedRedis.del.mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('authenticates when no cached session exists, then queries with the cookie', async () => {
    mockedRedis.get.mockResolvedValueOnce(null);
    fetchSpy
      .mockResolvedValueOnce({
        ok: true,
        headers: {
          get: (name: string) =>
            name === 'set-cookie' ? 'chocolatechip=tok; Path=/; HttpOnly' : null,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => VALID_3LE,
      });

    const result = await spacetrackProvider.fetch({});

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0][0]).toBe(
      'https://www.space-track.org/ajaxauth/login'
    );
    expect(mockedRedis.set).toHaveBeenCalledWith(
      'spacetrack:session_cookie',
      'chocolatechip=tok',
      { ex: 60 * 60 * 2 }
    );

    const queryUrl = fetchSpy.mock.calls[1][0] as string;
    expect(queryUrl).toContain('OBJECT_TYPE/PAYLOAD,ROCKET BODY');
    expect(queryUrl).toContain('decay_date/null-val');
    expect(queryUrl).toContain('epoch/>now-3'); // HOURLY_WINDOW_DAYS
    expect(queryUrl).toContain('format/3le');
    expect(fetchSpy.mock.calls[1][1]).toEqual({
      headers: { cookie: 'chocolatechip=tok' },
    });

    expect(result.provider).toBe('spacetrack');
    expect(result.objectCount).toBe(1);
  });

  it('reuses a cached session and skips the login call', async () => {
    mockedRedis.get.mockResolvedValueOnce('chocolatechip=cached');
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => VALID_3LE,
    });

    await spacetrackProvider.fetch({});

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('uses the wider resync window when fullResync is set', async () => {
    mockedRedis.get.mockResolvedValueOnce('chocolatechip=cached');
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => VALID_3LE,
    });

    await spacetrackProvider.fetch({ fullResync: true });

    const queryUrl = fetchSpy.mock.calls[0][0] as string;
    expect(queryUrl).toContain('epoch/>now-45'); // RESYNC_WINDOW_DAYS
  });

  it('clears the cached session and throws on a 401', async () => {
    mockedRedis.get.mockResolvedValueOnce('chocolatechip=stale');
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 401 });

    await expect(spacetrackProvider.fetch({})).rejects.toThrow(
      /session rejected/
    );
    expect(mockedRedis.del).toHaveBeenCalledWith('spacetrack:session_cookie');
  });
});
