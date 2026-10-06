/**
 * Shared constants for lib/shadowRunLock.ts, used by both
 * app/api/internal/python-compute-shadow/route.ts (the merged route,
 * which now runs geomagnetic evaluation internally) and
 * app/api/internal/geomagnetic-shadow/route.ts's scheduled POST (kept
 * for manual triggering; also a safety net if its external cron trigger
 * isn't removed -- see that route's docstring). Centralized here so
 * both sides can't silently drift to different key strings.
 *
 * TTL is intentionally just under the hourly cadence both crons run on:
 * long enough to block a same-window duplicate/retry, short enough to
 * never block the next hour's legitimate run.
 */
export const GEOMAGNETIC_SHADOW_LOCK_KEY = 'locks:geomagnetic-shadow-run';
export const GEOMAGNETIC_SHADOW_LOCK_TTL_SECONDS = 50 * 60;

export const MERGED_SHADOW_RUN_LOCK_KEY = 'locks:merged-shadow-run';
export const MERGED_SHADOW_RUN_LOCK_TTL_SECONDS = 50 * 60;
