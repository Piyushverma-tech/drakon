'use client';

import React, {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
} from 'react';
import Globe, { GlobeHandle } from './Globe3D';
import {
  ScatterplotLayer,
  PathLayer,
  LineLayer,
  COORDINATE_SYSTEM,
} from 'deck.gl';
import { positionFromTLEAsync } from '@/lib/satelliteWorker';
import {
  DensityResult,
  TleEntry,
  SatellitePoint,
  ReentryRisk,
  TrackSegment,
} from '@/lib/types';
import { useAppDispatch, useAppSelector } from '@/lib/store';
import { setSelectedSatelliteId } from '@/lib/visualization-slice';
import {
  formatDistance,
  velocityFromTLE,
  classifyOrbit,
  getOrbitType,
  getReentryRisk,
} from '@/lib/satelliteHelpers';
import { useSatellitePositions } from '@/hooks/useSatellitePositions';
import { useInclinationBands } from '@/hooks/useInclinationBands';
import { useCollisionDensity } from '@/hooks/useCollisionDensity';
import { useSimulatedPositions } from '@/hooks/useSimulatedPositions';
import {
  setSimulationOffset,
  resetSimulation,
} from '@/lib/visualization-slice';
import { useSelectedSatelliteTrack } from '@/hooks/useSelectedSatelliteTrack';
import { useTleEntriesQuery } from '@/hooks/useTleEntriesQuery';
import RightPanel from '@/app/globe/GlobeContent/components/panels/RightPanel';
import LeftPanel from '@/app/globe/GlobeContent/components/panels/LeftPanel';
import { ForecastOverlay } from '@/app/globe/GlobeContent/components/ForeCastOverlay';
import { SatelliteDataError } from '@/app/globe/GlobeContent/components/SatelliteDataError';
import { SatelliteDataLoading } from '@/app/globe/GlobeContent/components/SatelliteDataLoading';
import { SearchResultsOverlay } from '@/app/globe/GlobeContent/components/SearchResultsOverlay';
import Map2D from './Map2d';
import { useSatelliteMetadata } from '@/hooks/useSatelliteMetadata';

// ----------------------
// Types
// ----------------------
type SelectedMeta = {
  id: number;
  name: string;
  lat: number;
  lon: number;
  alt: number;
  vel: number;
  inclination: number;
  orbitType: string;
  tleEpoch?: string;
};

type CandidatePairDatum = DensityResult['candidatePairs'][number];
const EMPTY_ENTRIES: TleEntry[] = [];

type Props = {
  searchResults?: TleEntry[];
  onClearSearch?: () => void;
};

function getLoadErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Unable to load satellite data right now.';
}

// ----------------------
// Main Component
// ----------------------
export default function SatelliteGlobe({
  searchResults = EMPTY_ENTRIES,
  onClearSearch,
}: Props) {
  const dispatch = useAppDispatch();
  const { showReentry } = useAppSelector((s) => s.visualization);
  const {
    data: queriedEntries,
    isLoading: tleLoading,
    isError: tleIsError,
    error: tleError,
    refetch: refetchTleEntries,
  } = useTleEntriesQuery();
  const entries = queriedEntries ?? EMPTY_ENTRIES;

  // Redux state
  const {
    activeFilters,
    showBands,
    bandInclination,
    bandTolerance,
    showDensity,
    densityRadiusKm,
    simulationOffsetHours,
    viewMode,
  } = useAppSelector((state) => state.visualization);

  const [selected, setSelected] = useState<SelectedMeta | null>(null);

  // Custom hooks
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
    liveSatellites: satellites, // from useSatellitePositions
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

  const selectedId = useAppSelector((s) => s.visualization.selectedSatelliteId);

  const { track } = useSelectedSatelliteTrack({
    entries,
    selectedId,
  });

  const { data: satelliteMetadata } = useSatelliteMetadata();

  const mapRef = useRef<GlobeHandle>(null);

  // Filter satellites based on active filters
  const activeFiltersSet = useMemo(
    () => new Set(activeFilters),
    [activeFilters]
  );

  const filteredSatellites = useMemo(
    () =>
      activeSatellites.filter((sat) =>
        activeFiltersSet.has(getOrbitType(sat.meanMotion, sat.isDebris))
      ),
    [activeSatellites, activeFiltersSet]
  );

  // ----------------------
  // Stats Computation
  // ----------------------
  const stats = useMemo(() => {
    const debris = entries.filter((e) => e.isDebris).length;
    const leo = entries.filter(
      (e) => getOrbitType(e.meanMotion, e.isDebris) === 'LEO'
    ).length;

    const meo = entries.filter(
      (e) => getOrbitType(e.meanMotion, e.isDebris) === 'MEO'
    ).length;

    const geo = entries.filter(
      (e) => getOrbitType(e.meanMotion, e.isDebris) === 'GEO'
    ).length;
    return {
      debris,
      leo,
      meo,
      geo,
      total: activeSatellites.length,
      filtered: filteredSatellites.length,
    };
  }, [entries, filteredSatellites.length, activeSatellites.length]);

  // Uses estimated altitude from meanMotion
  const reentryRisks = useMemo((): Map<number, ReentryRisk> => {
    if (!showReentry) return new Map();
    const map = new Map<number, ReentryRisk>();
    for (const entry of entries) {
      const risk = getReentryRisk(entry); // no currentAltKm arg — uses meanMotion
      if (risk.tier !== 'stable') {
        map.set(entry.id, risk);
      }
    }
    return map;
  }, [showReentry, entries]);

  const reentryRisksRef = useRef(reentryRisks);
  useEffect(() => {
    reentryRisksRef.current = reentryRisks;
  }, [reentryRisks]);

  const selectedMetadata = selected
    ? (satelliteMetadata?.[String(selected.id)] ?? null)
    : null;

  // split a path into segments that don't cross the antimeridian
  function splitBandAtAntimeridian(
    path: [number, number][]
  ): [number, number][][] {
    const segments: [number, number][][] = [[]];
    for (let i = 0; i < path.length; i++) {
      segments.at(-1)!.push(path[i]);
      if (i < path.length - 1) {
        if (Math.abs(path[i + 1][0] - path[i][0]) > 180) {
          segments.push([]);
        }
      }
    }
    return segments.filter((s) => s.length > 1);
  }
  // ----------------------
  // Layers
  // ----------------------
  const colorAccessor = (
    d: SatellitePoint & { isDebris?: boolean }
  ): [number, number, number, number] => {
    const orbitType = getOrbitType(d.meanMotion, d.isDebris);
    if (d.isDebris) return [180, 180, 180, 180]; // debris gray
    if (orbitType === 'GEO') return [0, 255, 0, 180]; // green: GEO (geosynchronous orbit)
    if (orbitType === 'MEO') return [255, 165, 0, 180]; // orange: MEO
    if (orbitType === 'LEO') return [255, 0, 0, 180]; // red: LEO
    return [180, 180, 180, 180]; // unknown gray
  };

  // O(1) density lookup using pre-computed map from hook
  const getSatelliteDensity = useMemo(
    () =>
      (satId: number): number => {
        if (!showDensity || satelliteDensities.size === 0) {
          return 0;
        }
        return satelliteDensities.get(satId) || 0;
      },
    [showDensity, satelliteDensities]
  );

  const getDensityBasedColor = (
    normalizedDensity: number
  ): [number, number, number, number] => {
    if (normalizedDensity === 0) {
      // Very low density — cool blue
      return [80, 160, 255, 180];
    }

    // Same nonlinear scaling
    const t = Math.pow(normalizedDensity, 0.7);

    if (t < 0.2) {
      // Blue → Cyan
      const factor = t / 0.2;
      const r = Math.round(80 + factor * 20); // 80 → 100
      const g = Math.round(160 + factor * 60); // 160 → 220
      const b = 255; // stays blue-ish
      return [r, g, b, 180];
    } else if (t < 0.4) {
      // Cyan → Green
      const factor = (t - 0.2) / 0.2;
      const r = Math.round(100 - factor * 20); // 100 → 80
      const g = Math.round(220 - factor * 80); // 220 → 140
      const b = Math.round(255 - factor * 155); // 255 → 100
      return [r, g, b, 200];
    } else if (t < 0.7) {
      // Green → Yellow
      const factor = (t - 0.4) / 0.3;
      const r = Math.round(80 + factor * 175); // 80 → 255
      const g = Math.round(140 + factor * 115); // 140 → 255
      const b = Math.round(100 - factor * 100); // 100 → 0
      return [r, g, b, 220];
    } else {
      // Yellow → Orange → Red (hot)
      const factor = (t - 0.7) / 0.3;
      const r = 255;
      const g = Math.round(255 - factor * 255); // 255 → 0
      const b = Math.round(0); // stays 0 for red
      return [r, g, b, 240];
    }
  };

  const densityLayers = useMemo(() => {
    const modePrefix = viewMode.toLowerCase();
    return showDensity &&
      densityResult &&
      densityResult.candidatePairs.length > 0
      ? [
          new LineLayer<CandidatePairDatum>({
            id: `${modePrefix}-collision-candidate-lines`,
            data: densityResult.candidatePairs,
            pickable: true,
            coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
            wrapLongitude: true,
            getSourcePosition: (d: CandidatePairDatum) => [d.lonA, d.latA],
            getTargetPosition: (d: CandidatePairDatum) => [d.lonB, d.latB],
            getColor: (d: CandidatePairDatum) =>
              d.distanceKm <= densityRadiusKm / 2
                ? [255, 80, 200, 220]
                : [255, 200, 200, 180],
            getWidth: 2,
            widthUnits: 'pixels',
          }),
        ]
      : [];
  }, [showDensity, densityResult, densityRadiusKm, viewMode]);

  // Create path layers for past and future track segments
  const trackLayers = useMemo(() => {
    if (!track) return [];
    const modePrefix = viewMode.toLowerCase();

    const makePath = (
      segments: TrackSegment[],
      color: [number, number, number],
      idSuffix: string
    ) =>
      segments.map(
        (seg, i) =>
          new PathLayer<TrackSegment>({
            id: `${modePrefix}-sat-track-${idSuffix}-${i}`,
            data: [seg],
            getPath: (d) => d.path,
            getColor: () =>
              [...color, Math.round(seg.opacity * 100)] as [
                number,
                number,
                number,
                number,
              ],
            getWidth: 3.5,
            widthMinPixels: 1.5,
            widthMaxPixels: 3.5,
            widthUnits: 'pixels',
            opacity: seg.opacity,
            pickable: false,
            coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
            wrapLongitude: true,
          })
      );

    return [
      ...makePath(track.past, [115, 147, 179], 'past'), // teal
      ...makePath(track.future, [4, 55, 242], 'future'), // blue
    ];
  }, [track, viewMode]);

  const layers = useMemo(
    () => [
      // Inclination band path layer
      ...(showBands && bandTrack
        ? splitBandAtAntimeridian(bandTrack.path).map(
            (segment, i) =>
              new PathLayer({
                id: `${viewMode.toLowerCase()}-inclination-band-${i}`,
                data: [segment],
                getPath: (d) => d,
                getColor: [0, 200, 255, 180],
                widthMinPixels: 1.5,
                opacity: 0.7,
                pickable: false,
              })
          )
        : []),
      ...densityLayers,
      ...trackLayers,
      // Main satellite layer
      new ScatterplotLayer<SatellitePoint>({
        id: `${viewMode.toLowerCase()}-satellite-layer`,
        data: filteredSatellites,
        getPosition: (d) => [d.lon, d.lat, viewMode === '2D' ? 0 : d.alt * 300],
        getFillColor: (d): [number, number, number, number] => {
          if (d.id === selected?.id) {
            if (showDensity) return [240, 255, 255, 255];
            return [0, 150, 255, 255];
          }
          if (showBands) {
            // Highlight satellites in current band
            const inBand = bandSatelliteIds.has(d.id);
            if (inBand) return [0, 255, 255, 220];
            // Dim everything else
            return [60, 60, 80, 100];
          }
          if (showDensity) {
            const density = getSatelliteDensity(d.id);
            return getDensityBasedColor(density);
          }
          //For reentry mode
          if (showReentry) {
            const risk = reentryRisksRef.current.get(d.id);
            if (risk) {
              if (risk.tier === 'critical') return [255, 60, 40, 230]; // red-orange
              if (risk.tier === 'warning') return [255, 160, 30, 210]; // amber
              if (risk.tier === 'nominal') return [255, 220, 80, 180]; // yellow
            }
            return [60, 60, 80, 100]; // dim everything else
          }

          // Normal orbit-based coloring when density map is off
          return colorAccessor(d);
        },
        radiusUnits: viewMode === '2D' ? 'pixels' : 'meters',
        getRadius: (d) => {
          if (viewMode === '2D') {
            // pixel radii — flat, consistent across all latitudes
            if (d.id === selected?.id) return d.isDebris ? 4 : 6;
            if (showReentry && reentryRisksRef.current.has(d.id)) return 4;
            const base = d.isDebris ? 2 : 3;
            if (showDensity) {
              const density = getSatelliteDensity(d.id);
              if (density > 0) return base * (1 + density * 0.5);
            }
            return base;
          }
          if (d.id === selected?.id) {
            return d.isDebris ? 50000 : 80000; // Larger radius for selected
          }
          if (showReentry && reentryRisksRef.current.has(d.id)) {
            return 60000; // All are debris & rocket bodies
          }

          const baseRadius = d.isDebris ? 30000 : 60000;

          if (showDensity) {
            const density = getSatelliteDensity(d.id);
            if (density > 0) {
              // Increase radius by up to 30% for high density
              return baseRadius * (1 + density * 0.3);
            }
          }
          return baseRadius;
        },
        radiusMinPixels: 1,
        radiusMaxPixels: 6,
        opacity: 0.85,
        pickable: true,
        onClick: (info) => {
          const pt = info.object as SatellitePoint | null;
          if (!pt) return;
          const meta = entries.find((t: TleEntry) => t.id === pt.id);
          if (!meta) return;

          const targetDate = new Date(
            Date.now() + simulationOffsetHours * 60 * 60 * 1000
          );

          const vel = velocityFromTLE(meta.l1, meta.l2, targetDate);
          const orbitType = classifyOrbit(meta.inclination);

          const selectedMeta = {
            id: pt.id,
            name: meta.name ?? 'Unknown',
            lat: pt.lat,
            lon: pt.lon,
            alt: pt.alt,
            vel,
            inclination: meta.inclination,
            orbitType,
            tleEpoch: meta.tleEpoch,
          };
          setSelected(selectedMeta);
          dispatch(setSelectedSatelliteId(pt.id));
        },
      }),
      // Glow effect layer for selected satellite
      ...(selected
        ? [
            new ScatterplotLayer<SatellitePoint>({
              id: `${viewMode.toLowerCase()}-selected-glow-layer`,
              data: filteredSatellites.filter((s) => s.id === selected.id),
              getPosition: (d) => [
                d.lon,
                d.lat,
                viewMode === '2D' ? 0 : d.alt * 300,
              ],
              getFillColor: (): [number, number, number, number] =>
                showDensity ? [240, 255, 255, 150] : [0, 200, 255, 100],
              radiusUnits: viewMode === '2D' ? 'pixels' : 'meters',
              getRadius: (d) => {
                if (viewMode === '2D') {
                  return d.isDebris ? 10 : 15;
                }
                return d.isDebris ? 80000 : 150000;
              }, //glow radius
              opacity: 0.6,
              pickable: false,
            }),
          ]
        : []),
    ],
    [
      filteredSatellites,
      showBands,
      bandTrack,
      bandSatelliteIds,
      showDensity,
      selected,
      densityLayers,
      dispatch,
      entries,
      simulationOffsetHours,
      getSatelliteDensity,
      showReentry,
      trackLayers,
      viewMode,
    ]
  );

  const focusSatellite = useCallback(
    async (sat: TleEntry) => {
      try {
        const targetDate = new Date(
          Date.now() + simulationOffsetHours * 60 * 60 * 1000
        );

        const p = await positionFromTLEAsync(sat.l1, sat.l2, targetDate);

        if (!p) {
          console.warn(`Cannot focus on satellite ${sat.id}: invalid position`);
          return;
        }
        const pp = p as { lat: number; lon: number; altKm: number };
        if (pp.lat === 0 && pp.lon === 0 && pp.altKm === 0) {
          console.warn(`Cannot focus on satellite ${sat.id}: invalid position`);
          return;
        }

        mapRef.current?.flyTo({
          longitude: pp.lon,
          latitude: pp.lat,
          zoom: 2,
          durationMs: 1400,
          pitch: 30,
          bearing: 0,
        });

        const vel = velocityFromTLE(sat.l1, sat.l2, targetDate);
        const orbitType = classifyOrbit(sat.inclination);

        const selectedMeta = {
          id: sat.id,
          name: sat.name ?? 'Unknown',
          lat: pp.lat,
          lon: pp.lon,
          alt: pp.altKm,
          vel,
          inclination: sat.inclination,
          orbitType,
          tleEpoch: sat.tleEpoch,
        };
        setSelected(selectedMeta);
        dispatch(setSelectedSatelliteId(sat.id));
      } catch (error) {
        console.error(`Error focusing on satellite ${sat.id}:`, error);
      }
    },
    [dispatch, simulationOffsetHours]
  );

  const handleDeselectSatellite = useCallback(() => {
    setSelected(null);
    dispatch(setSelectedSatelliteId(null));
  }, [dispatch]);

  const handleCommitOffset = useCallback(
    (hours: number) => dispatch(setSimulationOffset(hours)),
    [dispatch]
  );
  const handleReset = useCallback(
    () => dispatch(resetSimulation()),
    [dispatch]
  );

  const selectedReentryRisk = selected
    ? (() => {
        const fromMap = reentryRisks.get(selected.id);
        if (fromMap) return fromMap;
        const entry = entries.find((e) => e.id === selected.id);
        return entry ? getReentryRisk(entry, selected.alt) : null;
      })()
    : null;

  // ----------------------
  // UI
  // ----------------------
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

      <SearchResultsOverlay
        searchResults={searchResults}
        selectedId={selected?.id}
        onClearSearch={onClearSearch}
        onFocusSatellite={(sat) => void focusSatellite(sat)}
      />

      <ForecastOverlay
        loading={loading}
        onCommitOffset={handleCommitOffset}
        onReset={handleReset}
      />

      {/* Left Panel - Selected Satellite  */}
      <LeftPanel
        selected={selected}
        onClose={handleDeselectSatellite}
        reentryRisk={selectedReentryRisk}
        metadata={selectedMetadata}
        onFocusSatellite={focusSatellite}
      />
      {/* Right Panel */}
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
        onFocusSatellite={focusSatellite}
      />
    </div>
  );
}
