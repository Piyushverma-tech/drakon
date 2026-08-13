'use client';

import { useCallback, useMemo, useState } from 'react';
import { useModuleSearch } from '@/app/dashboard/context/DashboardSearchContext';
import { useTleEntriesQuery } from '@/hooks/useTleEntriesQuery';
import { useObjectTrendsQuery } from '@/hooks/useObjectTrendsQuery';
import { useTipQuery } from '@/hooks/useTipQuery';
import { useAppDispatch, useAppSelector } from '@/lib/store';
import { buildReentryRiskMap } from '@/lib/objectTrendRisk';
import { DEFAULT_SOLAR_FLUX_MULTIPLIER } from '@/lib/solarFlux';
import {
  setReentrySourceFilter,
  setReentryTierFilter,
  setReentryTriageFilter,
  type ReentrySourceFilter,
  type ReentryTierFilter,
  type ReentryTriageFilter,
} from '@/lib/reentry-screening-slice';
import { selectSingleSatellite } from '@/lib/visualization-slice';
import type { TleEntry } from '@/lib/types';
import { type SortDir, type SortKey, TIER_ORDER } from '../lib/constants';
import { useRecentTrendChangesQuery } from '@/hooks/useRecentTrendChangesQuery';

const EMPTY_ENTRIES: TleEntry[] = [];

export function useReentryScreening() {
  const dispatch = useAppDispatch();
  const focusedSatelliteId = useAppSelector(
    (state) => state.visualization.focusedSatelliteId
  );
  const { tierFilter, sourceFilter, triageFilter } = useAppSelector(
    (state) => state.reentryScreening
  );

  const {
    data: tleData,
    isLoading: tleLoading,
    isError: tleError,
  } = useTleEntriesQuery();
  const { data: objectTrendsById, isFetching: trendsFetching } =
    useObjectTrendsQuery(true);
  const { data: tip } = useTipQuery(true); // data only -- TIP must never gate render
  const { changesByNoradId } = useRecentTrendChangesQuery(true);

  const { query: searchQuery } = useModuleSearch(
    'Search by name or NORAD ID...'
  );

  const [sortKey, setSortKey] = useState<SortKey>('estimatedDaysRemaining');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const entries = useMemo(
    () => tleData?.entries ?? EMPTY_ENTRIES,
    [tleData?.entries]
  );

  const solarFluxMultiplier =
    tleData?.solarFluxMultiplier ?? DEFAULT_SOLAR_FLUX_MULTIPLIER;
  const f107 = tleData?.f107 ?? null;

  const entryById = useMemo(
    () => new Map(entries.map((entry) => [entry.id, entry])),
    [entries]
  );

  const riskById = useMemo(
    () =>
      buildReentryRiskMap(
        entries,
        objectTrendsById,
        solarFluxMultiplier,
        tip?.byNoradId
      ),
    [entries, objectTrendsById, solarFluxMultiplier, tip?.byNoradId]
  );

  const rows = useMemo(() => {
    const list = [...riskById.values()].filter(
      (risk) => risk.estimatedDaysRemaining !== null || risk.tip != null
    );

    list.sort((a, b) => {
      let diff = 0;
      if (sortKey === 'estimatedDaysRemaining') {
        diff =
          (a.estimatedDaysRemaining ?? Infinity) -
          (b.estimatedDaysRemaining ?? Infinity);
      } else if (sortKey === 'perigeeKm') {
        diff = a.perigeeKm - b.perigeeKm;
      } else if (sortKey === 'decayRateKmPerDay') {
        diff = b.decayRateKmPerDay - a.decayRateKmPerDay;
      } else if (sortKey === 'tier') {
        diff = (TIER_ORDER[a.tier] ?? 3) - (TIER_ORDER[b.tier] ?? 3);
      }
      return sortDir === 'asc' ? diff : -diff;
    });

    return list;
  }, [riskById, sortKey, sortDir]);

  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return rows;

    return rows.filter((risk) => {
      const entry = entryById.get(risk.satId);
      const name = entry?.name.toLowerCase() ?? '';
      return name.includes(query) || String(risk.satId).includes(query);
    });
  }, [entryById, rows, searchQuery]);

  const selectedSatId = focusedSatelliteId;
  const selectedEntry = selectedSatId
    ? (entryById.get(selectedSatId) ?? null)
    : null;
  const selectedRisk = selectedSatId
    ? (riskById.get(selectedSatId) ?? null)
    : null;

  const handleSort = useCallback(
    (key: SortKey) => {
      if (key === sortKey) {
        setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortKey(key);
        setSortDir('asc');
      }
    },
    [sortKey]
  );

  const selectSatellite = useCallback(
    (satId: number) => {
      dispatch(selectSingleSatellite(satId));
    },
    [dispatch]
  );

  const setTierFilter = useCallback(
    (filter: ReentryTierFilter) => {
      dispatch(setReentryTierFilter(filter));
    },
    [dispatch]
  );

  const setSourceFilter = useCallback(
    (filter: ReentrySourceFilter) => {
      dispatch(setReentrySourceFilter(filter));
    },
    [dispatch]
  );

  const setTriageFilter = useCallback(
    (filter: ReentryTriageFilter) => {
      dispatch(setReentryTriageFilter(filter));
    },
    [dispatch]
  );

  return {
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
    tipRefreshedAt: tip?.refreshedAt ?? null,
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
  };
}
