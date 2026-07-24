import redis from '@/lib/redis';
import { parseTleText } from '@/lib/tle';
import type { TleEntry } from '@/lib/types';
import { spacetrackProvider } from './spacetrack';

// Phase 1 of the migration plan (§12): fetch from Space-Track alongside the
// unchanged CelesTrak path and log a diff — object count, IDs each source
// has that the other doesn't — without acting on it in any way. This must
// never affect the CelesTrak ingest path it runs alongside.
//
// Gate independently of the /api/tle Redis cache TTL: that cache is tuned
// for freshness (2h), not for Space-Track's own GP retrieval guidance
// (§4 — 1/hour, explicit suspension warning for exceeding it). Concurrent
// requests racing a cache miss could otherwise trigger more than one
// shadow fetch inside the same hour, so this takes its own short-lived
// Redis lock first.
const SHADOW_LOCK_KEY = 'tle:shadow:spacetrack:lock';
const SHADOW_LOCK_TTL_SECONDS = 55 * 60; // stay under Space-Track's 1/hour guidance
const DIFF_SAMPLE_SIZE = 20; // cap logged IDs so log lines stay bounded

export async function logSpaceTrackShadowDiff(
  celestrakEntries: TleEntry[]
): Promise<void> {
  try {
    const acquired = await redis.set(SHADOW_LOCK_KEY, '1', {
      nx: true,
      ex: SHADOW_LOCK_TTL_SECONDS,
    });
    if (!acquired) {
      console.log('[TLE][shadow] Skipping — shadow fetch ran within the last hour');
      return;
    }

    const result = await spacetrackProvider.fetch({});
    const spacetrackEntries = parseTleText(result.raw);

    const celestrakIds = new Set(celestrakEntries.map((e) => e.id));
    const spacetrackIds = new Set(spacetrackEntries.map((e) => e.id));

    const onlyInSpaceTrack = [...spacetrackIds].filter(
      (id) => !celestrakIds.has(id)
    );
    const onlyInCelesTrak = [...celestrakIds].filter(
      (id) => !spacetrackIds.has(id)
    );

    console.log('[TLE][shadow] Space-Track vs CelesTrak diff:', {
      celestrakCount: celestrakIds.size,
      spacetrackCount: spacetrackIds.size,
      onlyInSpaceTrackCount: onlyInSpaceTrack.length,
      onlyInCelesTrakCount: onlyInCelesTrak.length,
      onlyInSpaceTrackSample: onlyInSpaceTrack.slice(0, DIFF_SAMPLE_SIZE),
      onlyInCelesTrakSample: onlyInCelesTrak.slice(0, DIFF_SAMPLE_SIZE),
    });
  } catch (err) {
    // Never let a shadow-mode failure surface anywhere near the real path.
    console.warn(
      '[TLE][shadow] Space-Track shadow fetch failed (non-fatal):',
      err
    );
  }
}
