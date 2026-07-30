'use client';

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Globe, { GlobeHandle } from './Globe3D';
import Map2D from './Map2d';
import { ReentryRisk, SatellitePoint, TleEntry } from '@/lib/types';
import { useAppDispatch, useAppSelector } from '@/lib/store';
import {
  resetSimulation,
  setSimulationOffset,
} from '@/lib/visualization-slice';
import { formatDistance, getOrbitType } from '@/lib/satelliteHelpers';
import { DEFAULT_SOLAR_FLUX_MULTIPLIER } from '@/lib/solarFlux';
import { useSatellitePositions } from '@/hooks/useSatellitePositions';
import { useInclinationBands } from '@/hooks/useInclinationBands';
import { useCollisionDensity } from '@/hooks/useCollisionDensity';
import { useSimulatedPositions } from '@/hooks/useSimulatedPositions';
import { useSelectedSatelliteTracks } from '@/hooks/useSelectedSatelliteTracks';
import { useSelectedSatelliteOrbitPaths } from '@/hooks/useSelectedSatelliteOrbitPaths';
import { useTleEntriesQuery } from '@/hooks/useTleEntriesQuery';
import { useObjectTrendsQuery } from '@/hooks/useObjectTrendsQuery';
import { useSatelliteMetadata } from '@/hooks/useSatelliteMetadata';
import RightPanel from '@/app/globe/GlobeContent/components/panels/RightPanel';
import LeftPanel from '@/app/globe/GlobeContent/components/panels/LeftPanel';
import { ForecastOverlay } from '@/app/globe/GlobeContent/components/ForeCastOverlay';
import { SatelliteDataError } from '@/app/globe/GlobeContent/components/SatelliteDataError';
import { SatelliteDataLoading } from '@/app/globe/GlobeContent/components/SatelliteDataLoading';
import { SearchResultsOverlay } from '@/app/globe/GlobeContent/components/SearchResultsOverlay';
import { SelectedSatelliteTags } from '@/app/globe/GlobeContent/components/SelectedSatelliteTags';
import {
  buildGlobeStats,
  buildSelectedMeta,
  buildSelectedTagsById,
  getLoadErrorMessage,
} from './globe-model';
import { useGlobeLayers } from './useGlobeLayers';
import { useGlobeSelectionController } from './useGlobeSelectionController';
import { buildReentryRiskMap, resolveReentryRisk } from '@/lib/objectTrendRisk';

const EMPTY_ENTRIES: TleEntry[] = [];

type HoveredSatellite = {
  id: number;
  name: string;
  x: number;
  y: number;
};

type Props = {
  searchQuery?: string;
  onClearSearch?: () => void;
};

export default function SatelliteGlobe({
  searchQuery = '',
  onClearSearch,
}: Props) {
  const dispatch = useAppDispatch();
  const mapRef = useRef<GlobeHandle>(null);
  const [hoveredSatellite, setHoveredSatellite] =
    useState<HoveredSatellite | null>(null);

  const {
    data: tleData,
    isLoading: tleLoading,
    isError: tleIsError,
    error: tleError,
    refetch: refetchTleEntries,
  } = useTleEntriesQuery();
  const entries = tleData?.entries ?? EMPTY_ENTRIES;
  const solarFluxMultiplier =
    tleData?.solarFluxMultiplier ?? DEFAULT_SOLAR_FLUX_MULTIPLIER;

  const {
    activeFilters,
    showBands,
    bandInclination,
    bandTolerance,
    showDensity,
    densityRadiusKm,
    simulationOffsetHours,
    viewMode,
    showReentry,
    selectedSatelliteIds,
    focusedSatelliteId,
    followingSatelliteId,
  } = useAppSelector((state) => state.visualization);

  const {
    satellites,
    loading: positionsLoading,
    error: positionsError,
  } = useSatellitePositions({ entries });

  const waitingForInitialPositions =
    entries.length > 0 && satellites.length === 0 && !positionsError;
  const loading = tleLoading || positionsLoading || waitingForInitialPositions;
  const offsetMs = simulationOffsetHours * 60 * 60 * 1000;

  const { satellites: activeSatellites } = useSimulatedPositions({
    entries,
    offsetMs,
    liveSatellites: satellites,
  });

  const activeSatelliteById = useMemo(
    () => new Map(activeSatellites.map((sat) => [sat.id, sat])),
    [activeSatellites]
  );

  const lastFlownFocusIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (!focusedSatelliteId) {
      lastFlownFocusIdRef.current = null;
      return;
    }
    if (lastFlownFocusIdRef.current === focusedSatelliteId) return;

    const position = activeSatelliteById.get(focusedSatelliteId);
    if (!position) return;

    lastFlownFocusIdRef.current = focusedSatelliteId;
    mapRef.current?.flyTo({
      longitude: position.lon,
      latitude: position.lat,
      durationMs: 900,
      pitch: viewMode === '3D' ? 30 : 0,
      bearing: 0,
    });
  }, [activeSatelliteById, focusedSatelliteId, viewMode]);

  const selectedPositionsById = useMemo(() => {
    const selectedMap = new Map<number, SatellitePoint>();
    for (const id of selectedSatelliteIds) {
      const sat = activeSatelliteById.get(id);
      if (sat) selectedMap.set(id, sat);
    }
    return selectedMap;
  }, [activeSatelliteById, selectedSatelliteIds]);

  const entryById = useMemo(
    () => new Map(entries.map((entry) => [entry.id, entry])),
    [entries]
  );

  const activeFiltersSet = useMemo(
    () => new Set(activeFilters),
    [activeFilters]
  );

  const filteredSatellites = useMemo(
    () =>
      activeSatellites.filter((sat) =>
        activeFiltersSet.has(getOrbitType(sat.meanMotion, sat.isDebris))
      ),
    [activeFiltersSet, activeSatellites]
  );

  const {
    showTrackById,
    showOrbitPathById,
    selectionLimitReached,
    selectSatelliteById,
    focusSatellite,
    deselectSatellite,
    toggleFollowSelected,
    toggleTrack,
    toggleOrbitPath,
  } = useGlobeSelectionController({
    mapRef,
    viewMode,
    selectedSatelliteIds,
    focusedSatelliteId,
    followingSatelliteId,
    activeSatelliteById,
    selectedPositionsById,
    entryById,
  });

  const { tracksById } = useSelectedSatelliteTracks({
    entries,
    selectedIds: selectedSatelliteIds,
    selectedPositionsById,
    enabledById: showTrackById,
  });

  const { orbitPathsById } = useSelectedSatelliteOrbitPaths({
    entries,
    selectedIds: selectedSatelliteIds,
    selectedPositionsById,
    enabledById: showOrbitPathById,
  });

  const {
    bandTrack,
    bandTrackLoading,
    bandSatelliteIds,
    bandCount,
    bandAvgAltKm,
  } = useInclinationBands({
    showBands,
    bandInclination,
    bandTolerance,
    entries,
    satellites: activeSatellites,
  });

  const { densityResult, densityLoading, densityError, satelliteDensities } =
    useCollisionDensity({
      showDensity,
      satellites: activeSatellites,
      densityRadiusKm,
    });

  const { data: satelliteMetadata } = useSatelliteMetadata();
  const { data: objectTrendsById, isFetching: trendsFetching } =
    useObjectTrendsQuery(showReentry);

  const selectedTagsById = useMemo(
    () =>
      buildSelectedTagsById(
        selectedSatelliteIds,
        selectedPositionsById,
        entryById
      ),
    [entryById, selectedPositionsById, selectedSatelliteIds]
  );

  const focusedSelected = useMemo(() => {
    if (!focusedSatelliteId) return null;
    const selectedPosition = selectedPositionsById.get(focusedSatelliteId);
    const meta = entryById.get(focusedSatelliteId);
    if (!selectedPosition || !meta) return null;
    return buildSelectedMeta(selectedPosition, meta, simulationOffsetHours);
  }, [
    entryById,
    focusedSatelliteId,
    selectedPositionsById,
    simulationOffsetHours,
  ]);

  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return [];

    return filteredSatellites
      .filter(
        (sat) =>
          sat.name?.toLowerCase().includes(query) ||
          sat.id.toString().includes(query)
      )
      .map((sat) => entryById.get(sat.id))
      .filter((entry): entry is TleEntry => Boolean(entry))
      .slice(0, 20);
  }, [entryById, filteredSatellites, searchQuery]);

  const handleSatelliteHover = useCallback(
    (
      hover: {
        satellite: SatellitePoint;
        x: number;
        y: number;
      } | null
    ) => {
      setHoveredSatellite(
        hover
          ? {
              id: hover.satellite.id,
              name: hover.satellite.name ?? `#${hover.satellite.id}`,
              x: hover.x,
              y: hover.y,
            }
          : null
      );
    },
    []
  );

  const stats = useMemo(
    () =>
      buildGlobeStats(
        entries,
        activeSatellites.length,
        filteredSatellites.length
      ),
    [activeSatellites.length, entries, filteredSatellites.length]
  );

  const reentryRisks = useMemo(() => {
    if (!showReentry) return new Map<number, ReentryRisk>();
    return buildReentryRiskMap(entries, objectTrendsById, solarFluxMultiplier);
  }, [entries, objectTrendsById, showReentry, solarFluxMultiplier]);

  const selectedMetadata = focusedSelected
    ? (satelliteMetadata?.[String(focusedSelected.id)] ?? null)
    : null;

  const selectedReentryRisk = focusedSelected
    ? (reentryRisks.get(focusedSelected.id) ??
      (() => {
        const entry = entryById.get(focusedSelected.id);
        if (!entry) return null;
        return resolveReentryRisk(
          entry,
          objectTrendsById?.get(entry.id),
          solarFluxMultiplier
        );
      })())
    : null;

  const layers = useGlobeLayers({
    viewMode,
    filteredSatellites,
    showBands,
    bandTrack,
    bandSatelliteIds,
    showDensity,
    densityResult,
    densityRadiusKm,
    satelliteDensities,
    showReentry,
    reentryRisks,
    selectedSatelliteIds,
    focusedSelected,
    tracksById,
    showTrackById,
    orbitPathsById,
    showOrbitPathById,
    onSatelliteClick: selectSatelliteById,
    onSatelliteHover: handleSatelliteHover,
  });

  const handleCommitOffset = useCallback(
    (hours: number) => dispatch(setSimulationOffset(hours)),
    [dispatch]
  );
  const handleReset = useCallback(
    () => dispatch(resetSimulation()),
    [dispatch]
  );

  const loadErrorMessage = tleIsError
    ? getLoadErrorMessage(tleError)
    : !loading && !entries.length
      ? 'No satellite data was returned from the server.'
      : positionsError;

  if (loadErrorMessage) {
    return (
      <SatelliteDataError
        message={loadErrorMessage}
        onRetry={() => void refetchTleEntries()}
      />
    );
  }

  if (loading) {
    return <SatelliteDataLoading />;
  }

  return (
    <div className="relative w-full h-full flex">
      {viewMode === '2D' ? (
        <Map2D key="map2d" ref={mapRef} layers={layers} />
      ) : (
        <Globe key="globe3d" ref={mapRef} layers={layers} />
      )}

      {hoveredSatellite && (
        <div
          className="pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-[calc(100%+10px)] bg-black/5 border text-white shadow-2xl p-2 backdrop-blur-md text-[12px] leading-tight"
          style={{
            left: Math.max(hoveredSatellite.x, 96),
            top: Math.max(hoveredSatellite.y, 36),
          }}
        >
          {/* Corner accents */}
          <div className="absolute top-0 left-0 w-2 h-2 border-l border-t border-cyan-400 pointer-events-none" />
          <div className="absolute top-0 right-0 w-2 h-2 border-r border-t border-cyan-400 pointer-events-none" />
          <div className="absolute bottom-0 left-0 w-2 h-2 border-l border-b border-cyan-400 pointer-events-none" />
          <div className="absolute bottom-0 right-0 w-2 h-2 border-r border-b border-cyan-400 pointer-events-none" />
          <div className="max-w-44 truncate font-medium text-cyan-300">
            {hoveredSatellite.name}
          </div>
          <div className="mt-0.5 text-[11px] text-gray-400">
            #{hoveredSatellite.id}
          </div>
        </div>
      )}

      <SearchResultsOverlay
        searchResults={searchResults}
        selectedIds={selectedSatelliteIds}
        onClearSearch={onClearSearch}
        onFocusSatellite={focusSatellite}
      />

      <SelectedSatelliteTags
        selectedIds={selectedSatelliteIds}
        focusedId={focusedSatelliteId}
        tagsById={selectedTagsById}
        selectionLimitReached={selectionLimitReached}
        entryById={entryById}
        onFocusSatellite={focusSatellite}
        onRemoveSatellite={deselectSatellite}
      />

      <ForecastOverlay
        loading={loading}
        onCommitOffset={handleCommitOffset}
        onReset={handleReset}
      />

      <LeftPanel
        selected={focusedSelected}
        reentryRisk={selectedReentryRisk}
        metadata={selectedMetadata}
        isFollowingSelected={followingSatelliteId === focusedSatelliteId}
        onToggleFollow={toggleFollowSelected}
        showTrack={Boolean(showTrackById[focusedSatelliteId ?? -1])}
        onToggleTrack={toggleTrack}
        showOrbitPath={Boolean(showOrbitPathById[focusedSatelliteId ?? -1])}
        onToggleOrbitPath={toggleOrbitPath}
      />

      <RightPanel
        stats={stats}
        bandCount={bandCount}
        bandAvgAltKm={bandAvgAltKm}
        bandTrackLoading={bandTrackLoading}
        densityResult={densityResult}
        densityLoading={densityLoading}
        densityError={densityError}
        formatDistance={formatDistance}
        reentryRisks={reentryRisks}
        showReentry={showReentry}
        trendsFetching={trendsFetching}
        onFocusSatellite={focusSatellite}
      />
    </div>
  );
}
