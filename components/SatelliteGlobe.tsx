'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import Globe from './Globe';
import { ScatterplotLayer } from 'deck.gl';
import { positionFromTLE } from '@/lib/satellite';
import * as satellite from 'satellite.js';
import { ArrowBigDown, ArrowBigUp, Satellite, X } from 'lucide-react';
import { TleEntry, useTle } from '@/lib/tle-context';

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

function classifyOrbit(inclination: number, alt: number): string {
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
  const { tleRef, searchResults, setSearchQuery, setSearchResults } = useTle();

  // Strongly-typed ref for the Globe instance to avoid `any`
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

  // Fetch TLEs
  useEffect(() => {
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

      tleRef.current = allEntries;

      // initial position calc
      updatePositions();
      setLoading(false);
    }

    function updatePositions() {
      if (!tleRef.current.length) return;
      const now = new Date();

      const pts: SatellitePoint[] = tleRef.current
        .map((e) => {
          try {
            const p = positionFromTLE(e.l1, e.l2, now);
            // Skip satellites with invalid positions
            if (p.lat === 0 && p.lon === 0 && p.altKm === 0) {
              console.warn(
                `Skipping satellite ${e.id} due to invalid position`
              );
              return null;
            }
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

      setSatellites(pts);
    }

    fetchAllTLEs();

    //offload to Web Worker later
    const timer = setInterval(updatePositions, 10_000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

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
    // Main satellite layer
    new ScatterplotLayer<SatellitePoint>({
      id: 'satellite-layer',
      data: filteredSatellites,
      getPosition: (d) => [d.lon, d.lat, d.alt * 200],
      getFillColor: (d): [number, number, number, number] =>
        d.id === selected?.id ? [0, 150, 255, 255] : colorAccessor(d),
      radiusUnits: 'meters',
      getRadius: (d) => {
        if (d.id === selected?.id) {
          return d.isDebris ? 50000 : 80000; // Larger radius for selected
        }
        return d.isDebris ? 30000 : 70000;
      },
      opacity: 0.85,
      pickable: true,
      onClick: (info) => {
        const pt = info.object as SatellitePoint | null;
        if (!pt) return;
        const meta = tleRef.current.find((t) => t.id === pt.id);
        if (!meta) return;

        const vel = velocityFromTLE(meta.l1, meta.l2, new Date());
        const orbitType = classifyOrbit(meta.inclination, pt.alt);

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

  function focusSatellite(sat: TleEntry) {
    try {
      // compute current position
      const p = positionFromTLE(sat.l1, sat.l2, new Date());

      // Check if position is valid
      if (p.lat === 0 && p.lon === 0 && p.altKm === 0) {
        console.warn(`Cannot focus on satellite ${sat.id}: invalid position`);
        return;
      }

      // fly to it (lon, lat)
      globeRef.current?.flyTo({
        longitude: p.lon,
        latitude: p.lat,
        zoom: 2.5,
        durationMs: 1400,
        // optional: pitch/bearing for better angle
        pitch: 30,
        bearing: 0,
      });

      const vel = velocityFromTLE(sat.l1, sat.l2, new Date());
      const orbitType = classifyOrbit(sat.inclination, p.altKm);

      setSelected({
        id: sat.id,
        name: sat.name ?? 'Unknown',
        lat: p.lat,
        lon: p.lon,
        alt: p.altKm,
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
                  setSearchQuery?.('');
                  setSearchResults?.([]);
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
              className="font-medium text-cyan-400 text-xs uppercase tracking-wider flex justify-between items-center cursor-pointer"
              onClick={() => setOverviewExpanded(!overviewExpanded)}
            >
              <span>Objects Overview</span>
              <span className="text-cyan-400">
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
                <div className="text-xs text-cyan-300/70 mt-1">
                  Showing: {stats.filtered} of {stats.total}
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
