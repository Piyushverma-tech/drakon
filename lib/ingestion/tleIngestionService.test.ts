jest.mock('@/lib/redis', () => ({
  __esModule: true,
  default: { get: jest.fn(), set: jest.fn(), del: jest.fn() },
}));

jest.mock('@/lib/jobs/ingestTleHistory', () => ({
  ingestTleHistory: jest.fn(),
}));

jest.mock('@/lib/tle-providers', () => ({
  celestrakProvider: { name: 'celestrak', fetch: jest.fn() },
  getPrimaryProvider: jest.fn(),
  getFallbackProvider: jest.fn(),
}));

import redis from '@/lib/redis';
import { ingestTleHistory } from '@/lib/jobs/ingestTleHistory';
import {
  celestrakProvider,
  getPrimaryProvider,
  getFallbackProvider,
} from '@/lib/tle-providers';
import { runIngestionCycle } from './tleIngestionService';

const mockedRedis = redis as jest.Mocked<typeof redis>;
const mockedIngest = ingestTleHistory as jest.Mock;
const mockedDebrisFetch = celestrakProvider.fetch as jest.Mock;
const mockedGetPrimary = getPrimaryProvider as jest.Mock;
const mockedGetFallback = getFallbackProvider as jest.Mock;

// Minimal, valid 3LE block for a given 5-digit NORAD id.
function tle(id: number, name = `OBJ-${id}`): string {
  const idStr = String(id).padStart(5, '0');
  return `${name}\n1 ${idStr}U 98067A   26199.50000000  .00016717  00000-0  10270-3 0  9994\n2 ${idStr}  51.6400 208.9163 0007540  69.9862  25.2906 15.49560000123456\n`;
}

// A debris fetch that clears every group's DEBRIS_GROUP_MIN_HEALTHY floor
// (max 500), for tests that need pruning to actually be eligible rather
// than skipped for being "unhealthy". Returned for all three group calls
// via mockResolvedValue, so each group individually sees this same
// 601-object fixture. Always includes tle(99, 'DEBRIS') specifically so
// existing assertions checking for that exact id/name keep working.
function healthyDebrisRaw(): string {
  let raw = tle(99, 'DEBRIS');
  for (let i = 0; i < 600; i++) raw += tle(90000 + i, `DEBRIS-${i}`);
  return raw;
}

function fetchResult(raw: string, provider: string) {
  return { raw, provider, fetchedAt: new Date(), objectCount: 0 };
}

describe('runIngestionCycle', () => {
  let spacetrackFetch: jest.Mock;
  let celestrakFallbackFetch: jest.Mock;

  beforeEach(() => {
    mockedRedis.get.mockReset();
    mockedRedis.set.mockReset();
    mockedRedis.del.mockReset();
    mockedIngest.mockReset();
    mockedDebrisFetch.mockReset();
    mockedGetPrimary.mockReset();
    mockedGetFallback.mockReset();

    spacetrackFetch = jest.fn();
    celestrakFallbackFetch = jest.fn();

    mockedGetPrimary.mockReturnValue({
      name: 'spacetrack',
      fetch: spacetrackFetch,
    });
    mockedGetFallback.mockReturnValue({
      name: 'celestrak',
      fetch: celestrakFallbackFetch,
    });

    mockedIngest.mockResolvedValue({ inserted: 0, skipped: 0, invalid: 0 });
    mockedDebrisFetch.mockResolvedValue(fetchResult('', 'celestrak'));

    // Default: lock acquisition succeeds.
    mockedRedis.set.mockImplementation(async (key: string) => {
      if (key === 'tle:ingestion:lock') return 'OK';
      return 'OK';
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it('skips the cycle entirely when the ingestion lock is already held', async () => {
    mockedRedis.set.mockImplementation(async (key: string) =>
      key === 'tle:ingestion:lock' ? null : 'OK'
    );

    const result = await runIngestionCycle();

    expect(result).toEqual({ skipped: true });
    expect(spacetrackFetch).not.toHaveBeenCalled();
    expect(mockedDebrisFetch).not.toHaveBeenCalled();
  });

  it('queries all static debris groups every cycle', async () => {
    mockedRedis.get.mockResolvedValue(null); // cold start
    spacetrackFetch.mockResolvedValue(fetchResult(tle(1), 'spacetrack'));
    mockedDebrisFetch.mockResolvedValue(
      fetchResult(healthyDebrisRaw(), 'celestrak')
    );

    await runIngestionCycle();

    const groupsQueried = mockedDebrisFetch.mock.calls.map(
      (c) => c[0].groups[0]
    );
    expect(groupsQueried).toEqual([
      'iridium-33-debris',
      'cosmos-2251-debris',
      'fengyun-1c-debris',
    ]);
  });

  it('always releases the lock, even when both primary and fallback fail', async () => {
    mockedRedis.get.mockResolvedValue(null); // no last-resync, no existing snapshot
    spacetrackFetch.mockRejectedValue(new Error('spacetrack down'));
    celestrakFallbackFetch.mockRejectedValue(new Error('celestrak down too'));

    await expect(runIngestionCycle()).rejects.toThrow('celestrak down too');

    expect(mockedRedis.del).toHaveBeenCalledWith('tle:ingestion:lock');
  });

  it('merges a fresh primary fetch into an empty snapshot and labels history rows per source', async () => {
    mockedRedis.get.mockResolvedValue(null); // cold start: no last-resync, no existing snapshot
    spacetrackFetch.mockResolvedValue(fetchResult(tle(1), 'spacetrack'));
    mockedDebrisFetch.mockResolvedValue(
      fetchResult(healthyDebrisRaw(), 'celestrak')
    );

    const result = await runIngestionCycle();

    expect(result).toMatchObject({
      skipped: false,
      provider: 'spacetrack',
      fullResync: true,
      snapshotSize: 602, // 1 primary + 601 debris (tle(99) + 600 generated)
    });

    // Provenance: two separate ingestTleHistory calls, not one mixed batch.
    expect(mockedIngest).toHaveBeenCalledTimes(2);
    const [primaryCall, debrisCall] = mockedIngest.mock.calls;
    expect(primaryCall[1]).toBe('spacetrack');
    expect(primaryCall[0]).toHaveLength(1);
    expect(debrisCall[1]).toBe('celestrak:debris');
    expect(debrisCall[0]).toHaveLength(601);

    // Snapshot written to both cache keys.
    const cacheWrite = mockedRedis.set.mock.calls.find(
      (c) => c[0] === 'tle:combined'
    );
    expect(cacheWrite).toBeDefined();
    expect(cacheWrite![1]).toContain('OBJ-1');
    expect(cacheWrite![1]).toContain('DEBRIS');
  });

  it('preserves objects from the existing snapshot that this cycle did not refetch (windowed poll, no resync)', async () => {
    mockedRedis.get.mockImplementation(async (key: string) => {
      if (key === 'tle:last_full_resync') return new Date().toISOString(); // resync not due
      if (key === 'tle:combined') return tle(1) + tle(2); // pre-existing snapshot
      return null;
    });
    spacetrackFetch.mockResolvedValue(fetchResult(tle(1), 'spacetrack')); // only object 1 in this window

    const result = await runIngestionCycle();

    expect(result).toMatchObject({ fullResync: false, snapshotSize: 2 });
    const cacheWrite = mockedRedis.set.mock.calls.find(
      (c) => c[0] === 'tle:combined'
    );
    // Object 2 wasn't in this cycle's fetch, but a non-resync cycle must
    // never drop it — only an authoritative full resync can prune.
    expect(cacheWrite![1]).toContain('OBJ-2');
  });

  it('prunes objects missing from a full resync, but exempts static debris', async () => {
    mockedRedis.get.mockImplementation(async (key: string) => {
      if (key === 'tle:last_full_resync') return null; // resync due
      if (key === 'tle:combined') return tle(1) + tle(2) + tle(99, 'DEBRIS');
      return null;
    });
    spacetrackFetch.mockResolvedValue(fetchResult(tle(1), 'spacetrack')); // object 2 has decayed off the catalog
    mockedDebrisFetch.mockResolvedValue(
      fetchResult(healthyDebrisRaw(), 'celestrak')
    );

    const result = await runIngestionCycle();

    expect(result).toMatchObject({ fullResync: true, snapshotSize: 602 }); // obj 1 + 601 debris, obj 2 dropped
    const cacheWrite = mockedRedis.set.mock.calls.find(
      (c) => c[0] === 'tle:combined'
    );
    expect(cacheWrite![1]).toContain('OBJ-1');
    expect(cacheWrite![1]).toContain('DEBRIS');
    expect(cacheWrite![1]).not.toContain('OBJ-2');
    expect(mockedRedis.set).toHaveBeenCalledWith(
      'tle:last_full_resync',
      expect.any(String)
    );
  });

  it('falls back to CelesTrak when the primary fails, and never prunes on a fallback cycle', async () => {
    mockedRedis.get.mockImplementation(async (key: string) => {
      if (key === 'tle:last_full_resync') return null; // resync would be due...
      if (key === 'tle:combined') return tle(1) + tle(2);
      return null;
    });
    spacetrackFetch.mockRejectedValue(new Error('spacetrack auth failed'));
    celestrakFallbackFetch.mockResolvedValue(fetchResult(tle(1), 'celestrak')); // only sees object 1

    const result = await runIngestionCycle();

    expect(celestrakFallbackFetch).toHaveBeenCalledWith({ groups: ['active'] });
    expect(result).toMatchObject({
      provider: 'celestrak (fallback)',
      fullResync: false, // ...but a fallback result is never authoritative enough to prune
      snapshotSize: 2, // object 2 preserved despite not being in the fallback result
    });
    expect(mockedRedis.set).not.toHaveBeenCalledWith(
      'tle:last_full_resync',
      expect.any(String)
    );
  });

  it('normalizes an escaped-newline snapshot before merging, instead of silently dropping it', async () => {
    const existingEscaped = (tle(1) + tle(2)).replace(/\n/g, '\\n');
    mockedRedis.get.mockImplementation(async (key: string) => {
      if (key === 'tle:last_full_resync') return new Date().toISOString();
      if (key === 'tle:combined') return existingEscaped;
      return null;
    });
    spacetrackFetch.mockResolvedValue(fetchResult(tle(1), 'spacetrack'));

    const result = await runIngestionCycle();

    // If normalization were missing, parseTleText(existingEscaped) would
    // yield zero entries and object 2 would vanish from the snapshot.
    expect(result).toMatchObject({ snapshotSize: 2 });
  });

  it('does not prune when TLE_PROVIDER=celestrak makes CelesTrak the deliberate primary (finding 1)', async () => {
    // getPrimaryProvider() would return celestrakProvider in this config,
    // and it succeeds outright -- no fallback involved at all.
    mockedGetPrimary.mockReturnValue({
      name: 'celestrak',
      fetch: celestrakFallbackFetch,
    });
    mockedGetFallback.mockReturnValue({
      name: 'spacetrack',
      fetch: spacetrackFetch,
    });

    mockedRedis.get.mockImplementation(async (key: string) => {
      if (key === 'tle:last_full_resync') return null; // resync due
      // A Space-Track-only object from a previous cycle, before this
      // deliberate config change to CelesTrak-primary.
      if (key === 'tle:combined') return tle(1) + tle(2);
      return null;
    });
    // CelesTrak's curated `active` group only ever returns object 1 --
    // object 2 is exactly the kind of Space-Track-only object CelesTrak's
    // narrower curation doesn't carry.
    celestrakFallbackFetch.mockResolvedValue(fetchResult(tle(1), 'celestrak'));
    mockedDebrisFetch.mockResolvedValue(
      fetchResult(healthyDebrisRaw(), 'celestrak')
    );

    const result = await runIngestionCycle();

    expect(result).toMatchObject({
      provider: 'celestrak', // succeeded outright, not "(fallback)"
      fullResync: false, // must NOT report a real resync happened
      snapshotSize: 603, // obj 1 + obj 2 (preserved!) + 601 debris
    });
    const cacheWrite = mockedRedis.set.mock.calls.find(
      (c) => c[0] === 'tle:combined'
    );
    // The critical assertion: object 2 must survive even though it's
    // missing from this cycle's (deliberately CelesTrak) primary fetch.
    expect(cacheWrite![1]).toContain('OBJ-2');
    expect(mockedRedis.set).not.toHaveBeenCalledWith(
      'tle:last_full_resync',
      expect.any(String)
    );
  });

  it('skips pruning entirely when the debris fetch looks unhealthy, even on an otherwise-eligible resync (finding 2)', async () => {
    mockedRedis.get.mockImplementation(async (key: string) => {
      if (key === 'tle:last_full_resync') return null; // resync due
      if (key === 'tle:combined') return tle(1) + tle(2) + tle(99, 'DEBRIS');
      return null;
    });
    spacetrackFetch.mockResolvedValue(fetchResult(tle(1), 'spacetrack')); // object 2 legitimately gone
    // CelesTrak having a bad day across all three groups -- each group's
    // fetch returns just 1 object, well under its own DEBRIS_GROUP_MIN_HEALTHY
    // floor. Without the guard, object 99 (missing from this degraded fetch)
    // would incorrectly be pruned since it's also absent from the
    // Space-Track-scoped freshIds.
    mockedDebrisFetch.mockResolvedValue(
      fetchResult(tle(50, 'LONE-DEBRIS'), 'celestrak')
    );

    const result = await runIngestionCycle();

    expect(result).toMatchObject({ fullResync: false });
    const cacheWrite = mockedRedis.set.mock.calls.find(
      (c) => c[0] === 'tle:combined'
    );
    // object 2 and the original debris object 99 both survive -- pruning
    // never ran this cycle at all, despite doFullResync/spacetrack/no
    // fallback all otherwise lining up.
    expect(cacheWrite![1]).toContain('OBJ-2');
    expect(cacheWrite![1]).toContain('DEBRIS');
    expect(mockedRedis.set).not.toHaveBeenCalledWith(
      'tle:last_full_resync',
      expect.any(String)
    );
  });

  it('skips pruning when only ONE debris group fails, even though the combined count would look healthy (audit finding)', async () => {
    mockedRedis.get.mockImplementation(async (key: string) => {
      if (key === 'tle:last_full_resync') return null; // resync due
      if (key === 'tle:combined')
        return tle(1) + tle(2) + tle(70, 'IRIDIUM-DEBRIS-OLD');
      return null;
    });
    spacetrackFetch.mockResolvedValue(fetchResult(tle(1), 'spacetrack')); // object 2 legitimately gone

    // iridium-33-debris (the smallest group, ~110 in production) returns
    // nothing this cycle; cosmos-2251-debris and fengyun-1c-debris are both
    // fully healthy. A combined-total floor (the pre-fix design) would sum
    // these to well over 500 and call the debris fetch "healthy" -- the
    // per-group floor must not.
    mockedDebrisFetch.mockImplementation(async (opts: { groups: string[] }) => {
      const [group] = opts.groups;
      if (group === 'iridium-33-debris') return fetchResult('', 'celestrak');
      return fetchResult(healthyDebrisRaw(), 'celestrak');
    });

    const result = await runIngestionCycle();

    expect(result).toMatchObject({ fullResync: false });
    const cacheWrite = mockedRedis.set.mock.calls.find(
      (c) => c[0] === 'tle:combined'
    );
    // object 2 and the pre-existing iridium debris object both survive --
    // pruning never ran this cycle, even though cosmos+fengyun alone would
    // have cleared the old combined floor of 500 with room to spare.
    expect(cacheWrite![1]).toContain('OBJ-2');
    expect(cacheWrite![1]).toContain('IRIDIUM-DEBRIS-OLD');
    expect(mockedRedis.set).not.toHaveBeenCalledWith(
      'tle:last_full_resync',
      expect.any(String)
    );
  });

  it('never marks a resync as done if a write after the prune decision fails (finding 4)', async () => {
    mockedRedis.get.mockImplementation(async (key: string) => {
      if (key === 'tle:last_full_resync') return null; // resync due
      if (key === 'tle:combined') return tle(1);
      return null;
    });
    spacetrackFetch.mockResolvedValue(fetchResult(tle(1), 'spacetrack'));
    mockedDebrisFetch.mockResolvedValue(
      fetchResult(healthyDebrisRaw(), 'celestrak')
    );
    // Everything up through the Redis snapshot writes succeeds; the
    // primary ingestTleHistory call is what fails, simulating a Postgres
    // hiccup mid-cycle.
    mockedIngest.mockRejectedValueOnce(new Error('db hiccup'));

    await expect(runIngestionCycle()).rejects.toThrow('db hiccup');

    // The whole point: even though canPrune was true for this cycle, the
    // marker must never be written if the cycle didn't actually finish --
    // otherwise the next 24h would skip full resyncs believing this one
    // succeeded.
    expect(mockedRedis.set).not.toHaveBeenCalledWith(
      'tle:last_full_resync',
      expect.any(String)
    );
    // Lock still released despite the failure.
    expect(mockedRedis.del).toHaveBeenCalledWith('tle:ingestion:lock');
  });
});
