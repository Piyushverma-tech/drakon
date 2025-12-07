import { useState, useEffect, useRef, useMemo } from 'react';
import { TleEntry } from '@/lib/tle-context';
import { generateGroundTrackAsync as generateGroundTrackWorker } from '@/lib/satelliteWorker';
import { SatellitePoint } from './useSatellitePositions';

export type BandTrack = {
  id: string;
  path: [number, number][];
};

type UseInclinationBandsOptions = {
  showBands: boolean;
  bandInclination: number;
  bandTolerance: number;
  entries: TleEntry[];
  satellites?: SatellitePoint[];
  debounceMs?: number;
};

export function useInclinationBands({
  showBands,
  bandInclination,
  bandTolerance,
  entries,
  satellites,
  debounceMs = 300,
}: UseInclinationBandsOptions) {
  const [bandInclinationDebounced, setBandInclinationDebounced] = useState(bandInclination);
  const [bandToleranceDebounced, setBandToleranceDebounced] = useState(bandTolerance);
  const [bandTrack, setBandTrack] = useState<BandTrack | null>(null);
  const [bandTrackLoading, setBandTrackLoading] = useState(false);
  const trackCache = useRef<Map<string, BandTrack | null>>(new Map());

  // Debounce inclination
  useEffect(() => {
    const timer = setTimeout(() => {
      setBandInclinationDebounced(bandInclination);
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [bandInclination, debounceMs]);

  // Debounce tolerance
  useEffect(() => {
    const timer = setTimeout(() => {
      setBandToleranceDebounced(bandTolerance);
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [bandTolerance, debounceMs]);

  // Create satellite lookup map
  const satById = useMemo(() => {
    if (!satellites) return new Map<number, SatellitePoint>();
    const m = new Map<number, SatellitePoint>();
    for (const s of satellites) m.set(s.id, s);
    return m;
  }, [satellites]);

  // Compute band membership
  const { bandSatelliteIds, bandCount, bandAvgAltKm } = useMemo(() => {
    if (!showBands || !entries.length) {
      return { bandSatelliteIds: new Set<number>(), bandCount: 0, bandAvgAltKm: 0 };
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

    return {
      bandSatelliteIds: ids,
      bandCount: count,
      bandAvgAltKm: altCount > 0 ? altSum / altCount : 0,
    };
  }, [showBands, entries, bandInclinationDebounced, bandToleranceDebounced, satById]);

  // Generate ground track
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
    generateGroundTrackWorker(rep.l1, rep.l2, 240)
      .then((path) => {
        if (cancelled) return;
        const track: BandTrack = {
          id: `band-track-${rep.id}`,
          path: path || [],
        };
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
  }, [showBands, entries, bandInclinationDebounced, bandToleranceDebounced]);

  return {
    bandInclinationDebounced,
    bandToleranceDebounced,
    bandTrack,
    bandTrackLoading,
    bandSatelliteIds,
    bandCount,
    bandAvgAltKm,
  };
}

