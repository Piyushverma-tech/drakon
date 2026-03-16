import { useState, useEffect } from 'react';
import { TleEntry, SatellitePoint } from '@/lib/types';
import { batchPositionAtOffsetAsync } from '@/lib/satelliteWorker';

const EARTH_RADIUS_KM = 6371;

function normalizeAltitude(altKm: number): number {
  if (altKm > 42000) return altKm - EARTH_RADIUS_KM;
  if (altKm > 50000) return 50000;
  return altKm;
}

type Options = {
  entries: TleEntry[];
  offsetMs: number;
  liveSatellites: SatellitePoint[];  // pass-through when offset === 0
  debounceMs?: number;
};

export function useSimulatedPositions({
  entries,
  offsetMs,
  liveSatellites,
  debounceMs = 600,
}: Options) {
  const [projectedSatellites, setProjectedSatellites] = useState<SatellitePoint[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (offsetMs === 0 || entries.length === 0) {
      setProjectedSatellites([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    let cancelled = false;

    const timer = setTimeout(async () => {
      try {
        const res = await batchPositionAtOffsetAsync(entries, offsetMs);
        if (cancelled) return;

        const pts: SatellitePoint[] = (res as Array<{ lat: number; lon: number; altKm: number } | null>)
          .map((p, idx) => {
            if (!p || (p.lat === 0 && p.lon === 0 && p.altKm === 0)) return null;
            return {
              id: entries[idx].id,
              lat: p.lat,
              lon: p.lon,
              alt: normalizeAltitude(p.altKm),
              operator: entries[idx].operator || '',
              name: entries[idx].name || '',
              l1: entries[idx].l1,
              l2: entries[idx].l2,
              meanMotion: entries[idx].meanMotion,
              isDebris: entries[idx].isDebris,
            } as SatellitePoint;
          })
          .filter((pt): pt is SatellitePoint => pt !== null);

        setProjectedSatellites(pts);
      } catch (err) {
        console.warn('Projected position computation failed', err);
        setProjectedSatellites([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, debounceMs);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [entries, offsetMs, debounceMs]);

  // When offset is 0, return live positions directly — no stale state
  const activeSatellites = offsetMs === 0 ? liveSatellites : projectedSatellites;

  return { satellites: activeSatellites, loading };
}