'use client';

import { useCallback, useMemo, useState } from 'react';
import { useModuleSearch } from '@/app/dashboard/context/DashboardSearchContext';
import { useTleEntriesQuery } from '@/hooks/useTleEntriesQuery';
import { useObjectTrendsQuery } from '@/hooks/useObjectTrendsQuery';
import { useAppDispatch, useAppSelector } from '@/lib/store';
import { buildReentryRiskMap } from '@/lib/objectTrendRisk';
import { DEFAULT_SOLAR_FLUX_MULTIPLIER } from '@/lib/solarFlux';
import {
  selectSingleSatellite,
  setShowReentry,
} from '@/lib/visualization-slice';
import type { TleEntry } from '@/lib/types';
import { type SortDir, type SortKey, TIER_ORDER } from '../lib/constants';

const EMPTY_ENTRIES: TleEntry[] = [];

export function useReentryScreening() {
  const dispatch = useAppDispatch();
  const focusedSatelliteId = useAppSelector(
    (state) => state.visualization.focusedSatelliteId
  );

  const {
    data: tleData,
    isLoading: tleLoading,
    isError: tleError,
  } = useTleEntriesQuery();
  const { data: objectTrendsById, isFetching: trendsFetching } =
    useObjectTrendsQuery(true);

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
    () => buildReentryRiskMap(entries, objectTrendsById, solarFluxMultiplier),
    [entries, objectTrendsById, solarFluxMultiplier]
  );

  const rows = useMemo(() => {
    const list = [...riskById.values()].filter(
      (risk) => risk.estimatedDaysRemaining !== null
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
      if (focusedSatelliteId === satId) {
        dispatch(selectSingleSatellite(null));
        return;
      }
      dispatch(selectSingleSatellite(satId));
    },
    [dispatch, focusedSatelliteId]
  );

  const openOnGlobe = useCallback(() => {
    if (focusedSatelliteId) {
      dispatch(selectSingleSatellite(focusedSatelliteId));
    }
    dispatch(setShowReentry(true));
  }, [dispatch, focusedSatelliteId]);

  return {
    tleLoading,
    tleError,
    trendsFetching,
    f107,
    rows: filteredRows,
    entryById,
    selectedSatId,
    selectedEntry,
    selectedRisk,

    sortKey,
    sortDir,
    handleSort,
    selectSatellite,
    openOnGlobe,
  };
}
