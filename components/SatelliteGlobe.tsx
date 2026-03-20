'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import Globe from './Globe';
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
  BandTrack,
} from '@/lib/types';
import { ArrowBigDown, ArrowBigUp, Satellite, X } from 'lucide-react';
import { useAppDispatch, useAppSelector } from '@/lib/store';
import { setEntries, clearSearch } from '@/lib/tle-slice';
import {
  setShowBands,
  setBandInclination,
  setBandTolerance,
  setShowDensity,
  setDensityRadiusKm,
  toggleFilter,
  setOverviewExpanded,
  setSelectedSatelliteId,
} from '@/lib/visualization-slice';
import {
  formatDistance,
  parseTLEMeta,
  velocityFromTLE,
  classifyOrbit,
  getOrbitType,
} from '@/lib/satelliteHelpers';
import { useSatellitePositions } from '@/hooks/useSatellitePositions';
import { useInclinationBands } from '@/hooks/useInclinationBands';
import { useCollisionDensity } from '@/hooks/useCollisionDensity';
import DensityLegend from './DensityLegend';
import { useSimulatedPositions } from '@/hooks/useSimulatedPositions';
import {
  setSimulationOffset,
  resetSimulation,
} from '@/lib/visualization-slice';
import { ForecastOverlay } from './ForeCastOverlay';

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

// ----------------------
// Main Component
// ----------------------
export default function SatelliteGlobe() {
  const dispatch = useAppDispatch();
  const searchResults = useAppSelector((state) => state.tle.searchResults);
  const entries = useAppSelector((state) => state.tle.entries);

  // Redux state
  const {
    activeFilters,
    overviewExpanded,
    showBands,
    bandInclination,
    bandTolerance,
    showDensity,
    densityRadiusKm,
    simulationOffsetHours,
    isSimulating,
  } = useAppSelector((state) => state.visualization);

  const [selected, setSelected] = useState<SelectedMeta | null>(null);
  const [filteredSatellites, setFilteredSatellites] = useState<
    SatellitePoint[]
  >([]);

  // Custom hooks
  const { satellites, loading } = useSatellitePositions({ entries });

  const offsetMs = simulationOffsetHours * 60 * 60 * 1000;

  const { satellites: activeSatellites, loading: simLoading } =
    useSimulatedPositions({
      entries,
      offsetMs,
      liveSatellites: satellites, // from useSatellitePositions
    });

  const isLoading = loading || simLoading;

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

  // Strongly typed ref for the Globe instance
  type GlobeHandle = {
    flyTo: (opts: {
      longitude: number;
      latitude: number;
      zoom?: number;
      durationMs?: number;
      pitch?: number;
      bearing?: number;
    }) => void;
  } | null;

  const globeRef = useRef<GlobeHandle>(null);

  // Fetch TLEs once into Redux
  useEffect(() => {
    if (entries.length > 0) {
      return;
    }

    const groups = [
      'active',
      '1999-025',
      'iridium-33-debris',
      'cosmos-2251-debris',
    ];
    let cancelled = false;

    async function fetchAllTLEs() {
      const allEntries: TleEntry[] = [];

      for (const group of groups) {
        try {
          const res = await fetch(`/api/tle?group=${group}`);
          const tleText = await res.text();
          const lines = tleText.split(/\r?\n/).filter(Boolean);

          for (let i = 0; i + 2 < lines.length; i += 3) {
            const name = lines[i];
            const l1 = lines[i + 1];
            const l2 = lines[i + 2];
            const id = Number(l1.substring(2, 7));

            if (!Number.isFinite(id)) continue;

            const isDebris =
              name.toLowerCase().includes('debris') ||
              name.toLowerCase().includes('cosmos') ||
              name.toLowerCase().includes('iridium');

            allEntries.push({
              id,
              name,
              operator: name.split('-')[0],
              l1,
              l2,
              ...parseTLEMeta(l1, l2),
              isDebris,
            });
          }
        } catch (err) {
          console.error(`Error loading ${group}`, err);
        }
      }

      if (cancelled) return;
      dispatch(setEntries(allEntries));
    }

    fetchAllTLEs();

    return () => {
      cancelled = true;
    };
  }, [dispatch, entries.length]);

  // Filter satellites based on active filters
  const activeFiltersSet = useMemo(
    () => new Set(activeFilters),
    [activeFilters]
  );

  useEffect(() => {
    const filtered = activeSatellites.filter((sat) => {
      const orbitType = getOrbitType(sat.meanMotion, sat.isDebris);
      return activeFiltersSet.has(orbitType);
    });
    setFilteredSatellites(filtered);
  }, [activeSatellites, activeFiltersSet]);

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
  }, [entries, filteredSatellites, activeSatellites.length]);

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
  const getSatelliteDensity = (satId: number): number => {
    if (!showDensity || satelliteDensities.size === 0) {
      return 0;
    }
    return satelliteDensities.get(satId) || 0;
  };

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

  const densityLayers =
    showDensity && densityResult && densityResult.candidatePairs.length > 0
      ? [
          new LineLayer<CandidatePairDatum>({
            id: 'collision-candidate-lines',
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

  const layers = [
    // Inclination band path layer
    ...(showBands && bandTrack
      ? [
          new PathLayer<BandTrack>({
            id: 'inclination-band',
            data: [bandTrack],
            getPath: (d) => d.path,
            getColor: [0, 200, 255, 180],
            widthMinPixels: 2,
            opacity: 0.7,
            pickable: false,
          }),
        ]
      : []),
    ...densityLayers,
    // Main satellite layer
    new ScatterplotLayer<SatellitePoint>({
      id: 'satellite-layer',
      data: filteredSatellites,
      getPosition: (d) => [d.lon, d.lat, d.alt * 300],
      getFillColor: (d): [number, number, number, number] => {
        if (d.id === selected?.id) return [0, 150, 255, 255];
        if (showBands && bandSatelliteIds.has(d.id)) {
          // Highlight satellites in current band
          return [0, 255, 255, 220];
        }
        if (showDensity) {
          const density = getSatelliteDensity(d.id);
          return getDensityBasedColor(density);
        }

        // Normal orbit-based coloring when density map is off
        return colorAccessor(d);
      },
      radiusUnits: 'meters',
      getRadius: (d) => {
        if (d.id === selected?.id) {
          return d.isDebris ? 50000 : 80000; // Larger radius for selected
        }
        if (showBands && bandSatelliteIds.has(d.id)) {
          return d.isDebris ? 40000 : 90000;
        }
        // Slightly increase size for satellites in dense regions
        const baseRadius = d.isDebris ? 30000 : 70000;
        if (showDensity) {
          const density = getSatelliteDensity(d.id);
          if (density > 0) {
            // Increase radius by up to 30% for high density
            return baseRadius * (1 + density * 0.3);
          }
        }
        return baseRadius;
      },
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
            id: 'selected-glow-layer',
            data: filteredSatellites.filter((s) => s.id === selected.id),
            getPosition: (d) => [d.lon, d.lat, d.alt * 300],
            getFillColor: (): [number, number, number, number] =>
              showDensity ? [255, 105, 255, 180] : [0, 200, 255, 100],
            radiusUnits: 'meters',
            getRadius: (d) => (d.isDebris ? 80000 : 150000), //glow radius
            opacity: 0.6,
            pickable: false,
          }),
        ]
      : []),
  ];

  async function focusSatellite(sat: TleEntry) {
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

      globeRef.current?.flyTo({
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
  }

  // ----------------------
  // UI
  // ----------------------
  return (
    <div className="relative w-full h-full flex">
      <Globe ref={globeRef} layers={layers} />

      <ForecastOverlay
        isSimulating={isSimulating}
        isLoading={isLoading}
        simulationOffsetHours={simulationOffsetHours}
        simLoading={simLoading}
        onCommitOffset={(hours) => dispatch(setSimulationOffset(hours))}
        onReset={() => dispatch(resetSimulation())}
      />

      {searchResults && searchResults.length > 0 && (
        <div className="absolute top-0 left-1/2 transform -translate-x-1/2 z-20">
          {/* Corner accents */}
          <div className="absolute top-0 left-0 w-2 h-2 border-l border-t border-cyan-400" />
          <div className="absolute top-0 right-0 w-2 h-2 border-r border-t border-cyan-400" />
          <div className="absolute bottom-0 left-0 w-2 h-2 border-l border-b border-cyan-400" />
          <div className="absolute bottom-0 right-0 w-2 h-2 border-r border-b border-cyan-400" />
          <div className="w-96 h-64 bg-black/70 backdrop-blur-md border border-gray-700/30 rounded-lg shadow-2xl relative">
            <div className="sticky top-0 bg-black/80 backdrop-blur-sm border-b border-gray-700/30 p-2 text-center">
              <span className="text-cyan-400 text-sm font-medium uppercase tracking-wider">
                Search Results ({searchResults.length})
              </span>
              <X
                className="absolute top-2 right-2 cursor-pointer text-gray-400 hover:text-white transition-colors"
                size={18}
                onClick={() => {
                  dispatch(clearSearch());
                }}
              />
            </div>
            <ul className="overflow-auto h-[calc(100%-3rem)]">
              {searchResults.map((sat) => (
                <li
                  key={sat.id}
                  onClick={() => focusSatellite(sat)}
                  className={`p-3 hover:bg-cyan-500/20 cursor-pointer transition-all duration-200 border-b border-gray-700/30 last:border-b-0 ${
                    selected?.id === sat.id
                      ? 'bg-cyan-500/30 border-cyan-400/50'
                      : 'hover:border-cyan-400/30'
                  }`}
                >
                  <div className="flex justify-between items-center">
                    <span
                      className={`text-sm truncate ${
                        selected?.id === sat.id
                          ? 'text-cyan-300 font-medium'
                          : 'text-white'
                      }`}
                    >
                      {sat.name}
                    </span>
                    <span
                      className={`text-xs ${
                        selected?.id === sat.id
                          ? 'text-cyan-400'
                          : 'text-gray-400'
                      }`}
                    >
                      #{sat.id}
                    </span>
                  </div>
                  {selected?.id === sat.id && (
                    <div className="text-xs text-cyan-400 mt-1">Selected</div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {/* Left Panel - Selected Satellite  */}
      {selected && !isLoading && (
        <div className="absolute left-3 top-0 w-60 bg-black/40 backdrop-blur-md border border-gray-400/30 p-3 text-sm overflow-y-auto z-10">
          {/* Corner accents */}
          <div className="absolute top-0 left-0 w-2 h-2 border-l border-t border-cyan-400" />
          <div className="absolute top-0 right-0 w-2 h-2 border-r border-t border-cyan-400" />
          <div className="absolute bottom-0 left-0 w-2 h-2 border-l border-b border-cyan-400" />
          <div className="absolute bottom-0 right-0 w-2 h-2 border-r border-b border-cyan-400" />

          <div
            className="font-medium mb-1 truncate text-cyan-300 border-b border-gray-700/60 text-sm uppercase tracking-wider"
            title={selected.name}
          >
            <span className="flex items-center gap-2 mb-2">
              {selected.name} <Satellite size={18} />
            </span>
          </div>
          <div className="grid grid-cols-2 text-xs gap-x-2 gap-y-1.5">
            <span className="text-gray-400">NORAD</span>
            <span className="text-white ">{selected.id}</span>
            <span className="text-gray-400">Lat</span>
            <span className="text-white">{selected.lat.toFixed(2)}°</span>
            <span className="text-gray-400">Lon</span>
            <span className="text-white ">{selected.lon.toFixed(2)}°</span>
            <span className="text-gray-400">Alt</span>
            <span className="text-white">{Math.round(selected.alt)} km</span>
            <span className="text-gray-400">Vel</span>
            <span className="text-white ">{selected.vel.toFixed(2)} km/s</span>
            <span className="text-gray-400">Inclination</span>
            <span className="text-white ">
              {selected.inclination.toFixed(2)}°
            </span>
            <span className="text-gray-400">Orbit</span>
            <span className="text-white">{selected.orbitType}</span>
            {selected.tleEpoch && (
              <>
                <span className="text-gray-400">TLE epoch</span>
                <span className="text-white">{selected.tleEpoch}</span>
              </>
            )}
          </div>
          <button
            onClick={() => {
              setSelected(null);
              dispatch(setSelectedSatelliteId(null));
            }}
            className="mt-2 text-xs text-red-400 hover:text-red-300  underline"
          >
            Close
          </button>
        </div>
      )}

      {/* Right Panel */}
      <div className="absolute right-3 top-0 w-60 bg-black/40 backdrop-blur-md border border-gray-400/30 p-3 text-sm overflow-y-auto z-10">
        {/* Corner accents */}
        <div className="absolute top-0 left-0 w-2 h-2 border-l border-t border-cyan-400" />
        <div className="absolute top-0 right-0 w-2 h-2 border-r border-t border-cyan-400" />
        <div className="absolute bottom-0 left-0 w-2 h-2 border-l border-b border-cyan-400" />
        <div className="absolute bottom-0 right-0 w-2 h-2 border-r border-b border-cyan-400" />

        {isLoading ? (
          <div className="flex items-center justify-center h-full text-cyan-300/60">
            Loading Data...
          </div>
        ) : (
          <>
            {/* Orbit Filters */}

            <div
              className="font-medium text-cyan-300 text-xs uppercase tracking-wider flex justify-between items-center cursor-pointer"
              onClick={() => dispatch(setOverviewExpanded(!overviewExpanded))}
            >
              <span>Objects Overview</span>
              <span className="text-cyan-300">
                {overviewExpanded ? (
                  <ArrowBigDown className="w-4 h-4" />
                ) : (
                  <ArrowBigUp className="w-4 h-4" />
                )}
              </span>
            </div>
            {overviewExpanded && (
              <>
                <div className="grid grid-cols-2 gap-2 my-4">
                  {[
                    {
                      type: 'LEO',
                      color: 'bg-red-500',
                      label: 'LEO',
                      stats: `${stats.leo}`,
                    },
                    {
                      type: 'MEO',
                      color: 'bg-orange-400',
                      label: 'MEO',
                      stats: `${stats.meo}`,
                    },
                    {
                      type: 'GEO',
                      color: 'bg-green-500',
                      label: 'GEO',
                      stats: `${stats.geo}`,
                    },
                    {
                      type: 'Debris',
                      color: 'bg-gray-400',
                      label: 'Debris',
                      stats: `${stats.debris}`,
                    },
                  ].map(({ type, color, label, stats }) => (
                    <button
                      key={type}
                      onClick={() => dispatch(toggleFilter(type))}
                      className={`flex items-center gap-1 px-2 py-1 text-[11px] rounded transition-all duration-200 cursor-pointer ${
                        activeFiltersSet.has(type)
                          ? 'bg-cyan-500/30 text-cyan-300 border border-cyan-400/50'
                          : 'bg-gray-700/50 text-gray-400 hover:bg-gray-600/50 hover:text-gray-300'
                      }`}
                    >
                      <span className={`w-2 h-2 rounded-full ${color}`} />
                      {label}
                      <span className="ml-auto">{stats}</span>
                    </button>
                  ))}
                </div>
                <div className="text-[11px] text-gray-300 mt-1 mb-3">
                  Showing: {stats.filtered} of {stats.total}
                </div>

                {/* Inclination bands controls */}
                <div className="mt-2 pt-2 border-t border-gray-700/60 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-cyan-300 text-xs uppercase tracking-wider">
                      Inclination Bands
                    </span>
                    <button
                      type="button"
                      onClick={() => dispatch(setShowBands(!showBands))}
                      className={`px-2 py-0.5 rounded text-[11px] border transition-colors cursor-pointer ${
                        showBands
                          ? 'bg-cyan-500/30 text-cyan-200 border-cyan-400/60'
                          : 'bg-gray-800/60 text-gray-300 border-gray-600 hover:bg-gray-700/60'
                      }`}
                    >
                      {showBands ? 'On' : 'Off'}
                    </button>
                  </div>

                  {showBands && (
                    <div className="space-y-3">
                      {/* Inclination Slider */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[11px] text-gray-300">
                          <span>Inclination</span>
                          <span>{bandInclination.toFixed(1)}°</span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={120}
                          step={0.5}
                          value={bandInclination}
                          onChange={(e) =>
                            dispatch(
                              setBandInclination(parseFloat(e.target.value))
                            )
                          }
                          className="w-full accent-cyan-400"
                        />
                      </div>

                      {/* Tolerance Slider */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[11px] text-gray-300">
                          <span>Tolerance (±)</span>
                          <span>{bandTolerance.toFixed(1)}°</span>
                        </div>
                        <input
                          type="range"
                          min={0.5}
                          max={10}
                          step={0.5}
                          value={bandTolerance}
                          onChange={(e) =>
                            dispatch(
                              setBandTolerance(parseFloat(e.target.value))
                            )
                          }
                          className="w-full accent-cyan-400"
                        />
                        <div className="text-[10px] text-gray-400">
                          {bandInclination.toFixed(1)}° ±{' '}
                          {bandTolerance.toFixed(1)}°
                        </div>
                      </div>

                      {bandTrackLoading && (
                        <div className="text-[10px] text-cyan-400/70 mt-2">
                          Generating ground track...
                        </div>
                      )}

                      {bandCount > 0 && (
                        <div className="mt-1 rounded border border-cyan-500/40 bg-black/40 px-2 py-1.5 text-[11px] text-cyan-100 space-y-1">
                          <div className="flex  text-xs text-gray-300 justify-between">
                            <span>Satellites</span>
                            <span>{bandCount}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Avg Altitude</span>
                            <span>{Math.round(bandAvgAltKm)} km</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {/* Collision Density Map */}
                <div className="mt-2 border-t border-gray-700/60 pt-2">
                  {isLoading ? (
                    <div className="flex items-center justify-center h-full text-cyan-300/60">
                      Loading Data...
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-cyan-300 uppercase tracking-wider">
                          Collision Density Map
                        </span>
                        <button
                          type="button"
                          onClick={() => dispatch(setShowDensity(!showDensity))}
                          className={`px-2 py-0.5 rounded text-[11px] border transition-colors cursor-pointer ${
                            showDensity
                              ? 'bg-cyan-500/20 text-cyan-200 border-cyan-400/60'
                              : 'bg-gray-800/60 text-gray-300 border-gray-600 hover:bg-gray-700/60'
                          }`}
                        >
                          {showDensity ? 'On' : 'Off'}
                        </button>
                      </div>

                      {showDensity && (
                        <div className="space-y-2 text-[11px] text-gray-300">
                          <div className="flex items-center justify-between">
                            <span>Detection Radius</span>
                            <span>{densityRadiusKm.toFixed(0)} km</span>
                          </div>
                          <input
                            type="range"
                            min={10}
                            max={250}
                            step={5}
                            value={densityRadiusKm}
                            onChange={(e) =>
                              dispatch(
                                setDensityRadiusKm(parseFloat(e.target.value))
                              )
                            }
                            className="w-full accent-cyan-400"
                          />
                          <div className="text-[10px] text-gray-400">
                            Larger radius captures more potential close
                            approaches.
                          </div>

                          {/* Density Color Legend */}
                          <DensityLegend />

                          <div className="text-[11px] text-gray-200">
                            {densityLoading && (
                              <span>Analyzing density...</span>
                            )}
                            {!densityLoading && densityResult && (
                              <div className="space-y-1">
                                <span>
                                  Hotspots: {densityResult.stats.totalCells} ·
                                  Top pairs:{' '}
                                  {densityResult.candidatePairs.length}
                                </span>
                                <div className="text-[10px] text-gray-400">
                                  Peak density:{' '}
                                  {densityResult.stats.maxCellCount} sats ·
                                  Radius {densityResult.stats.detectionRadiusKm}{' '}
                                  km
                                </div>
                              </div>
                            )}
                            {!densityLoading && densityError && (
                              <span className="text-red-400">
                                {densityError}
                              </span>
                            )}
                          </div>
                          {densityResult &&
                            densityResult.candidatePairs.length > 0 && (
                              <div className="mt-4 space-y-1 text-[10px] text-gray-300">
                                <div className="uppercase tracking-wider text-gray-400">
                                  Top Close Approaches
                                </div>
                                <div className="max-h-48 overflow-auto space-y-1 pr-1">
                                  {densityResult.candidatePairs
                                    .slice(0, 10)
                                    .map((pair) => (
                                      <div
                                        key={`${pair.idA}-${pair.idB}`}
                                        className="flex items-center justify-between rounded border border-gray-700/60 px-2 py-1"
                                      >
                                        <div className="flex flex-col text-gray-200">
                                          <span>
                                            #{pair.idA} ↔ #{pair.idB}
                                          </span>
                                          <span className="text-[9px] text-gray-400">
                                            Alt {Math.round(pair.altitudeA)} /{' '}
                                            {Math.round(pair.altitudeB)} km
                                          </span>
                                        </div>
                                        <div className="text-right">
                                          <span
                                            className={
                                              pair.distanceKm <=
                                              densityRadiusKm / 2
                                                ? 'text-red-300'
                                                : 'text-cyan-200'
                                            }
                                          >
                                            {formatDistance(pair.distanceKm)}
                                          </span>
                                        </div>
                                      </div>
                                    ))}
                                </div>
                              </div>
                            )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
