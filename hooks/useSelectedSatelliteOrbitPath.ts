'use client';
import { useEffect, useRef, useState } from 'react';
import { useAppSelector } from '@/lib/store';
import { generateSatelliteOrbitPathAsync } from '@/lib/satelliteWorker';
import { SatelliteOrbitPath, SatellitePoint, TleEntry } from '@/lib/types';

type Options = {
  entries: TleEntry[];
  selectedId: number | null;
  selectedPosition?: SatellitePoint | null;
};

export function useSelectedSatelliteOrbitPath({
  entries,
  selectedId,
  selectedPosition,
}: Options) {
  const [orbitPath, setOrbitPath] = useState<SatelliteOrbitPath | null>(null);
  const [orbitPathLoading, setOrbitPathLoading] = useState(false);
  const simulationOffsetHours = useAppSelector(
    (s) => s.visualization.simulationOffsetHours
  );
  const selectedPositionKey = selectedPosition
    ? `${selectedPosition.id}:${selectedPosition.lat.toFixed(4)}:${selectedPosition.lon.toFixed(4)}:${selectedPosition.alt.toFixed(1)}`
    : null;

  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!selectedId) {
      setOrbitPath(null);
      setOrbitPathLoading(false);
      return;
    }

    const entry = entries.find((e) => e.id === selectedId);
    if (!entry?.l1 || !entry?.l2) {
      setOrbitPath(null);
      setOrbitPathLoading(false);
      return;
    }

    const thisRequest = ++requestIdRef.current;
    setOrbitPathLoading(true);

    const centerDate = new Date(
      Date.now() + simulationOffsetHours * 60 * 60 * 1000
    );

    generateSatelliteOrbitPathAsync(entry.l1, entry.l2, centerDate)
      .then((result) => {
        if (thisRequest !== requestIdRef.current) return;
        setOrbitPath(result);
      })
      .catch((err) => {
        console.warn('Orbit path generation failed', err);
        if (thisRequest !== requestIdRef.current) return;
        setOrbitPath(null);
      })
      .finally(() => {
        if (thisRequest !== requestIdRef.current) return;
        setOrbitPathLoading(false);
      });
  }, [selectedId, entries, simulationOffsetHours, selectedPositionKey]);

  return { orbitPath, orbitPathLoading };
}
