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
import {
  DensityResult,
  TleEntry,
  SatellitePoint,
  ReentryRisk,
  TrackSegment,
  OrbitPathSegment,
} from '@/lib/types';
import { useAppDispatch, useAppSelector } from '@/lib/store';
import {
  selectSatellite,
  removeSelectedSatellite,
  setSimulationOffset,
  resetSimulation,
  toggleFollowingFocusedSatellite,
} from '@/lib/visualization-slice';
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
import { useSelectedSatelliteTracks } from '@/hooks/useSelectedSatelliteTracks';
import { useSelectedSatelliteOrbitPaths } from '@/hooks/useSelectedSatelliteOrbitPaths';
import { useTleEntriesQuery } from '@/hooks/useTleEntriesQuery';
import RightPanel from '@/app/globe/GlobeContent/components/panels/RightPanel';
import LeftPanel from '@/app/globe/GlobeContent/components/panels/LeftPanel';
import { ForecastOverlay } from '@/app/globe/GlobeContent/components/ForeCastOverlay';
import { SatelliteDataError } from '@/app/globe/GlobeContent/components/SatelliteDataError';
import { SatelliteDataLoading } from '@/app/globe/GlobeContent/components/SatelliteDataLoading';
import { SearchResultsOverlay } from '@/app/globe/GlobeContent/components/SearchResultsOverlay';
import Map2D from './Map2d';
import { useSatelliteMetadata } from '@/hooks/useSatelliteMetadata';
import { MAX_SELECTED, colorForId } from '@/lib/satellite-colors';
import { X } from 'lucide-react';

// ----------------------
// Types
// ----------------------
export type SelectedMeta = {
  id: number;
  name: string;
  lat: number;
  lon: number;
  alt: number;
  vel: number;
  inclination: number;
  orbitType: string;
  apogeeKm: number;
  perigeeKm: number;
  ecc: number;
  tleEpoch?: string;
};

type CandidatePairDatum = DensityResult['candidatePairs'][number];
const EMPTY_ENTRIES: TleEntry[] = [];

type Props = {
  searchQuery?: string;
  onClearSearch?: () => void;
};

function getLoadErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Unable to load satellite data right now.';
}

function buildSelectedMeta(
  selectedPosition: SatellitePoint,
  meta: TleEntry,
  simulationOffsetHours: number
): SelectedMeta {
  const targetDate = new Date(
    Date.now() + simulationOffsetHours * 60 * 60 * 1000
  );
  const vel = velocityFromTLE(meta.l1, meta.l2, targetDate);
  const orbitType = classifyOrbit(meta.inclination);

  return {
    id: selectedPosition.id,
    name: meta.name ?? 'Unknown',
    lat: selectedPosition.lat,
    lon: selectedPosition.lon,
    alt: selectedPosition.alt,
    vel,
    inclination: meta.inclination,
    orbitType,
    apogeeKm: meta.apogeeKm,
    perigeeKm: meta.perigeeKm,
    ecc: meta.ecc,
    tleEpoch: meta.tleEpoch,
  };
}

// ----------------------
// Main Component
// ----------------------
export default function SatelliteGlobe({
  searchQuery = '',
  onClearSearch,
}: Props) {
  const dispatch = useAppDispatch();
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
    showReentry,
  } = useAppSelector((state) => state.visualization);

  const [showTrackById, setShowTrackById] = useState<Record<number, boolean>>(
    {}
  );
  const [showOrbitPathById, setShowOrbitPathById] = useState<
    Record<number, boolean>
  >({});
  const [selectionLimitReached, setSelectionLimitReached] = useState(false);

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

  const { selectedSatelliteIds, focusedSatelliteId, followingSatelliteId } =
    useAppSelector((s) => s.visualization);

  const activeSatelliteById = useMemo(
    () => new Map(activeSatellites.map((sat) => [sat.id, sat])),
    [activeSatellites]
  );

  const selectedPositionsById = useMemo(() => {
    const selectedMap = new Map<number, SatellitePoint>();
    for (const id of selectedSatelliteIds) {
      const sat = activeSatelliteById.get(id);
      if (sat) selectedMap.set(id, sat);
    }
    return selectedMap;
  }, [activeSatelliteById, selectedSatelliteIds]);

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

  const entryById = useMemo(
    () => new Map(entries.map((entry) => [entry.id, entry])),
    [entries]
  );

  const selectedById = useMemo(() => {
    const next: Record<number, SelectedMeta> = {};
    for (const satId of selectedSatelliteIds) {
      const selectedPosition = selectedPositionsById.get(satId);
      const meta = entryById.get(satId);
      if (!selectedPosition || !meta) continue;
      next[satId] = buildSelectedMeta(
        selectedPosition,
        meta,
        simulationOffsetHours
      );
    }
    return next;
  }, [
    selectedSatelliteIds,
    selectedPositionsById,
    entryById,
    simulationOffsetHours,
  ]);

  const focusedSelected = focusedSatelliteId
    ? (selectedById[focusedSatelliteId] ?? null)
    : null;

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

  const selectedMetadata = focusedSelected
    ? (satelliteMetadata?.[String(focusedSelected.id)] ?? null)
    : null;

  useEffect(() => {
    if (!followingSatelliteId) return;

    const followPosition = selectedPositionsById.get(followingSatelliteId);
    if (!followPosition) return;

    mapRef.current?.flyTo({
      longitude: followPosition.lon,
      latitude: followPosition.lat,
      durationMs: 900,
      pitch: viewMode === '3D' ? 30 : 0,
      bearing: 0,
    });
  }, [selectedPositionsById, followingSatelliteId, viewMode]);

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
    const modePrefix = viewMode.toLowerCase();
    const layersOut: PathLayer<TrackSegment>[] = [];

    const makePath = (
      satId: number,
      segments: TrackSegment[],
      color: [number, number, number, number],
      idSuffix: string
    ) =>
      segments.map(
        (seg, i) =>
          new PathLayer<TrackSegment>({
            id: `${modePrefix}-sat-track-${satId}-${idSuffix}-${i}`,
            data: [seg],
            getPath: (d) => d.path,
            getColor: () =>
              [color[0], color[1], color[2], Math.round(seg.opacity * 100)] as [
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

    for (const satId of selectedSatelliteIds) {
      const track = tracksById[satId];
      if (!track || !showTrackById[satId]) continue;
      const color = colorForId(satId, selectedSatelliteIds);
      if (!color) continue;
      const rgba: [number, number, number, number] = [
        color[0],
        color[1],
        color[2],
        200,
      ];
      layersOut.push(...makePath(satId, track.past, rgba, 'past'));
      layersOut.push(...makePath(satId, track.future, rgba, 'future'));
    }

    return layersOut;
  }, [tracksById, viewMode, showTrackById, selectedSatelliteIds]);

  const orbitPathLayers = useMemo(() => {
    if (viewMode !== '3D') return [];
    const layersOut: PathLayer<OrbitPathSegment>[] = [];
    for (const satId of selectedSatelliteIds) {
      if (!showOrbitPathById[satId]) continue;
      const orbitPath = orbitPathsById[satId];
      if (!orbitPath) continue;
      const color = colorForId(satId, selectedSatelliteIds);
      if (!color) continue;
      layersOut.push(
        ...orbitPath.segments.map(
          (segment, i) =>
            new PathLayer<OrbitPathSegment>({
              id: `3d-selected-orbit-path-${satId}-${i}`,
              data: [segment],
              getPath: (d) =>
                d.path.map(
                  ([lon, lat, altKm]) =>
                    [lon, lat, altKm * 300] as [number, number, number]
                ),
              getColor: [color[0], color[1], color[2], 190],
              getWidth: 2.5,
              widthMinPixels: 1.5,
              widthMaxPixels: 3,
              widthUnits: 'pixels',
              opacity: 0.75,
              pickable: false,
              coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
              wrapLongitude: true,
            })
        )
      );
    }
    return layersOut;
  }, [orbitPathsById, selectedSatelliteIds, showOrbitPathById, viewMode]);

  const enableDefaultSelectedLayers = useCallback((satId: number) => {
    setShowTrackById((prev) =>
      prev[satId] === undefined ? { ...prev, [satId]: true } : prev
    );
    setShowOrbitPathById((prev) =>
      prev[satId] === undefined ? { ...prev, [satId]: true } : prev
    );
  }, []);

  const selectSatelliteById = useCallback(
    (satId: number) => {
      const isAlreadySelected = selectedSatelliteIds.includes(satId);
      if (!isAlreadySelected && selectedSatelliteIds.length >= MAX_SELECTED) {
        setSelectionLimitReached(true);
        return false;
      }

      if (!activeSatelliteById.has(satId) || !entryById.has(satId)) {
        return false;
      }

      setSelectionLimitReached(false);
      dispatch(selectSatellite(satId));
      enableDefaultSelectedLayers(satId);
      return true;
    },
    [
      activeSatelliteById,
      dispatch,
      enableDefaultSelectedLayers,
      entryById,
      selectedSatelliteIds,
    ]
  );

  const focusSatellite = useCallback(
    (sat: TleEntry) => {
      selectSatelliteById(sat.id);
    },
    [selectSatelliteById]
  );

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
      ...orbitPathLayers,
      // Main satellite layer
      new ScatterplotLayer<SatellitePoint>({
        id: `${viewMode.toLowerCase()}-satellite-layer`,
        data: filteredSatellites,
        getPosition: (d) => [d.lon, d.lat, viewMode === '2D' ? 0 : d.alt * 300],
        getFillColor: (d): [number, number, number, number] => {
          const selectedColor = colorForId(d.id, selectedSatelliteIds);
          const isSelected = selectedColor !== null;
          if (isSelected && selectedColor) {
            return [selectedColor[0], selectedColor[1], selectedColor[2], 255];
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
            if (selectedSatelliteIds.includes(d.id)) return d.isDebris ? 4 : 6;
            if (showReentry && reentryRisksRef.current.has(d.id)) return 2.5;
            const base = d.isDebris ? 2 : 2.5;
            if (showDensity) {
              const density = getSatelliteDensity(d.id);
              if (density > 0) return base * (1 + density * 0.5);
            }
            return base;
          }
          if (selectedSatelliteIds.includes(d.id)) {
            return d.isDebris ? 30000 : 60000; // Larger radius for selected
          }
          if (showReentry && reentryRisksRef.current.has(d.id)) {
            return 40000; // All are debris & rocket bodies
          }

          const baseRadius = d.isDebris ? 15000 : 30000;

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
        opacity: 0.9,
        pickable: true,
        onClick: (info) => {
          const pt = info.object as SatellitePoint | null;
          if (!pt) return;
          selectSatelliteById(pt.id);
        },
      }),
      // Glow effect layer for selected satellite
      ...(focusedSelected
        ? [
            new ScatterplotLayer<SatellitePoint>({
              id: `${viewMode.toLowerCase()}-selected-glow-layer`,
              data: filteredSatellites.filter(
                (s) => s.id === focusedSelected.id
              ),
              getPosition: (d) => [
                d.lon,
                d.lat,
                viewMode === '2D' ? 0 : d.alt * 300,
              ],
              getFillColor: (): [number, number, number, number] => {
                const color = colorForId(
                  focusedSelected.id,
                  selectedSatelliteIds
                );
                if (!color) return [0, 200, 255, 100];
                return [color[0], color[1], color[2], showDensity ? 150 : 110];
              },
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
      focusedSelected,
      selectedSatelliteIds,
      densityLayers,
      getSatelliteDensity,
      showReentry,
      trackLayers,
      orbitPathLayers,
      viewMode,
      selectSatelliteById,
    ]
  );

  const handleDeselectSatellite = useCallback(
    (satId: number) => {
      dispatch(removeSelectedSatellite(satId));
      setShowTrackById((prev) => {
        const next = { ...prev };
        delete next[satId];
        return next;
      });
      setShowOrbitPathById((prev) => {
        const next = { ...prev };
        delete next[satId];
        return next;
      });
      setSelectionLimitReached(false);
    },
    [dispatch]
  );

  const handleToggleFollowSelected = useCallback(() => {
    dispatch(toggleFollowingFocusedSatellite());
  }, [dispatch]);

  const handleToggleTrack = useCallback(() => {
    if (!focusedSatelliteId) return;
    setShowTrackById((prev) => ({
      ...prev,
      [focusedSatelliteId]: !prev[focusedSatelliteId],
    }));
  }, [focusedSatelliteId]);

  const handleToggleOrbitPath = useCallback(() => {
    if (!focusedSatelliteId) return;
    setShowOrbitPathById((prev) => ({
      ...prev,
      [focusedSatelliteId]: !prev[focusedSatelliteId],
    }));
  }, [focusedSatelliteId]);

  const handleCommitOffset = useCallback(
    (hours: number) => dispatch(setSimulationOffset(hours)),
    [dispatch]
  );
  const handleReset = useCallback(
    () => dispatch(resetSimulation()),
    [dispatch]
  );

  const selectedReentryRisk = focusedSelected
    ? (() => {
        const fromMap = reentryRisks.get(focusedSelected.id);
        if (fromMap) return fromMap;
        const entry = entries.find((e) => e.id === focusedSelected.id);
        return entry ? getReentryRisk(entry) : null;
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
        selectedIds={selectedSatelliteIds}
        onClearSearch={onClearSearch}
        onFocusSatellite={focusSatellite}
      />

      {/* Selected Satellites Tags - Top Center */}
      <div className="absolute top-2 left-1/2 transform -translate-x-1/2 flex flex-col items-center gap-2">
        {selectedSatelliteIds.length > 0 && (
          <div className="flex flex-wrap justify-center gap-1.5 px-2">
            {selectedSatelliteIds.map((satId) => {
              const sat = selectedById[satId];
              if (!sat) return null;
              const isFocused = satId === focusedSatelliteId;
              const color = colorForId(satId, selectedSatelliteIds);
              const selectedEntry = entries.find((e) => e.id === satId);
              return (
                <div
                  key={satId}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium backdrop-blur-md transition-all duration-150 ${
                    isFocused
                      ? 'bg-cyan-500/20 border border-cyan-400/50 text-cyan-100'
                      : 'bg-black/10 border border-white/20 text-gray-200 hover:bg-white/10'
                  }`}
                >
                  {color && (
                    <span
                      className="h-1.5 w-1.5 rounded-full border border-white/40 shrink-0"
                      style={{
                        backgroundColor: `rgb(${color[0]}, ${color[1]}, ${color[2]})`,
                      }}
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => selectedEntry && focusSatellite(selectedEntry)}
                    className="cursor-pointer hover:brightness-110 truncate max-w-[80px]"
                    title={sat.name}
                  >
                    {sat.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeselectSatellite(satId)}
                    title="Remove satellite"
                    className="text-gray-400 hover:text-red-400 transition-colors duration-150 cursor-pointer ml-0.5"
                  >
                    <X size={12} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {selectionLimitReached && (
          <div className="text-[10px] text-amber-300 border border-amber-500/50 bg-amber-500/15 px-2.5 py-1 rounded-full font-medium">
            Selection limit reached (max 6).
          </div>
        )}
      </div>
      <ForecastOverlay
        loading={loading}
        onCommitOffset={handleCommitOffset}
        onReset={handleReset}
      />

      {/* Left Panel - Selected Satellite  */}

      <LeftPanel
        selected={focusedSelected}
        reentryRisk={selectedReentryRisk}
        metadata={selectedMetadata}
        isFollowingSelected={followingSatelliteId === focusedSatelliteId}
        onToggleFollow={handleToggleFollowSelected}
        showTrack={Boolean(showTrackById[focusedSatelliteId ?? -1])}
        onToggleTrack={handleToggleTrack}
        showOrbitPath={Boolean(showOrbitPathById[focusedSatelliteId ?? -1])}
        onToggleOrbitPath={handleToggleOrbitPath}
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
