'use client';

import { useCallback, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { MiniGlobe, type RgbaColor } from '@/components/MiniGlobe';
import { useReentryScreening } from '../hooks/useReentryScreening';
import { TIER_GLOBE_COLOR, type ReentryTier } from '../lib/constants';
import { ReentryDetailPanel } from './ReentryDetailPanel';
import { ReentryStatsBar } from './ReentryStatsBar';
import { ReentryTable } from './ReentryTable';
import { ReentryTableNavigation } from './ReentryTableNavigation';
import {
  buildTriageBuckets,
  type TriageBucket,
} from '../lib/buildTriageBuckets';

const TRIAGE_TABS: Array<{
  value: TriageBucket;
  label: string;
  description: string;
}> = [
  {
    value: 'active',
    label: 'Active',
    description: 'Sustained critical or warning, nothing new',
  },
  {
    value: 'new_escalated',
    label: 'New Escalated',
    description: 'Appeared or got worse in the last 72 hours',
  },

  {
    value: 'watching',
    label: 'Watching',
    description: 'Nominal tier, stable or flagged for monitoring',
  },
];

export function ReentryScreeningPage() {
  const {
    tleLoading,
    tleError,
    trendsFetching,
    f107,
    rows,
    filteredRows,
    entryById,
    selectedSatId,
    selectedEntry,
    selectedRisk,
    changesByNoradId,
    tipRefreshedAt,

    tierFilter,
    sourceFilter,
    triageFilter,
    sortKey,
    sortDir,
    handleSort,
    selectSatellite,
    setTierFilter,
    setSourceFilter,
    setTriageFilter,
  } = useReentryScreening();

  const [miniGlobeFocusKey, setMiniGlobeFocusKey] = useState(0);

  const tableRows = useMemo(
    () =>
      filteredRows.filter((risk) => {
        const matchesTier = tierFilter === 'all' || risk.tier === tierFilter;
        const matchesSource =
          sourceFilter === 'all'
            ? true
            : sourceFilter === 'tip'
              ? risk.tip != null
              : sourceFilter === 'trend'
                ? risk.source === 'multi_epoch'
                : risk.source !== 'multi_epoch';

        return matchesTier && matchesSource;
      }),
    [filteredRows, sourceFilter, tierFilter]
  );

  const counts = useMemo(() => {
    const result = { critical: 0, warning: 0, nominal: 0 };

    for (const risk of rows) {
      if (
        risk.tier === 'critical' ||
        risk.tier === 'warning' ||
        risk.tier === 'nominal'
      ) {
        result[risk.tier] += 1;
      }
    }

    return result;
  }, [rows]);

  const tier = selectedRisk?.tier as ReentryTier | undefined;
  const satelliteColor: RgbaColor | undefined = tier
    ? TIER_GLOBE_COLOR[tier]
    : undefined;
  const orbitColor: RgbaColor | undefined = satelliteColor
    ? [satelliteColor[0], satelliteColor[1], satelliteColor[2], 160]
    : undefined;

  const handleSelectSatellite = useCallback(
    (satId: number) => {
      selectSatellite(satId);
      setMiniGlobeFocusKey((key) => key + 1);
    },
    [selectSatellite]
  );

  const triageBuckets = useMemo(
    () => buildTriageBuckets(tableRows, changesByNoradId),
    [tableRows, changesByNoradId]
  );

  const triageRows = useMemo(() => {
    if (triageFilter === 'new_escalated') return triageBuckets.newEscalated;
    if (triageFilter === 'active') return triageBuckets.active;
    return triageBuckets.watching;
  }, [triageBuckets, triageFilter]);

  const selectedTriageTab = TRIAGE_TABS.find(
    (tab) => tab.value === triageFilter
  );

  const triageCounts: Record<TriageBucket, number> = {
    active: triageBuckets.active.length,
    new_escalated: triageBuckets.newEscalated.length,
    watching: triageBuckets.watching.length,
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex flex-col lg:mr-auto">
          <div className="flex flex-wrap items-start gap-2">
            <h2
              className={`font-bold uppercase text-[12px] tracking-[0.20rem] text-cyan-400/90`}
            >
              {selectedTriageTab?.label ?? 'Active'}
            </h2>

            <span className="tabular-nums text-[12px] text-gray-400 ">
              {triageRows.length}/{tableRows.length}
            </span>
            {trendsFetching && (
              <span className="inline-flex items-center gap-1 text-[10px] text-cyan-400/70 uppercase tracking-wider">
                <Loader2 className="h-3 w-3 animate-spin" />
                trends
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[12px] text-gray-400 ">
            {selectedTriageTab?.description}
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
            TriageTabs={TRIAGE_TABS}
            triageFilter={triageFilter}
            triageCounts={triageCounts}
            setTriageFilter={setTriageFilter}
            className="lg:ml-auto"
          />
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 max-h-[320px]">
        <MiniGlobe
          entry={selectedEntry}
          satelliteColor={satelliteColor}
          orbitColor={orbitColor}
          focusKey={miniGlobeFocusKey}
          emptyMessage="Select a table row to view position"
          className="h-64 xl:h-80 bg-black/50 border border-gray-400/10"
        />

        <div className="flex flex-col gap-4 h-64 xl:h-80">
          <ReentryStatsBar counts={counts} total={rows.length} f107={f107} />
          <ReentryDetailPanel
            entry={selectedEntry}
            risk={selectedRisk}
            tipRefreshedAt={tipRefreshedAt}
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
      ) : tableRows.length === 0 ? (
        <p className="py-16 text-sm text-gray-500">
          No objects match the current filters.
        </p>
      ) : (
        <div>
          <ReentryTable
            rows={triageRows}
            entryById={entryById}
            selectedSatId={selectedSatId}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={handleSort}
            onSelect={handleSelectSatellite}
          />
        </div>
      )}

      <p className=" text-[9.5px] text-gray-500 leading-relaxed text-center max-w-[800px] mx-auto mt-4">
        Debris screened via single-epoch BSTAR + N-dot. Active payloads require
        multi-epoch signal agreement. Estimates scale with NOAA F10.7 solar
        flux; accuracy is ±order of magnitude.
      </p>
    </div>
  );
}
