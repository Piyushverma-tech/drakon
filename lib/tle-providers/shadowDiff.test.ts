jest.mock('@/lib/redis', () => ({
  __esModule: true,
  default: { set: jest.fn() },
}));

jest.mock('./spacetrack', () => ({
  spacetrackProvider: { name: 'spacetrack', fetch: jest.fn() },
}));

import redis from '@/lib/redis';
import { spacetrackProvider } from './spacetrack';
import { logSpaceTrackShadowDiff } from './shadowDiff';
import type { TleEntry } from '@/lib/types';

const mockedRedis = redis as jest.Mocked<typeof redis>;
const mockedFetch = spacetrackProvider.fetch as jest.Mock;

function entry(id: number, name = `OBJ-${id}`): TleEntry {
  return {
    id,
    name,
    operator: 'OBJ',
    l1: '',
    l2: '',
    inclination: 0,
    raan: 0,
    argPerigee: 0,
    meanAnomaly: 0,
    meanMotion: 15,
    meanMotionDot: 0,
    tleEpoch: new Date().toISOString(),
    ecc: 0,
    perigeeKm: 500,
    apogeeKm: 500,
    semiMajorAxisKm: 6878,
  };
}

const CONSOLE_METHODS = ['log', 'warn'] as const;

describe('logSpaceTrackShadowDiff', () => {
  let logs: string[];

  beforeEach(() => {
    logs = [];
    mockedRedis.set.mockReset();
    mockedFetch.mockReset();
    CONSOLE_METHODS.forEach((m) =>
      jest.spyOn(console, m).mockImplementation((...args) => {
        logs.push(args.map(String).join(' '));
      })
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('skips the fetch entirely when the shadow lock is already held', async () => {
    mockedRedis.set.mockResolvedValueOnce(null);

    await logSpaceTrackShadowDiff([entry(1)]);

    expect(mockedFetch).not.toHaveBeenCalled();
    expect(logs.some((l) => l.includes('Skipping'))).toBe(true);
  });

  it('logs a diff of IDs unique to each source', async () => {
    mockedRedis.set.mockResolvedValueOnce('OK');

    // parseTleText isn't mocked, so give it real, minimal-but-valid 3LE text
    // via the raw field for entries 1 and 2, expecting entry 3 to be
    // CelesTrak-only in the diff.
    const tle = (id: number) =>
      `OBJ ${id}\n1 ${String(id).padStart(5, '0')}U 98067A   26199.50000000  .00016717  00000-0  10270-3 0  9994\n2 ${String(id).padStart(5, '0')}  51.6400 208.9163 0007540  69.9862  25.2906 15.49560000123456\n`;
    mockedFetch.mockResolvedValueOnce({
      raw: tle(1) + tle(2),
      provider: 'spacetrack',
      fetchedAt: new Date(),
      objectCount: 2,
    });

    await logSpaceTrackShadowDiff([entry(2), entry(3)]);

    const diffLine = logs.find((l) => l.includes('Space-Track vs CelesTrak'));
    expect(diffLine).toBeDefined();
  });

  it('never throws when the Space-Track fetch itself fails', async () => {
    mockedRedis.set.mockResolvedValueOnce('OK');
    mockedFetch.mockRejectedValueOnce(new Error('auth failed'));

    await expect(logSpaceTrackShadowDiff([entry(1)])).resolves.toBeUndefined();
    expect(logs.some((l) => l.includes('non-fatal'))).toBe(true);
  });
});
