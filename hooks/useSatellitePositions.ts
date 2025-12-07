import { useState, useEffect } from 'react';
import { TleEntry, SatellitePoint } from '@/lib/types';
import { batchPositionFromTLEAsync } from '@/lib/satelliteWorker';
import { positionFromTLE } from '@/lib/satellite';

export type { SatellitePoint };

type UseSatellitePositionsOptions = {
  entries: TleEntry[];
  updateIntervalMs?: number;
};

// Earth's mean radius in km
const EARTH_RADIUS_KM = 6371;

/**
 * Validate and normalize altitude to ensure it's above Earth's surface
 */
function normalizeAltitude(altKm: number): number {
  if (altKm > 42000) {
    // Convert from center to surface
    return altKm - EARTH_RADIUS_KM;
  }

  if (altKm < 80) {
    console.warn(`Unusually low altitude detected: ${altKm} km`);
  }

  if (altKm > 50000) {
    console.warn(`Unusually high altitude detected: ${altKm} km`);
    return Math.min(altKm, 50000);
  }

  // Already correct - altitude from Earth's surface
  return altKm;
}

export function useSatellitePositions({
  entries,
  updateIntervalMs = 10000,
}: UseSatellitePositionsOptions) {
  const [satellites, setSatellites] = useState<SatellitePoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!entries.length) {
      setSatellites([]);
      setLoading(false);
      return;
    }

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
                return null;
              }

              // Normalize altitude to Earth's surface
              const normalizedAlt = normalizeAltitude(p.altKm);

              return {
                id: entries[idx].id,
                lat: p.lat,
                lon: p.lon,
                alt: normalizedAlt,
                operator: entries[idx].operator || '',
                name: entries[idx].name || '',
                l1: entries[idx].l1 || '',
                l2: entries[idx].l2 || '',
                meanMotion: entries[idx].meanMotion,
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
          setLoading(false);
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

              // Normalize altitude to Earth's surface
              const normalizedAlt = normalizeAltitude(p.altKm);

              return {
                id: e.id,
                lat: p.lat,
                lon: p.lon,
                alt: normalizedAlt,
                meanMotion: e.meanMotion,
                isDebris: e.isDebris,
                operator: e.operator || '',
                name: e.name || '',
                l1: e.l1 || '',
                l2: e.l2 || '',
              } as SatellitePoint;
            } catch (error) {
              console.warn(`Error processing satellite ${e.id}:`, error);
              return null;
            }
          })
          .filter((pt): pt is SatellitePoint => pt !== null);

        if (!cancelled) {
          setSatellites(pts);
          setLoading(false);
        }
      }
    }

    // initial position calc
    updatePositions().catch((err) =>
      console.warn('initial updatePositions error', err)
    );

    // update positions periodically
    const timer = setInterval(() => {
      updatePositions().catch((err) =>
        console.warn('updatePositions error', err)
      );
    }, updateIntervalMs);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [entries, updateIntervalMs]);

  return { satellites, loading };
}
