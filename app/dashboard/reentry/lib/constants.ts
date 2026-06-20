import type { ReentryRisk } from '@/lib/types';

export type ReentryTier = Exclude<ReentryRisk['tier'], 'stable'>;

export type SortKey =
  | 'estimatedDaysRemaining'
  | 'perigeeKm'
  | 'decayRateKmPerDay'
  | 'tier';

export type SortDir = 'asc' | 'desc';

export const TIER_COLOR: Record<ReentryTier, string> = {
  critical: 'text-red-400',
  warning: 'text-amber-400',
  nominal: 'text-yellow-300',
};

export const TIER_BADGE: Record<ReentryTier, string> = {
  critical: 'border-red-500/40 bg-red-500/10 text-red-400',
  warning: 'border-amber-500/40 bg-amber-500/10 text-amber-400',
  nominal: 'border-yellow-500/40 bg-yellow-500/10 text-yellow-300',
};

export const TIER_ROW_BG: Record<ReentryTier, string> = {
  critical: 'bg-red-950/20',
  warning: 'bg-amber-950/10',
  nominal: 'bg-yellow-950/5',
};

export const TIER_GLOBE_COLOR: Record<
  ReentryTier,
  [number, number, number, number]
> = {
  critical: [255, 60, 40, 230],
  warning: [255, 160, 30, 210],
  nominal: [255, 220, 80, 180],
};

export const TIER_ORDER: Record<string, number> = {
  critical: 0,
  warning: 1,
  nominal: 2,
  stable: 3,
};
