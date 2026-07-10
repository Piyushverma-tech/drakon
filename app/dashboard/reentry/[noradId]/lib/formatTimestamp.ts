/**
 * "Computed 1h 12m ago" style, matching the precision already used
 * elsewhere in the dashboard for TLE freshness (e.g. "Latest TLE: 1h 12m
 * ago"). Deliberately precise rather than coarse ("recently") -- the whole
 * point of surfacing this at all is to make staleness checkable, not to
 * imply the page is live.
 */
export function formatRelativeTime(
  iso: string,
  nowMs: number = Date.now()
): string {
  const thenMs = new Date(iso).getTime();
  const diffMs = Math.max(0, nowMs - thenMs);
  const diffMin = Math.floor(diffMs / 60_000);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;

  const hours = Math.floor(diffMin / 60);
  const minutes = diffMin % 60;
  if (hours < 24) return `${hours}h ${minutes}m ago`;

  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return `${days}d ${remHours}h ago`;
}

/** Absolute UTC timestamp for the provenance footer -- the thing to check
 * formatRelativeTime's claim against. */
export function formatAbsoluteUtc(iso: string): string {
  return `${iso.replace('T', ' ').slice(0, 16)} UTC`;
}
