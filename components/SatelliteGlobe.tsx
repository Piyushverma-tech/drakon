'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import Globe from './Globe';
import { ScatterplotLayer } from 'deck.gl';
import { positionFromTLE } from '@/lib/satellite';
import * as satellite from 'satellite.js';
import { ArrowBigDown, ArrowBigUp } from 'lucide-react';

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

type TleEntry = {
  id: number;
  name: string;
  l1: string;
  l2: string;
  inclination: number;
  tleEpoch: string;
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
  const satrec = satellite.twoline2satrec(l1, l2);
  const pv = satellite.propagate(satrec, date);
  const vel = pv?.velocity;
  if (!vel) return 0;
  return Math.sqrt(vel.x ** 2 + vel.y ** 2 + vel.z ** 2); // km/s
}

function classifyOrbit(inclination: number, alt: number): string {
  if (inclination < 10) return 'Equatorial';
  if (Math.abs(inclination - 90) < 5) return 'Polar';
  if (inclination >= 96 && inclination <= 99) return 'Sun-synchronous';
  return 'Inclined';
}

// ----------------------
// Main Component
// ----------------------
export default function SatelliteGlobe() {
  const [satellites, setSatellites] = useState<SatellitePoint[]>([]);
  const tleRef = useRef<TleEntry[]>([]);
  const [selected, setSelected] = useState<SelectedMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [overviewExpanded, setOverviewExpanded] = useState(false);

  // Fetch TLE once
  useEffect(() => {
    async function fetchSatellites() {
      try {
        const params = new URLSearchParams([
          ['group', 'active'],
          ['group', '1999-025'],
          ['group', 'iridium-33-debris'],
          ['limit', '2000'],
        ]);
        const tleText = await (
          await fetch(`/api/tle?${params.toString()}`)
        ).text();

        const lines = tleText.split(/\r?\n/).filter(Boolean);
        const entries: TleEntry[] = [];

        for (let i = 0; i + 2 < lines.length; i += 3) {
          const name = lines[i];
          const l1 = lines[i + 1];
          const l2 = lines[i + 2];
          const id = Number(l1.substring(2, 7));

          const isDebris =
            name.toLowerCase().includes('debris') ||
            name.toLowerCase().includes('cosmos') ||
            name.toLowerCase().includes('iridium');

          if (Number.isFinite(id)) {
            entries.push({
              id,
              name,
              l1,
              l2,
              ...parseTLEMeta(l1, l2),
              isDebris,
            });
          }
        }

        tleRef.current = entries;
        setLoading(false);
      } catch (err) {
        console.error('Error fetching satellites', err);
        setLoading(false);
      }
    }

    fetchSatellites();

    // Update positions every 5s
    const tick = () => {
      if (!tleRef.current.length) return;
      const now = new Date();
      const pts: SatellitePoint[] = tleRef.current.slice(0, 1000).map((e) => {
        const p = positionFromTLE(e.l1, e.l2, now);
        return {
          id: e.id,
          lat: p.lat,
          lon: p.lon,
          alt: p.altKm,
          isDebris: e.isDebris,
        };
      });
      setSatellites(pts);
    };

    tick();
    const timer = setInterval(tick, 5000);
    return () => clearInterval(timer);
  }, []);

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
    return { debris, leo, meo, geo, total: satellites.length };
  }, [satellites]);

  // ----------------------
  // Layers
  // ----------------------
  const colorAccessor = (d: SatellitePoint & { isDebris?: boolean }) => {
    if (d.isDebris) return [180, 180, 180, 180]; // debris gray
    if (d.alt > 2000) return [0, 255, 0, 160]; // green: high orbit
    if (d.alt > 1000) return [255, 165, 0, 180]; // orange: MEO
    return [255, 0, 0, 160]; // red: LEO
  };

  const layers = [
    new ScatterplotLayer<SatellitePoint>({
      id: 'satellite-layer',
      data: satellites,
      getPosition: (d) => [d.lon, d.lat, d.alt * 200],
      getFillColor: (d) =>
        d.id === selected?.id ? [0, 0, 255, 255] : (colorAccessor(d) as any),
      radiusUnits: 'meters',
      getRadius: (d) => (d.isDebris ? 30000 : 70000),
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
  ];

  // ----------------------
  // UI
  // ----------------------
  return (
    <div className="relative w-full h-full flex">
      <Globe layers={layers} />

      {/* Right Panel */}
      <div className="absolute right-3 top-3 w-60 bg-black/40 backdrop-blur-md border border-gray-400/30 p-3 text-sm overflow-y-auto z-10">
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
            <div
              className="font-medium  text-cyan-400 text-xs uppercase tracking-wider flex justify-between items-center cursor-pointer"
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
                <div className="grid grid-cols-2 gap-x-2 gap-y-2 mt-3 text-xs">
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-3 rounded-full bg-red-500" /> LEO
                  </span>
                  <span className="text-white ">{stats.leo}</span>
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-3 rounded-full bg-orange-400" /> MEO
                  </span>
                  <span className="text-white ">{stats.meo}</span>
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-3 rounded-full bg-green-500" /> GEO+
                  </span>
                  <span className="text-white ">{stats.geo}</span>
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-3 rounded-full bg-gray-400" /> Debris
                  </span>
                  <span className="text-white ">{stats.debris}</span>
                </div>
                <div className="mt-2 text-xs text-cyan-300/70 ">
                  Total objects:{' '}
                  <span className="text-white font-semibold">
                    {stats.total}
                  </span>
                </div>
              </>
            )}
          </>
        )}

        {/* Selected Satellite */}
        {selected && !loading && (
          <div className="mt-3 border-t border-emerald-500/30 pt-2">
            <div
              className="font-medium mb-1 truncate text-emerald-400  text-sm uppercase tracking-wider"
              title={selected.name}
            >
              {selected.name}
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
