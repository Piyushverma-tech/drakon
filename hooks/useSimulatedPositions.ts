import { useState, useEffect } from 'react';
import { TleEntry, SatellitePoint } from '@/lib/types';
import { batchPositionAtOffsetAsync } from '@/lib/satelliteWorker';
import { setSimLoading } from '@/lib/visualization-slice';
import { useAppDispatch } from '@/lib/store';

const EARTH_RADIUS_KM = 6371;

function normalizeAltitude(altKm: number): number {
  if (altKm > 42000) return altKm - EARTH_RADIUS_KM;
  if (altKm > 50000) {
    console.warn(`Unusually high altitude detected: ${altKm} km`);
    return Math.min(altKm, 50000);
  }
  return altKm;
}

type Options = {
  entries: TleEntry[];
  offsetMs: number;
  liveSatellites: SatellitePoint[]; // pass-through when offset === 0
  updateIntervalMs?: number;
  debounceMs?: number;
};

export function useSimulatedPositions({
  entries,
  offsetMs,
  liveSatellites,
  updateIntervalMs = 10000,
  debounceMs = 600,
}: Options) {
  const [projectedSatellites, setProjectedSatellites] = useState<
    SatellitePoint[]
  >([]);
  const dispatch = useAppDispatch();

  useEffect(() => {
    if (offsetMs === 0 || entries.length === 0) {
      setProjectedSatellites([]);
      dispatch(setSimLoading(false));

      return;
    }

    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let interval: ReturnType<typeof setInterval> | null = null;

    const compute = async (opts?: { isInitial?: boolean }) => {
      if (opts?.isInitial) {
        dispatch(setSimLoading(true));
      }
      try {
        const res = await batchPositionAtOffsetAsync(entries, offsetMs);
        if (cancelled) return;

        const pts: SatellitePoint[] = (
          res as Array<{ lat: number; lon: number; altKm: number } | null>
        )
          .map((p, idx) => {
            if (!p || (p.lat === 0 && p.lon === 0 && p.altKm === 0))
              return null;
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
        if (opts?.isInitial) {
          setProjectedSatellites([]);
        }
      } finally {
        if (!cancelled && opts?.isInitial) {
          dispatch(setSimLoading(false));
        }
      }
    };

    // Debounce the initial compute (helps when user scrubs the time slider)
    timeout = setTimeout(() => {
      compute({ isInitial: true }).catch((err) =>
        console.warn('Projected compute error', err)
      );
    }, debounceMs);

    // Keep simulated positions moving forward with real time
    interval = setInterval(() => {
      // Do not toggle `loading` every tick — that would cause UI flicker.
      // Only update positions.
      compute().catch((err) => console.warn('Projected compute error', err));
    }, updateIntervalMs);

    return () => {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
      if (interval) clearInterval(interval);
    };
  }, [entries, offsetMs, debounceMs, updateIntervalMs, dispatch]);

  // When offset is 0, return live positions directly — no stale state
  const activeSatellites =
    offsetMs === 0 ? liveSatellites : projectedSatellites;

  return { satellites: activeSatellites };
}
