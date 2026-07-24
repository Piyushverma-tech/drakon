// Shared Redis cache keys for the combined TLE snapshot. Both
// app/api/tle/route.ts (read path) and
// lib/ingestion/tleIngestionService.ts (write path, added in the
// Space-Track migration's Phase 2) must agree on these exactly — see
// DRAKON-SpaceTrack-migration.md §10 ("existing Redis dual-key caching
// pattern — reused as-is").
export const CACHE_KEY = 'tle:combined';
export const STALE_CACHE_KEY = 'tle:combined:stale';
export const CACHE_TTL_SECONDS = 7200;

/**
 * Upstash JSON-encodes all values, which can escape newlines in multiline
 * strings. Anything read back from CACHE_KEY/STALE_CACHE_KEY needs this —
 * whether it's being served straight to a client, or re-parsed server-side
 * (e.g. the ingestion service seeding its merge from the existing
 * snapshot). Skipping it on the re-parse path means parseTleText's 3-line
 * stride silently desyncs on escaped `\n` text instead of real newlines,
 * which would make the existing snapshot parse to zero entries and quietly
 * defeat the merge.
 */
export function normalizeNewlines(str: string): string {
  return str
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n');
}
