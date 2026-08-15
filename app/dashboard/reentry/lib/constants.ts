export {
  type ReentryTier,
  TIER_COLOR,
  TIER_BADGE,
  TIER_ROW_BG,
  TIER_GLOBE_COLOR,
} from '@/lib/reentryTierStyles';

export type SortKey =
  | 'estimatedDaysRemaining'
  | 'perigeeKm'
  | 'decayRateKmPerDay'
  | 'tier';

export type SortDir = 'asc' | 'desc';

export const TIER_ORDER: Record<string, number> = {
  critical: 0,
  warning: 1,
  nominal: 2,
  stable: 3,
};
