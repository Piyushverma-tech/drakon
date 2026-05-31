'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppSelector } from '@/lib/store';
import { generateSatelliteOrbitPathAsync } from '@/lib/satelliteWorker';
import { SatelliteOrbitPath, SatellitePoint, TleEntry } from '@/lib/types';

type Options = {
  entries: TleEntry[];
  selectedIds: number[];
  selectedPositionsById: Map<number, SatellitePoint>;
  enabledById: Record<number, boolean>;
};

type OrbitPathRequest = {
  id: number;
  l1: string;
  l2: string;
  positionKey: string;
};

function positionKey(position: SatellitePoint) {
  return `${position.lat.toFixed(4)}:${position.lon.toFixed(4)}:${position.alt.toFixed(1)}`;
}

function pruneInactive<T>(items: Record<number, T>, activeIds: Set<number>) {
  let changed = false;
  const next = { ...items };
  for (const id of Object.keys(next).map(Number)) {
    if (!activeIds.has(id)) {
      delete next[id];
      changed = true;
    }
  }
  return changed ? next : items;
}

export function useSelectedSatelliteOrbitPaths({
  entries,
  selectedIds,
  selectedPositionsById,
  enabledById,
}: Options) {
  const [orbitPathsById, setOrbitPathsById] = useState<
    Record<number, SatelliteOrbitPath>
  >({});
  const [orbitPathLoadingById, setOrbitPathLoadingById] = useState<
    Record<number, boolean>
  >({});
  const simulationOffsetHours = useAppSelector(
    (s) => s.visualization.simulationOffsetHours
  );
  const requestSeqByIdRef = useRef<Record<number, number>>({});
  const requestKeyByIdRef = useRef<Record<number, string>>({});

  const entryById = useMemo(
    () => new Map(entries.map((entry) => [entry.id, entry])),
    [entries]
  );

  const selectionPlan = useMemo(() => {
    const requests: OrbitPathRequest[] = [];
    const keyParts: string[] = [];

    for (const id of selectedIds) {
      const enabled = Boolean(enabledById[id]);
      const entry = entryById.get(id);
      const position = selectedPositionsById.get(id);
      const posKey = position ? positionKey(position) : 'missing';

      keyParts.push(
        `${id}:${enabled}:${posKey}:${entry?.l1 ?? ''}:${entry?.l2 ?? ''}`
      );

      if (enabled && entry?.l1 && entry?.l2 && position) {
        requests.push({ id, l1: entry.l1, l2: entry.l2, positionKey: posKey });
      }
    }

    return { key: keyParts.join('|'), requests };
  }, [selectedIds, selectedPositionsById, enabledById, entryById]);

  const selectionPlanRef = useRef(selectionPlan);
  useEffect(() => {
    selectionPlanRef.current = selectionPlan;
  }, [selectionPlan]);

  useEffect(() => {
    const requests = selectionPlanRef.current.requests;
    const activeIds = new Set(requests.map((request) => request.id));
    const knownIds = new Set(
      [
        ...Object.keys(requestSeqByIdRef.current),
        ...Object.keys(requestKeyByIdRef.current),
      ].map(Number)
    );

    for (const id of knownIds) {
      if (!activeIds.has(id)) {
        requestSeqByIdRef.current[id] = (requestSeqByIdRef.current[id] ?? 0) + 1;
        delete requestKeyByIdRef.current[id];
      }
    }

    setOrbitPathsById((prev) => pruneInactive(prev, activeIds));
    setOrbitPathLoadingById((prev) => pruneInactive(prev, activeIds));

    for (const request of requests) {
      const satId = request.id;
      const requestKey = `${request.l1}:${request.l2}:${simulationOffsetHours}:${request.positionKey}`;
      if (requestKeyByIdRef.current[satId] === requestKey) continue;

      const requestSeq = (requestSeqByIdRef.current[satId] ?? 0) + 1;
      requestSeqByIdRef.current[satId] = requestSeq;
      requestKeyByIdRef.current[satId] = requestKey;
      setOrbitPathLoadingById((prev) => ({ ...prev, [satId]: true }));

      const centerDate = new Date(
        Date.now() + simulationOffsetHours * 60 * 60 * 1000
      );

      void generateSatelliteOrbitPathAsync(request.l1, request.l2, centerDate)
        .then((result) => {
          if (
            requestSeqByIdRef.current[satId] !== requestSeq ||
            requestKeyByIdRef.current[satId] !== requestKey
          ) {
            return;
          }
          setOrbitPathsById((prev) => {
            if (!result) {
              const next = { ...prev };
              delete next[satId];
              return next;
            }
            return { ...prev, [satId]: result };
          });
        })
        .catch((err) => {
          console.warn('Orbit path generation failed', err);
          if (
            requestSeqByIdRef.current[satId] !== requestSeq ||
            requestKeyByIdRef.current[satId] !== requestKey
          ) {
            return;
          }
          setOrbitPathsById((prev) => {
            const next = { ...prev };
            delete next[satId];
            return next;
          });
        })
        .finally(() => {
          if (
            requestSeqByIdRef.current[satId] !== requestSeq ||
            requestKeyByIdRef.current[satId] !== requestKey
          ) {
            return;
          }
          setOrbitPathLoadingById((prev) => ({ ...prev, [satId]: false }));
        });
    }
  }, [selectionPlan.key, simulationOffsetHours]);

  return { orbitPathsById, orbitPathLoadingById };
}
