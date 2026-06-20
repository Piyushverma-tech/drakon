'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { PathLayer, ScatterplotLayer } from '@deck.gl/layers';
import { COORDINATE_SYSTEM } from '@deck.gl/core';
import Globe, { GlobeHandle } from '@/app/globe/GlobeContent/Globe3D';
import { positionFromTLE } from '@/lib/satellite';
import { generateSatelliteOrbitPathAsync } from '@/lib/satelliteWorker';
import { cn } from '@/lib/utils';
import { CornerAccents } from './CornerAccents';
import type { MiniGlobeMarker, MiniGlobeProps, RgbaColor } from './types';

const DEFAULT_SATELLITE_COLOR: RgbaColor = [0, 200, 255, 220];
const DEFAULT_ORBIT_COLOR: RgbaColor = [0, 200, 255, 160];

function toLngLatPath(
  path: [number, number][] | [number, number, number][]
): [number, number][] {
  return path.map((point) => [point[0], point[1]]);
}

export function MiniGlobe({
  entry = null,
  markers = [],
  orbitColor = DEFAULT_ORBIT_COLOR,
  satelliteColor = DEFAULT_SATELLITE_COLOR,
  showOrbit = true,
  orbitSamples = 180,
  flyToZoom = 2.5,
  emptyMessage = 'Select an object to view orbit',
  className,
}: MiniGlobeProps) {
  const globeRef = useRef<GlobeHandle>(null);
  const [orbitSegments, setOrbitSegments] = useState<[number, number][][]>([]);

  const primaryPosition = useMemo(() => {
    if (!entry) return null;
    const pos = positionFromTLE(entry.l1, entry.l2);
    return {
      lat: pos.lat,
      lon: pos.lon,
      altKm: pos.altKm,
    };
  }, [entry]);

  useEffect(() => {
    if (!entry || !showOrbit) {
      setOrbitSegments([]);
      return;
    }

    let cancelled = false;
    generateSatelliteOrbitPathAsync(
      entry.l1,
      entry.l2,
      new Date(),
      orbitSamples
    ).then((orbitPath) => {
      if (cancelled || !orbitPath) return;
      setOrbitSegments(
        orbitPath.segments.map((segment) => toLngLatPath(segment.path))
      );
    });

    return () => {
      cancelled = true;
    };
  }, [entry, showOrbit, orbitSamples]);

  const flyTarget = useMemo(() => {
    if (primaryPosition) {
      return { lat: primaryPosition.lat, lon: primaryPosition.lon };
    }
    const firstMarker = markers[0];
    if (firstMarker) {
      return { lat: firstMarker.lat, lon: firstMarker.lon };
    }
    return null;
  }, [markers, primaryPosition]);

  const markersId = markers[0]?.id;

  useEffect(() => {
    if (!flyTarget || !globeRef.current) return;
    globeRef.current.flyTo({
      longitude: flyTarget.lon,
      latitude: flyTarget.lat,
      zoom: flyToZoom,
      durationMs: 1000,
    });
  }, [flyTarget, flyToZoom, entry?.id, markersId]);

  const scatterData = useMemo(() => {
    const points: MiniGlobeMarker[] = [];

    if (primaryPosition) {
      points.push({
        id: entry?.id ?? 'primary',
        lat: primaryPosition.lat,
        lon: primaryPosition.lon,
        altKm: primaryPosition.altKm,
        color: satelliteColor,
      });
    }

    for (const marker of markers) {
      points.push(marker);
    }

    return points;
  }, [entry?.id, markers, primaryPosition, satelliteColor]);

  const layers = useMemo(() => {
    const pathLayers =
      showOrbit && orbitSegments.length > 0
        ? orbitSegments.map(
            (path, index) =>
              new PathLayer({
                id: `mini-globe-orbit-${index}`,
                data: [{ path }],
                getPath: (datum: { path: [number, number][] }) => datum.path,
                getColor: orbitColor,
                getWidth: 2,
                widthMinPixels: 1,
                coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
                wrapLongitude: true,
                pickable: false,
              })
          )
        : [];

    const markerLayer =
      scatterData.length > 0
        ? new ScatterplotLayer<MiniGlobeMarker>({
            id: 'mini-globe-markers',
            data: scatterData,
            getPosition: (datum) => [datum.lon, datum.lat, datum.altKm * 300],
            getFillColor: (datum) => datum.color ?? satelliteColor,
            getRadius: (datum) => datum.radiusMeters ?? 55000,
            radiusUnits: 'meters',
            pickable: false,
          })
        : null;

    return markerLayer ? [...pathLayers, markerLayer] : pathLayers;
  }, [orbitColor, orbitSegments, satelliteColor, scatterData, showOrbit]);

  const hasContent = scatterData.length > 0 || layers.length > 0;

  return (
    <div
      className={cn(
        'relative bg-black/60 border border-white/10 overflow-hidden',
        className
      )}
    >
      <CornerAccents />
      {!hasContent ? (
        <div className="flex h-full items-center justify-center px-6 text-center text-[11px] text-gray-500 uppercase tracking-wider">
          {emptyMessage}
        </div>
      ) : (
        <Globe ref={globeRef} layers={layers} />
      )}
    </div>
  );
}
