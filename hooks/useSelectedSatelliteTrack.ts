'use client';
import { useState, useEffect, useRef } from 'react';
import { useAppSelector } from '@/lib/store';
import { generateSatelliteTrackAsync } from '@/lib/satelliteWorker';
import { TleEntry, SatelliteTrack } from '@/lib/types';

type Options = {
  entries: TleEntry[];
  selectedId: number | null;
};

export function useSelectedSatelliteTrack({ entries, selectedId }: Options) {
  const [track, setTrack] = useState<SatelliteTrack | null>(null);
  const [trackLoading, setTrackLoading] = useState(false);
  const simulationOffsetHours = useAppSelector(
    (s) => s.visualization.simulationOffsetHours
  );

  // Stable ref to avoid stale closure in async callback
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!selectedId) {
      setTrack(null);
      setTrackLoading(false);
      return;
    }

    const entry = entries.find((e) => e.id === selectedId);
    if (!entry?.l1 || !entry?.l2) {
      setTrack(null);
      return;
    }

    const thisRequest = ++requestIdRef.current;
    setTrackLoading(true);

    const centerDate = new Date(
      Date.now() + simulationOffsetHours * 60 * 60 * 1000
    );

    generateSatelliteTrackAsync(entry.l1, entry.l2, centerDate)
      .then((result) => {
        if (thisRequest !== requestIdRef.current) return; // stale
        setTrack(result);
      })
      .catch((err) => {
        console.warn('Track generation failed', err);
        if (thisRequest !== requestIdRef.current) return;
        setTrack(null);
      })
      .finally(() => {
        if (thisRequest !== requestIdRef.current) return;
        setTrackLoading(false);
      });
  }, [selectedId, entries, simulationOffsetHours]);

  return { track, trackLoading };
}
