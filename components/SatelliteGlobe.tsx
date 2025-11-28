'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import Globe from './Globe';
import { ScatterplotLayer, PathLayer } from 'deck.gl';
import { positionFromTLE } from '@/lib/satellite';
import {
  positionFromTLEAsync,
  batchPositionFromTLEAsync,
  generateGroundTrackAsync as generateGroundTrackWorker,
} from '@/lib/satelliteWorker';
import * as satellite from 'satellite.js';
import { ArrowBigDown, ArrowBigUp, Satellite, X } from 'lucide-react';
import { TleEntry } from '@/lib/tle-context';
import { useAppDispatch, useAppSelector } from '@/lib/store';
import { setEntries, clearSearch } from '@/lib/tle-slice';

// ----------------------
// Types
// ----------------------
type SatellitePoint = {
  id: number;
  lat: number;
  lon: number;
  alt: number; // km
  isDebris?: boolean;
};

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

type BandTrack = {
  id: string;
  path: [number, number][];
};

// ----------------------
// Helpers
// ----------------------
function tleEpochToIso(line1: string): string {
  const epochYear2 = parseInt(line1.slice(18, 20), 10);
  const epochDay = parseFloat(line1.slice(20, 32));
  if (Number.isNaN(epochYear2) || Number.isNaN(epochDay)) return '';

  const year = epochYear2 < 57 ? 2000 + epochYear2 : 1900 + epochYear2;
  const msPerDay = 24 * 60 * 60 * 1000;
  const epochMillis =
    Date.UTC(year, 0, 1) + Math.round((epochDay - 1) * msPerDay);

  return new Date(epochMillis).toISOString();
}

function parseTLEMeta(l1: string, l2: string) {
  const inclination = parseFloat(l2.slice(8, 16));
  const tleEpoch = tleEpochToIso(l1);
  return { inclination, tleEpoch };
}

function velocityFromTLE(l1: string, l2: string, date: Date) {
  try {
    const satrec = satellite.twoline2satrec(l1, l2);
    const pv = satellite.propagate(satrec, date);
    const vel = pv?.velocity;
    if (!vel) return 0;
    return Math.sqrt(vel.x ** 2 + vel.y ** 2 + vel.z ** 2); // km/s
  } catch (error) {
    console.warn('Error calculating velocity from TLE:', error);
    return 0;
  }
}

function classifyOrbit(inclination: number): string {
  if (inclination < 10) return 'Equatorial';
  if (Math.abs(inclination - 90) < 5) return 'Polar';
  if (inclination >= 96 && inclination <= 99) return 'Sun-synchronous';
  return 'Inclined';
}

function getOrbitType(alt: number, isDebris?: boolean): string {
  if (isDebris) return 'Debris';
  if (alt <= 1000) return 'LEO';
  if (alt <= 2000) return 'MEO';
  return 'GEO';
}

// Generate ground track path for a representative orbit (async, uses worker)
async function generateGroundTrackAsync(
  entry: TleEntry,
  samples: number = 240
): Promise<BandTrack | null> {
  try {
    const path = await generateGroundTrackWorker(entry.l1, entry.l2, samples);
    if (!path || path.length === 0) return null;

    return {
      id: `band-track-${entry.id}`,
      path,
    };
  } catch (error) {
    console.warn('Error generating ground track:', error);
    return null;
  }
}

// ----------------------
// Main Component
// ----------------------
export default function SatelliteGlobe() {
  const [satellites, setSatellites] = useState<SatellitePoint[]>([]);
  const [filteredSatellites, setFilteredSatellites] = useState<
    SatellitePoint[]
  >([]);
  const [selected, setSelected] = useState<SelectedMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [overviewExpanded, setOverviewExpanded] = useState(false);
  const [activeFilters, setActiveFilters] = useState<Set<string>>(
    new Set(['LEO', 'MEO', 'GEO', 'Debris'])
  );
  const [showBands, setShowBands] = useState(false);
  const [bandInclination, setBandInclination] = useState(53); // e.g. Starlink shell
  const [bandInclinationDebounced, setBandInclinationDebounced] = useState(53);
  const [bandTolerance, setBandTolerance] = useState(2); // degrees, user-adjustable
  const [bandToleranceDebounced, setBandToleranceDebounced] = useState(2);
  const [bandTrack, setBandTrack] = useState<BandTrack | null>(null);
  const [bandTrackLoading, setBandTrackLoading] = useState(false);
  const dispatch = useAppDispatch();
  const searchResults = useAppSelector((state) => state.tle.searchResults);
  const entries = useAppSelector((state) => state.tle.entries);

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

    const groups = ['active', '1999-025', 'iridium-33-debris'];
    let cancelled = false;

    async function fetchAllTLEs() {
      setLoading(true);
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
      setLoading(false);
    }

    fetchAllTLEs();

    return () => {
      cancelled = true;
    };
  }, [dispatch, entries.length]);

  // Compute satellite positions
  useEffect(() => {
    if (!entries.length) return;

    let cancelled = false;

    async function updatePositions() {
      if (!entries.length || cancelled) return;
      const now = new Date();

      try {
        const items = entries.map((e) => ({
          l1: e.l1,
          l2: e.l2,
          date: now,
        }));
        const res = await batchPositionFromTLEAsync(items);
        const pts: SatellitePoint[] = (
          res as Array<{ lat: number; lon: number; altKm: number } | null>
        )
          .map((p, idx: number) => {
            try {
              if (!p) return null;
              if (p.lat === 0 && p.lon === 0 && p.altKm === 0) {
                console.warn(
                  `Skipping satellite ${entries[idx].id} due to invalid position`
                );
                return null;
              }
              return {
                id: entries[idx].id,
                lat: p.lat,
                lon: p.lon,
                alt: p.altKm,
                isDebris: entries[idx].isDebris,
              } as SatellitePoint;
            } catch (err) {
              console.warn(
                `Error processing satellite ${entries[idx].id}:`,
                err
              );
              return null;
            }
          })
          .filter((pt): pt is SatellitePoint => pt !== null);

        if (!cancelled) {
          setSatellites(pts);
        }
      } catch (err) {
        console.warn(
          'Satellite worker failed, falling back to sync position calc',
          err
        );
        // fallback to synchronous calculation
        const pts: SatellitePoint[] = entries
          .map((e) => {
            try {
              const p = positionFromTLE(e.l1, e.l2, now);
              if (p.lat === 0 && p.lon === 0 && p.altKm === 0) return null;
              return {
                id: e.id,
                lat: p.lat,
                lon: p.lon,
                alt: p.altKm,
                isDebris: e.isDebris,
              } as SatellitePoint;
            } catch (error) {
              console.warn(`Error processing satellite ${e.id}:`, error);
              return null;
            }
          })
          .filter((pt): pt is SatellitePoint => pt !== null);

        if (!cancelled) {
          setSatellites(pts);
        }
      }
    }

    // initial position calc
    updatePositions().catch((err) =>
      console.warn('initial updatePositions error', err)
    );

    // update positions every 10 seconds
    const timer = setInterval(() => {
      updatePositions().catch((err) =>
        console.warn('updatePositions error', err)
      );
    }, 10_000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [entries]);

  // Filter satellites based on active filters
  useEffect(() => {
    const filtered = satellites.filter((sat) => {
      const orbitType = getOrbitType(sat.alt, sat.isDebris);
      return activeFilters.has(orbitType);
    });
    setFilteredSatellites(filtered);
  }, [satellites, activeFilters]);

  // Toggle filter function
  const toggleFilter = (filterType: string) => {
    setActiveFilters((prev) => {
      const newFilters = new Set(prev);
      if (newFilters.has(filterType)) {
        newFilters.delete(filterType);
      } else {
        newFilters.add(filterType);
      }
      return newFilters;
    });
  };

  // ----------------------
  // Stats Computation
  // ----------------------
  const stats = useMemo(() => {
    const debris = satellites.filter((s) => s.isDebris).length;
    const leo = satellites.filter((s) => !s.isDebris && s.alt <= 1000).length;
    const meo = satellites.filter(
      (s) => !s.isDebris && s.alt > 1000 && s.alt <= 2000
    ).length;
    const geo = satellites.filter((s) => !s.isDebris && s.alt > 2000).length;
    return {
      debris,
      leo,
      meo,
      geo,
      total: satellites.length,
      filtered: filteredSatellites.length,
    };
  }, [satellites, filteredSatellites]);

  //before heavy loop, we can use a map to look up satellites by id
  const satById = useMemo(() => {
    const m = new Map<number, SatellitePoint>();
    for (const s of satellites) m.set(s.id, s);
    return m;
  }, [satellites]);

  // Inclination band membership & stats (use debounced value)
  const { bandSatelliteIds, bandCount, bandAvgAltKm } = useMemo(() => {
    if (!showBands || !entries.length) {
      return {
        bandSatelliteIds: new Set<number>(),
        bandCount: 0,
        bandAvgAltKm: 0,
      };
    }

    const ids = new Set<number>();
    let count = 0;
    let altSum = 0;
    let altCount = 0;

    for (const entry of entries) {
      if (
        Math.abs(entry.inclination - bandInclinationDebounced) <=
        bandToleranceDebounced
      ) {
        ids.add(entry.id);
        count += 1;
        const sat = satById.get(entry.id);
        if (sat) {
          altSum += sat.alt;
          altCount++;
        }
      }
    }

    const avgAlt = altCount > 0 ? altSum / altCount : 0;

    return {
      bandSatelliteIds: ids,
      bandCount: count,
      bandAvgAltKm: avgAlt,
    };
  }, [
    showBands,
    entries,
    satById,
    bandInclinationDebounced,
    bandToleranceDebounced,
  ]);

  // Debounce slider inputs to prevent expensive recalculations on every drag
  useEffect(() => {
    const timer = setTimeout(() => {
      setBandInclinationDebounced(bandInclination);
    }, 300); // 300ms debounce
    return () => clearTimeout(timer);
  }, [bandInclination]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setBandToleranceDebounced(bandTolerance);
    }, 300); // 300ms debounce
    return () => clearTimeout(timer);
  }, [bandTolerance]);

  // Ground track for current inclination band (uses worker)
  const trackCache = useRef<Map<string, BandTrack | null>>(new Map());

  useEffect(() => {
    let cancelled = false;

    if (!showBands || !entries.length) {
      setBandTrack(null);
      setBandTrackLoading(false);
      return () => {
        cancelled = true;
      };
    }

    const key = `band-${bandInclinationDebounced}-${bandToleranceDebounced}`;
    if (trackCache.current.has(key)) {
      setBandTrack(trackCache.current.get(key) ?? null);
      setBandTrackLoading(false);
      return () => {
        cancelled = true;
      };
    }

    const rep = entries.find(
      (e) =>
        Math.abs(e.inclination - bandInclinationDebounced) <=
        bandToleranceDebounced
    );
    if (!rep) {
      setBandTrack(null);
      setBandTrackLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setBandTrackLoading(true);
    generateGroundTrackAsync(rep, 240)
      .then((track) => {
        if (cancelled) return;
        trackCache.current.set(key, track);
        setBandTrack(track);
        setBandTrackLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('Failed to generate ground track:', err);
        setBandTrack(null);
        setBandTrackLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    showBands,
    entries,
    bandInclinationDebounced,
    bandToleranceDebounced,
  ]);

  // ----------------------
  // Layers
  // ----------------------
  const colorAccessor = (
    d: SatellitePoint & { isDebris?: boolean }
  ): [number, number, number, number] => {
    if (d.isDebris) return [180, 180, 180, 180]; // debris gray
    if (d.alt > 2000) return [0, 255, 0, 160]; // green: high orbit
    if (d.alt > 1000) return [255, 165, 0, 180]; // orange: MEO
    return [255, 0, 0, 160]; // red: LEO
  };

  const layers = [
    // Inclination band path layer (under satellites)
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
    // Main satellite layer
    new ScatterplotLayer<SatellitePoint>({
      id: 'satellite-layer',
      data: filteredSatellites,
      getPosition: (d) => [d.lon, d.lat, d.alt * 200],
      getFillColor: (d): [number, number, number, number] => {
        if (d.id === selected?.id) return [0, 150, 255, 255];
        if (showBands && bandSatelliteIds.has(d.id)) {
          // Highlight satellites in current band
          return [0, 255, 255, 220];
        }
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
        return d.isDebris ? 30000 : 70000;
      },
      opacity: 0.85,
      pickable: true,
      onClick: (info) => {
        const pt = info.object as SatellitePoint | null;
        if (!pt) return;
        const meta = entries.find((t: TleEntry) => t.id === pt.id);
        if (!meta) return;

        const vel = velocityFromTLE(meta.l1, meta.l2, new Date());
        const orbitType = classifyOrbit(meta.inclination);

        setSelected({
          id: pt.id,
          name: meta.name ?? 'Unknown',
          lat: pt.lat,
          lon: pt.lon,
          alt: pt.alt,
          vel,
          inclination: meta.inclination,
          orbitType,
          tleEpoch: meta.tleEpoch,
        });
      },
    }),
    // Glow effect layer for selected satellite
    ...(selected
      ? [
          new ScatterplotLayer<SatellitePoint>({
            id: 'selected-glow-layer',
            data: filteredSatellites.filter((s) => s.id === selected.id),
            getPosition: (d) => [d.lon, d.lat, d.alt * 200],
            getFillColor: (): [number, number, number, number] => [
              0, 200, 255, 100,
            ],
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
      // compute current position
      const p = await positionFromTLEAsync(sat.l1, sat.l2, new Date());

      if (!p) {
        console.warn(`Cannot focus on satellite ${sat.id}: invalid position`);
        return;
      }
      const pp = p as { lat: number; lon: number; altKm: number };
      if (pp.lat === 0 && pp.lon === 0 && pp.altKm === 0) {
        console.warn(`Cannot focus on satellite ${sat.id}: invalid position`);
        return;
      }

      // fly to it (lon, lat)
      globeRef.current?.flyTo({
        longitude: pp.lon,
        latitude: pp.lat,
        zoom: 2.5,
        durationMs: 1400,
        pitch: 30,
        bearing: 0,
      });

      const vel = velocityFromTLE(sat.l1, sat.l2, new Date());
      const orbitType = classifyOrbit(sat.inclination);

      setSelected({
        id: sat.id,
        name: sat.name ?? 'Unknown',
        lat: pp.lat,
        lon: pp.lon,
        alt: pp.altKm,
        vel,
        inclination: sat.inclination,
        orbitType,
        tleEpoch: sat.tleEpoch,
      });
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
      {/* Right Panel */}
      <div className="absolute right-3 top-0 w-60 bg-black/40 backdrop-blur-md border border-gray-400/30 p-3 text-sm overflow-y-auto z-10">
        {/* Corner accents */}
        <div className="absolute top-0 left-0 w-2 h-2 border-l border-t border-cyan-400" />
        <div className="absolute top-0 right-0 w-2 h-2 border-r border-t border-cyan-400" />
        <div className="absolute bottom-0 left-0 w-2 h-2 border-l border-b border-cyan-400" />
        <div className="absolute bottom-0 right-0 w-2 h-2 border-r border-b border-cyan-400" />

        {loading ? (
          <div className="flex items-center justify-center h-full text-cyan-300/60">
            Loading Data...
          </div>
        ) : (
          <>
            {/* Orbit Filters */}

            <div
              className="font-medium text-cyan-300 text-xs uppercase tracking-wider flex justify-between items-center cursor-pointer"
              onClick={() => setOverviewExpanded(!overviewExpanded)}
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
                      onClick={() => toggleFilter(type)}
                      className={`flex items-center gap-1 px-2 py-1 text-xs rounded transition-all duration-200 cursor-pointer ${
                        activeFilters.has(type)
                          ? 'bg-cyan-500/30 text-cyan-300 border border-cyan-400/50'
                          : 'bg-gray-700/50 text-gray-400 hover:bg-gray-600/50 hover:text-gray-300'
                      }`}
                    >
                      <span className={`w-2 h-2 rounded-full ${color}`} />
                      {label}
                      <span className="ml-auto text-xs">{stats}</span>
                    </button>
                  ))}
                </div>
                <div className="text-xs text-cyan-300/70 mt-1 mb-3">
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
                      onClick={() => setShowBands((v) => !v)}
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
                            setBandInclination(parseFloat(e.target.value))
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
                            setBandTolerance(parseFloat(e.target.value))
                          }
                          className="w-full accent-cyan-400"
                        />
                        <div className="text-[10px] text-gray-400">
                          {bandInclination.toFixed(1)}° ± {bandTolerance.toFixed(1)}°
                        </div>
                      </div>

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
              </>
            )}
          </>
        )}

        {/* Selected Satellite */}
        {selected && !loading && (
          <div className="mt-3 border-t border-emerald-500/30 pt-2">
            <div
              className="font-medium mb-1 truncate text-cyan-300  text-sm uppercase tracking-wider"
              title={selected.name}
            >
              <span className="flex items-center gap-2 mb-2">
                {selected.name} <Satellite size={18} />
              </span>
            </div>
            <div className="grid grid-cols-2 text-xs gap-x-2 gap-y-1">
              <span className="text-gray-400">NORAD</span>
              <span className="text-white ">{selected.id}</span>
              <span className="text-gray-400">Lat</span>
              <span className="text-white">{selected.lat.toFixed(2)}°</span>
              <span className="text-gray-400">Lon</span>
              <span className="text-white ">{selected.lon.toFixed(2)}°</span>
              <span className="text-gray-400">Alt</span>
              <span className="text-white">{Math.round(selected.alt)} km</span>
              <span className="text-gray-400">Vel</span>
              <span className="text-white ">
                {selected.vel.toFixed(2)} km/s
              </span>
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
              onClick={() => setSelected(null)}
              className="mt-2 text-xs text-red-400 hover:text-red-300  underline"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
