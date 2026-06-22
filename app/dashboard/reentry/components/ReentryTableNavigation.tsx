'use client';

import { useMemo } from 'react';
import { CircleDot } from 'lucide-react';
import type { ReentryRisk } from '@/lib/types';
import { cn } from '@/lib/utils';
import type { ReentryTier } from '../lib/constants';

export type ReentryTierFilter = 'all' | ReentryTier;
export type ReentrySourceFilter = 'all' | 'trend' | 'single';

const TIER_FILTERS: Array<{ value: ReentryTierFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'critical', label: 'Critical' },
  { value: 'warning', label: 'Warning' },
  { value: 'nominal', label: 'Nominal' },
];

const SOURCE_FILTERS: Array<{ value: ReentrySourceFilter; label: string }> = [
  { value: 'all', label: 'All sources' },
  { value: 'trend', label: 'Trend' },
  { value: 'single', label: 'Single epoch' },
];

type Props = {
  rows: ReentryRisk[];
  visibleCount: number;
  tierFilter: ReentryTierFilter;
  sourceFilter: ReentrySourceFilter;
  onTierFilterChange: (filter: ReentryTierFilter) => void;
  onSourceFilterChange: (filter: ReentrySourceFilter) => void;
  className?: string;
};

export function ReentryTableNavigation({
  rows,
  visibleCount,
  tierFilter,
  sourceFilter,
  onTierFilterChange,
  onSourceFilterChange,
  className,
}: Props) {
  const tierCounts = useMemo(() => {
    const counts: Record<ReentryTierFilter, number> = {
      all: rows.length,
      critical: 0,
      warning: 0,
      nominal: 0,
    };

    for (const risk of rows) {
      if (
        risk.tier === 'critical' ||
        risk.tier === 'warning' ||
        risk.tier === 'nominal'
      ) {
        counts[risk.tier] += 1;
      }
    }

    return counts;
  }, [rows]);

  return (
    <div
      className={cn(
        'flex flex-col gap-4  p-2 backdrop-blur-md xl:flex-row xl:items-center',
        className
      )}
    >
      <div className="flex items-center justify-between gap-3 px-1 xl:flex-col xl:items-start xl:justify-center xl:gap-0">
        <span className="text-[10px] uppercase tracking-[0.2em] text-gray-500 ">
          Showing
        </span>
        <span className="font-mono text-[12px] tabular-nums text-cyan-300">
          {visibleCount}/{rows.length}
        </span>
      </div>

      <div className="flex flex-wrap gap-1 rounded-md border border-white/10 bg-slate-600/5 p-1">
        {TIER_FILTERS.map((filter) => {
          const active = tierFilter === filter.value;

          return (
            <button
              key={filter.value}
              type="button"
              onClick={() => onTierFilterChange(filter.value)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium transition',
                active
                  ? 'bg-cyan-500/30 text-white'
                  : 'text-gray-400 hover:bg-white/10 hover:text-gray-100'
              )}
            >
              <CircleDot className="size-3" />
              {filter.label}
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 text-[10px]',
                  active ? 'bg-black/15' : 'bg-white/10 text-gray-500'
                )}
              >
                {tierCounts[filter.value]}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-1 rounded-md border border-white/10 bg-slate-600/5 p-1">
        {SOURCE_FILTERS.map((filter) => {
          const active = sourceFilter === filter.value;

          return (
            <button
              key={filter.value}
              type="button"
              onClick={() => onSourceFilterChange(filter.value)}
              className={cn(
                'rounded-md px-2.5 py-1.5 text-[11px] font-medium transition',
                active
                  ? 'bg-cyan-500/30 text-white'
                  : 'text-gray-400 hover:bg-white/10 hover:text-gray-200'
              )}
            >
              {filter.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
