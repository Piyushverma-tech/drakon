'use client';

import { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { MiniGlobe, type RgbaColor } from '@/components/MiniGlobe';
import { useReentryScreening } from '../hooks/useReentryScreening';
import { TIER_GLOBE_COLOR, type ReentryTier } from '../lib/constants';
import { ReentryDetailPanel } from './ReentryDetailPanel';
import { ReentryStatsBar } from './ReentryStatsBar';
import { ReentryTable } from './ReentryTable';
import {
  ReentryTableNavigation,
  type ReentrySourceFilter,
  type ReentryTierFilter,
} from './ReentryTableNavigation';

export function ReentryScreeningPage() {
  const {
    tleLoading,
    tleError,
    trendsFetching,
    f107,
    rows,
    entryById,
    selectedSatId,
    selectedEntry,
    selectedRisk,

    sortKey,
    sortDir,
    handleSort,
    selectSatellite,
    openOnGlobe,
  } = useReentryScreening();

  const [tierFilter, setTierFilter] = useState<ReentryTierFilter>('all');
  const [sourceFilter, setSourceFilter] = useState<ReentrySourceFilter>('all');

  const tableRows = useMemo(
    () =>
      rows.filter((risk) => {
        const matchesTier = tierFilter === 'all' || risk.tier === tierFilter;
        const matchesSource =
          sourceFilter === 'all' ||
          (sourceFilter === 'trend'
            ? risk.source === 'multi_epoch'
            : risk.source !== 'multi_epoch');

        return matchesTier && matchesSource;
      }),
    [rows, sourceFilter, tierFilter]
  );

  const counts = useMemo(() => {
    const result = { critical: 0, warning: 0, nominal: 0 };

    for (const risk of tableRows) {
      if (
        risk.tier === 'critical' ||
        risk.tier === 'warning' ||
        risk.tier === 'nominal'
      ) {
        result[risk.tier] += 1;
      }
    }

    return result;
  }, [tableRows]);

  const tier = selectedRisk?.tier as ReentryTier | undefined;
  const satelliteColor: RgbaColor | undefined = tier
    ? TIER_GLOBE_COLOR[tier]
    : undefined;
  const orbitColor: RgbaColor | undefined = satelliteColor
    ? [satelliteColor[0], satelliteColor[1], satelliteColor[2], 160]
    : undefined;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-sm font-semibold uppercase tracking-[0.18em] text-cyan-300">
              Re-entry Screening
            </h1>
            {trendsFetching && (
              <span className="inline-flex items-center gap-1 text-[10px] text-cyan-400/70 uppercase tracking-wider">
                <Loader2 className="h-3 w-3 animate-spin" />
                trends
              </span>
            )}
          </div>
          <p className="text-[11px] text-gray-500 mt-1">
            Flagged decaying objects sorted by estimated lifetime
          </p>
        </div>

        {rows.length > 0 && !tleLoading && !tleError && (
          <ReentryTableNavigation
            rows={rows}
            visibleCount={tableRows.length}
            tierFilter={tierFilter}
            sourceFilter={sourceFilter}
            onTierFilterChange={setTierFilter}
            onSourceFilterChange={setSourceFilter}
            className="lg:ml-auto"
          />
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 max-h-[320px]">
        <MiniGlobe
          entry={selectedEntry}
          satelliteColor={satelliteColor}
          orbitColor={orbitColor}
          emptyMessage="Select a table row to view position"
          className="h-64 xl:h-80 bg-black/50 border border-white/10"
        />

        <div className="flex flex-col gap-4 h-64 xl:h-80">
          <ReentryStatsBar
            counts={counts}
            total={tableRows.length}
            f107={f107}
          />
          <ReentryDetailPanel
            entry={selectedEntry}
            risk={selectedRisk}
            onOpenGlobe={openOnGlobe}
            className="flex-1 h-full bg-black/50 border border-white/10"
          />
        </div>
      </div>

      {tleLoading ? (
        <div className="flex items-center gap-2 py-16 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin text-cyan-400" />
          Loading catalog…
        </div>
      ) : tleError ? (
        <p className="py-16 text-sm text-red-400">Unable to load TLE data.</p>
      ) : rows.length === 0 ? (
        <p className="py-16 text-sm text-gray-500">
          No objects currently flagged for re-entry.
        </p>
      ) : (
        <ReentryTable
          rows={tableRows}
          entryById={entryById}
          selectedSatId={selectedSatId}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={handleSort}
          onSelect={selectSatellite}
        />
      )}

      <p className=" text-[9.5px] text-gray-500 leading-relaxed text-center max-w-[800px] mx-auto mt-4">
        Debris screened via single-epoch BSTAR + N-dot. Active payloads require
        multi-epoch signal agreement. Estimates scale with NOAA F10.7 solar
        flux; accuracy is ±order of magnitude.
      </p>
    </div>
  );
}
