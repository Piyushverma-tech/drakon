jest.mock('@/lib/redis', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  },
}));

import redis from '@/lib/redis';
import {
  extractSessionCookie,
  getSpaceTrackSession,
  invalidateSpaceTrackSession,
} from './session';

const mockedRedis = redis as jest.Mocked<typeof redis>;

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

describe('getSpaceTrackSession', () => {
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

  it('authenticates when no cached session exists and stores the cookie', async () => {
    mockedRedis.get.mockResolvedValueOnce(null);
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      headers: {
        get: (name: string) =>
          name === 'set-cookie' ? 'chocolatechip=tok; Path=/; HttpOnly' : null,
      },
    });

    const cookie = await getSpaceTrackSession();

    expect(cookie).toBe('chocolatechip=tok');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://www.space-track.org/ajaxauth/login',
      expect.objectContaining({ method: 'POST' })
    );
    expect(mockedRedis.set).toHaveBeenCalledWith(
      'spacetrack:session_cookie',
      'chocolatechip=tok',
      { ex: 60 * 60 * 2 }
    );
  });

  it('reuses a cached session and skips the login call', async () => {
    mockedRedis.get.mockResolvedValueOnce('chocolatechip=cached');

    const cookie = await getSpaceTrackSession();

    expect(cookie).toBe('chocolatechip=cached');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('throws when auth fails', async () => {
    mockedRedis.get.mockResolvedValueOnce(null);
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 401 });

    await expect(getSpaceTrackSession()).rejects.toThrow(/auth failed/);
  });

  it('throws when auth response has no session cookie', async () => {
    mockedRedis.get.mockResolvedValueOnce(null);
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => null },
    });

    await expect(getSpaceTrackSession()).rejects.toThrow(/no session cookie/);
  });
});

describe('invalidateSpaceTrackSession', () => {
  beforeEach(() => {
    mockedRedis.del.mockReset();
  });

  it('deletes the cached session cookie', async () => {
    await invalidateSpaceTrackSession();
    expect(mockedRedis.del).toHaveBeenCalledWith('spacetrack:session_cookie');
  });
});
