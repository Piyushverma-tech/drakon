'use client';

import { CircleDot } from 'lucide-react';
import type { ReentryRisk } from '@/lib/types';
import { cn } from '@/lib/utils';
import type { ReentryTier } from '../lib/constants';
import { TriageBucket } from '../lib/buildTriageBuckets';

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
  TriageTabs: Array<{ value: TriageBucket; label: string }>;
  triageFilter: TriageBucket;
  setTriageFilter: (filter: TriageBucket) => void;
  triageCounts: Record<TriageBucket, number>;
  className?: string;
};

export function ReentryTableNavigation({
  tierFilter,
  sourceFilter,
  onTierFilterChange,
  onSourceFilterChange,
  TriageTabs,
  triageFilter,
  setTriageFilter,
  triageCounts,
  className,
}: Props) {
  return (
    <div
      className={cn(
        'flex flex-col gap-4 p-1.5 backdrop-blur-md xl:flex-row xl:items-center',
        className
      )}
    >
      <div className=" flex flex-wrap gap-1 rounded-md border border-white/10 bg-slate-600/5 p-1">
        {TriageTabs.map((tab) => {
          const active = triageFilter === tab.value;

          return (
            <button
              key={tab.value}
              type="button"
              onClick={() => setTriageFilter(tab.value)}
              className={cn(
                'rounded-md px-2.5 py-1.5 text-[11px] font-medium transition cursor-pointer',
                active
                  ? 'bg-cyan-500/30 text-white'
                  : 'text-gray-400 hover:bg-white/10 hover:text-gray-200'
              )}
            >
              {tab.label}
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                  active ? 'bg-black/15' : 'bg-white/10 text-gray-500'
                }`}
              >
                {triageCounts[tab.value]}
              </span>
            </button>
          );
        })}
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
                'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium transition cursor-pointer',
                active
                  ? 'bg-cyan-500/30 text-white'
                  : 'text-gray-400 hover:bg-white/10 hover:text-gray-100'
              )}
            >
              <CircleDot className="size-3" />
              {filter.label}
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
                'rounded-md px-2.5 py-1.5 text-[11px] font-medium transition cursor-pointer',
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
