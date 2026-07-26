// Redis cache keys
export const CACHE_KEY = 'tle:combined';
export const STALE_CACHE_KEY = 'tle:combined:stale';
export const CACHE_TTL_SECONDS = 7200;

/**
 * Upstash JSON-encodes all values, which can escape newlines in multiline
 * strings. Anything read back from CACHE_KEY/STALE_CACHE_KEY needs this —
 * whether it's being served straight to a client, or re-parsed server-side
 * (e.g. the ingestion service seeding its merge from the existing
 * snapshot).
 */
export function normalizeNewlines(str: string): string {
  return str
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n');
}
