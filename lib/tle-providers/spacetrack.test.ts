jest.mock('@/lib/spacetrack/session', () => ({
  getSpaceTrackSession: jest.fn(),
  invalidateSpaceTrackSession: jest.fn(),
  extractSessionCookie: jest.fn(),
}));

import {
  getSpaceTrackSession,
  invalidateSpaceTrackSession,
} from '@/lib/spacetrack/session';
import { spacetrackProvider } from './spacetrack';

const mockedGetSession = getSpaceTrackSession as jest.MockedFunction<
  typeof getSpaceTrackSession
>;
const mockedInvalidate = invalidateSpaceTrackSession as jest.MockedFunction<
  typeof invalidateSpaceTrackSession
>;

const VALID_3LE = `ISS (ZARYA)\n1 25544U 98067A   26199.50000000  .00016717  00000-0  10270-3 0  9994\n2 25544  51.6400 208.9163 0007540  69.9862  25.2906 15.49560000123456\n`;

describe('spacetrackProvider.fetch', () => {
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

  it('queries with the session cookie and the expected predicate shape', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => VALID_3LE,
    });

    const result = await spacetrackProvider.fetch({});

    const queryUrl = fetchSpy.mock.calls[0][0] as string;
    // Space explicitly percent-encoded rather than left for the URL parser
    // to handle implicitly -- comma stays literal (Space-Track's own
    // OR-list separator within the predicate).
    expect(queryUrl).toContain('OBJECT_TYPE/PAYLOAD,ROCKET%20BODY');
    expect(queryUrl).not.toContain('ROCKET BODY');
    expect(queryUrl).toContain('decay_date/null-val');
    expect(queryUrl).toContain('epoch/>now-3'); // HOURLY_WINDOW_DAYS
    expect(queryUrl).toContain('format/3le');
    expect(fetchSpy.mock.calls[0][1]).toEqual({
      headers: { cookie: 'chocolatechip=tok' },
    });

    expect(result.provider).toBe('spacetrack');
    expect(result.objectCount).toBe(1);
  });

  it('uses the wider resync window when fullResync is set', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => VALID_3LE,
    });

    await spacetrackProvider.fetch({ fullResync: true });

    const queryUrl = fetchSpy.mock.calls[0][0] as string;
    expect(queryUrl).toContain('epoch/>now-45'); // RESYNC_WINDOW_DAYS
  });

  it('invalidates the session and throws on a 401', async () => {
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 401 });

    await expect(spacetrackProvider.fetch({})).rejects.toThrow(
      /session rejected/
    );
    expect(mockedInvalidate).toHaveBeenCalled();
  });

  it('throws on a 200 with an empty body instead of silently returning zero entries', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => '',
    });

    await expect(spacetrackProvider.fetch({})).rejects.toThrow(
      /no valid TLE lines/
    );
  });

  it('throws on a 200 with a degraded/non-TLE body', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => '<html>Space-Track is down for maintenance</html>',
    });

    await expect(spacetrackProvider.fetch({})).rejects.toThrow(
      /no valid TLE lines/
    );
  });

  it('does not crash when called with no arguments at all, matching the optional interface', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => VALID_3LE,
    });

    // spacetrackProvider satisfies TLEProvider, whose fetch() takes an
    // optional argument -- calling it with none must not throw a
    // "Cannot read properties of undefined" error.
    const result = await spacetrackProvider.fetch();

    expect(result.objectCount).toBe(1);
    const queryUrl = fetchSpy.mock.calls[0][0] as string;
    expect(queryUrl).toContain('epoch/>now-3'); // HOURLY_WINDOW_DAYS, the non-fullResync default
  });
});
