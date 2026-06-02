'use client';

import { RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { GlobeHandle } from './Globe3D';
import { SatellitePoint, TleEntry } from '@/lib/types';
import { useAppDispatch } from '@/lib/store';
import {
  focusSelectedSatellite,
  removeSelectedSatellite,
  selectSatellite,
  toggleFollowingFocusedSatellite,
} from '@/lib/visualization-slice';
import { MAX_SELECTED } from '@/lib/satellite-colors';

type Options = {
  mapRef: RefObject<GlobeHandle | null>;
  viewMode: '3D' | '2D';
  selectedSatelliteIds: number[];
  focusedSatelliteId: number | null;
  followingSatelliteId: number | null;
  activeSatelliteById: Map<number, SatellitePoint>;
  selectedPositionsById: Map<number, SatellitePoint>;
  entryById: Map<number, TleEntry>;
};

export function useGlobeSelectionController({
  mapRef,
  viewMode,
  selectedSatelliteIds,
  focusedSatelliteId,
  followingSatelliteId,
  activeSatelliteById,
  selectedPositionsById,
  entryById,
}: Options) {
  const dispatch = useAppDispatch();
  const [showTrackById, setShowTrackById] = useState<Record<number, boolean>>(
    {}
  );
  const [showOrbitPathById, setShowOrbitPathById] = useState<
    Record<number, boolean>
  >({});
  const [selectionLimitReached, setSelectionLimitReached] = useState(false);

  const flyToSatellite = useCallback(
    (position: SatellitePoint) => {
      mapRef.current?.flyTo({
        longitude: position.lon,
        latitude: position.lat,
        durationMs: 900,
        pitch: viewMode === '3D' ? 30 : 0,
        bearing: 0,
      });
    },
    [mapRef, viewMode]
  );

  useEffect(() => {
    if (!followingSatelliteId) return;

    const followPosition = selectedPositionsById.get(followingSatelliteId);
    if (followPosition) flyToSatellite(followPosition);
  }, [flyToSatellite, followingSatelliteId, selectedPositionsById]);

  const enableDefaultSelectedLayers = useCallback((satId: number) => {
    setShowTrackById((prev) =>
      prev[satId] === undefined ? { ...prev, [satId]: true } : prev
    );
    setShowOrbitPathById((prev) =>
      prev[satId] === undefined ? { ...prev, [satId]: true } : prev
    );
  }, []);

  const activeSatelliteByIdRef = useRef(activeSatelliteById);
  useEffect(() => {
    activeSatelliteByIdRef.current = activeSatelliteById;
  }, [activeSatelliteById]);

  const entryByIdRef = useRef(entryById);
  useEffect(() => {
    entryByIdRef.current = entryById;
  }, [entryById]);

  const selectSatelliteById = useCallback(
    (satId: number) => {
      const isAlreadySelected = selectedSatelliteIds.includes(satId);
      if (!isAlreadySelected && selectedSatelliteIds.length >= MAX_SELECTED) {
        setSelectionLimitReached(true);
        return false;
      }

      const position = activeSatelliteByIdRef.current.get(satId);
      if (!position || !entryByIdRef.current.has(satId)) {
        return false;
      }

      setSelectionLimitReached(false);
      flyToSatellite(position);

      if (isAlreadySelected) {
        dispatch(focusSelectedSatellite(satId));
      } else {
        dispatch(selectSatellite(satId));
        enableDefaultSelectedLayers(satId);
      }

      return true;
    },
    [
      dispatch,
      enableDefaultSelectedLayers,
      flyToSatellite,
      selectedSatelliteIds,
    ]
  );

  const focusSatellite = useCallback(
    (sat: TleEntry) => {
      selectSatelliteById(sat.id);
    },
    [selectSatelliteById]
  );

  const deselectSatellite = useCallback(
    (satId: number) => {
      dispatch(removeSelectedSatellite(satId));
      setShowTrackById((prev) => {
        const next = { ...prev };
        delete next[satId];
        return next;
      });
      setShowOrbitPathById((prev) => {
        const next = { ...prev };
        delete next[satId];
        return next;
      });
      setSelectionLimitReached(false);
    },
    [dispatch]
  );

  const toggleFollowSelected = useCallback(() => {
    dispatch(toggleFollowingFocusedSatellite());
  }, [dispatch]);

  const toggleTrack = useCallback(() => {
    if (!focusedSatelliteId) return;
    setShowTrackById((prev) => ({
      ...prev,
      [focusedSatelliteId]: !prev[focusedSatelliteId],
    }));
  }, [focusedSatelliteId]);

  const toggleOrbitPath = useCallback(() => {
    if (!focusedSatelliteId) return;
    setShowOrbitPathById((prev) => ({
      ...prev,
      [focusedSatelliteId]: !prev[focusedSatelliteId],
    }));
  }, [focusedSatelliteId]);

  return {
    showTrackById,
    showOrbitPathById,
    selectionLimitReached,
    selectSatelliteById,
    focusSatellite,
    deselectSatellite,
    toggleFollowSelected,
    toggleTrack,
    toggleOrbitPath,
  };
}
