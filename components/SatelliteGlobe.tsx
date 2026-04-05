'use client';

import React, {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
} from 'react';
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
  ReentryRisk,
} from '@/lib/types';
import { X } from 'lucide-react';
import { useAppDispatch, useAppSelector } from '@/lib/store';
import { setEntries, clearSearch } from '@/lib/tle-slice';
import { setSelectedSatelliteId } from '@/lib/visualization-slice';
import {
  formatDistance,
  parseTLEMeta,
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
import { ForecastOverlay } from './ForeCastOverlay';
import RightPanel from './panels/RightPanel';
import LeftPanel from './panels/LeftPanel';

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
  const { showReentry } = useAppSelector((s) => s.visualization);

  // Redux state
  const {
    activeFilters,
    showBands,
    bandInclination,
    bandTolerance,
    showDensity,
    densityRadiusKm,
    simulationOffsetHours,
  } = useAppSelector((state) => state.visualization);

  const [selected, setSelected] = useState<SelectedMeta | null>(null);

  // Custom hooks
  const { satellites, loading } = useSatellitePositions({ entries });

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

  const densityLayers = useMemo(
    () =>
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
        : [],
    [showDensity, densityResult, densityRadiusKm]
  );

  const layers = useMemo(
    () => [
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
        radiusUnits: 'meters',
        getRadius: (d) => {
          if (d.id === selected?.id) {
            return d.isDebris ? 50000 : 80000; // Larger radius for selected
          }
          if (showBands && bandSatelliteIds.has(d.id)) {
            return d.isDebris ? 40000 : 90000;
          }
          if (showReentry && reentryRisksRef.current.has(d.id)) {
            return 60000; // All are debris & rocket bodies
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
    ]
  );

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
    ? (reentryRisks.get(selected.id) ??
      (showReentry
        ? null
        : entries.find((e) => e.id === selected.id)
          ? getReentryRisk(
              entries.find((e) => e.id === selected.id)!,
              selected.alt
            )
          : null))
    : null;

  // ----------------------
  // UI
  // ----------------------
  return (
    <div className="relative w-full h-full flex">
      <Globe ref={globeRef} layers={layers} />

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

      <ForecastOverlay
        loading={loading}
        onCommitOffset={handleCommitOffset}
        onReset={handleReset}
      />

      {/* Left Panel - Selected Satellite  */}
      <LeftPanel
        selected={selected}
        setSelected={setSelected}
        onClose={handleDeselectSatellite}
        reentryRisk={selectedReentryRisk}
      />
      {/* Right Panel */}
      <RightPanel
        loading={loading}
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
