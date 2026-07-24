import { celestrakProvider } from './celestrak';

const VALID_TLE = `ISS (ZARYA)\n1 25544U 98067A   26199.50000000  .00016717  00000-0  10270-3 0  9994\n2 25544  51.6400 208.9163 0007540  69.9862  25.2906 15.49560000123456\n`;

describe('celestrakProvider', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch') as unknown as jest.SpyInstance;
    jest.spyOn(global, 'setTimeout').mockImplementation(((
      fn: () => void
    ) => {
      fn();
      return 0 as unknown as NodeJS.Timeout;
    }) as unknown as typeof setTimeout);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('defaults to the active group when none is specified', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      text: async () => VALID_TLE,
    });

    const result = await celestrakProvider.fetch();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain('GROUP=active');
    expect(calledUrl).toContain('FORMAT=3le');
    expect(result.provider).toBe('celestrak');
    expect(result.objectCount).toBe(1);
  });

  it('joins multiple groups and skips ones CelesTrak rejects', async () => {
    fetchSpy
      .mockResolvedValueOnce({ ok: true, text: async () => VALID_TLE })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => 'Invalid query: bad group',
      });

    const result = await celestrakProvider.fetch({
      groups: ['active', 'not-a-real-group'],
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.objectCount).toBe(1);
    expect(result.raw).toContain('ISS (ZARYA)');
  });

  it('does not throw when a group request fails outright', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('network down'));

    const result = await celestrakProvider.fetch({ groups: ['active'] });

    expect(result.objectCount).toBe(0);
    expect(result.raw).toBe('');
  });
});
