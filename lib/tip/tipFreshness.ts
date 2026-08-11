export type TipFreshness = 'fresh' | 'stale' | 'absent';

/** Soft boundary: a bit more than one missed hourly refresh cycle. */
const STALE_AFTER_MS = 90 * 60 * 1000;

export function classifyTipFreshness(
  refreshedAt: string | null,
  nowMs: number = Date.now()
): TipFreshness {
  if (!refreshedAt) return 'absent';
  return nowMs - new Date(refreshedAt).getTime() > STALE_AFTER_MS
    ? 'stale'
    : 'fresh';
}
