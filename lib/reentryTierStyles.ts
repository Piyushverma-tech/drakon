import type { ReentryRisk } from '@/lib/types';

export type ReentryTier = Exclude<ReentryRisk['tier'], 'stable'>;

export const TIER_COLOR: Record<ReentryRisk['tier'], string> = {
  critical: 'text-red-400',
  warning: 'text-amber-400',
  nominal: 'text-yellow-300',
  stable: 'text-gray-400',
};

export const TIER_BADGE: Record<ReentryRisk['tier'], string> = {
  critical: 'border-red-500/40 bg-red-500/10 text-red-400',
  warning: 'border-amber-500/40 bg-amber-500/10 text-amber-400',
  nominal: 'border-yellow-500/40 bg-yellow-500/10 text-yellow-300',
  stable: 'border-gray-500/40 bg-gray-500/10 text-gray-400',
};

export const TIER_ROW_BG: Record<ReentryRisk['tier'], string> = {
  critical: 'bg-red-950/20',
  warning: 'bg-amber-950/10',
  nominal: 'bg-yellow-950/5',
  stable: 'bg-gray-950/10',
};

export const TIER_GLOBE_COLOR: Record<
  ReentryRisk['tier'],
  [number, number, number, number]
> = {
  critical: [255, 60, 40, 230],
  warning: [255, 160, 30, 210],
  nominal: [255, 220, 80, 180],
  stable: [150, 150, 150, 160],
};
