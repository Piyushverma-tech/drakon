'use client';

import { useEffect, useMemo, useRef } from 'react';
import {
  ScatterplotLayer,
  PathLayer,
  LineLayer,
  COORDINATE_SYSTEM,
} from 'deck.gl';
import {
  BandTrack,
  DensityResult,
  OrbitPathSegment,
  ReentryRisk,
  SatelliteOrbitPath,
  SatellitePoint,
  SatelliteTrack,
  TrackSegment,
} from '@/lib/types';
import { colorForId } from '@/lib/satellite-colors';
import { getOrbitType } from '@/lib/satelliteHelpers';
import {
  CandidatePairDatum,
  SelectedMeta,
  splitBandAtAntimeridian,
} from './globe-model';

type Options = {
  viewMode: '3D' | '2D';
  filteredSatellites: SatellitePoint[];
  showBands: boolean;
  bandTrack: BandTrack | null;
  bandSatelliteIds: Set<number>;
  showDensity: boolean;
  densityResult: DensityResult | null;
  densityRadiusKm: number;
  satelliteDensities: Map<number, number>;
  showReentry: boolean;
  reentryRisks: Map<number, ReentryRisk>;
  selectedSatelliteIds: number[];
  focusedSelected: SelectedMeta | null;
  tracksById: Record<number, SatelliteTrack>;
  showTrackById: Record<number, boolean>;
  orbitPathsById: Record<number, SatelliteOrbitPath>;
  showOrbitPathById: Record<number, boolean>;
  onSatelliteClick: (satId: number) => void;
};

function baseSatelliteColor(
  satellite: SatellitePoint & { isDebris?: boolean }
): [number, number, number, number] {
  const orbitType = getOrbitType(satellite.meanMotion, satellite.isDebris);
  if (satellite.isDebris) return [180, 180, 180, 180];
  if (orbitType === 'GEO') return [0, 255, 0, 180];
  if (orbitType === 'MEO') return [255, 165, 0, 180];
  if (orbitType === 'LEO') return [255, 0, 0, 180];
  return [180, 180, 180, 180];
}

function densityColor(
  normalizedDensity: number
): [number, number, number, number] {
  if (normalizedDensity === 0) return [80, 160, 255, 180];

  const t = Math.pow(normalizedDensity, 0.7);

  if (t < 0.2) {
    const factor = t / 0.2;
    return [Math.round(80 + factor * 20), Math.round(160 + factor * 60), 255, 180];
  }

  if (t < 0.4) {
    const factor = (t - 0.2) / 0.2;
    return [
      Math.round(100 - factor * 20),
      Math.round(220 - factor * 80),
      Math.round(255 - factor * 155),
      200,
    ];
  }

  if (t < 0.7) {
    const factor = (t - 0.4) / 0.3;
    return [
      Math.round(80 + factor * 175),
      Math.round(140 + factor * 115),
      Math.round(100 - factor * 100),
      220,
    ];
  }

  const factor = (t - 0.7) / 0.3;
  return [255, Math.round(255 - factor * 255), 0, 240];
}

export function useGlobeLayers({
  viewMode,
  filteredSatellites,
  showBands,
  bandTrack,
  bandSatelliteIds,
  showDensity,
  densityResult,
  densityRadiusKm,
  satelliteDensities,
  showReentry,
  reentryRisks,
  selectedSatelliteIds,
  focusedSelected,
  tracksById,
  showTrackById,
  orbitPathsById,
  showOrbitPathById,
  onSatelliteClick,
}: Options) {
  const reentryRisksRef = useRef(reentryRisks);
  useEffect(() => {
    reentryRisksRef.current = reentryRisks;
  }, [reentryRisks]);

  const getSatelliteDensity = useMemo(
    () =>
      (satId: number): number => {
        if (!showDensity || satelliteDensities.size === 0) return 0;
        return satelliteDensities.get(satId) || 0;
      },
    [showDensity, satelliteDensities]
  );

  const densityLayers = useMemo(() => {
    const modePrefix = viewMode.toLowerCase();
    return showDensity &&
      densityResult &&
      densityResult.candidatePairs.length > 0
      ? [
          new LineLayer<CandidatePairDatum>({
            id: `${modePrefix}-collision-candidate-lines`,
            data: densityResult.candidatePairs,
            pickable: true,
            coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
            wrapLongitude: true,
            getSourcePosition: (d) => [d.lonA, d.latA],
            getTargetPosition: (d) => [d.lonB, d.latB],
            getColor: (d) =>
              d.distanceKm <= densityRadiusKm / 2
                ? [255, 80, 200, 220]
                : [255, 200, 200, 180],
            getWidth: 2,
            widthUnits: 'pixels',
          }),
        ]
      : [];
  }, [densityRadiusKm, densityResult, showDensity, viewMode]);

  const trackLayers = useMemo(() => {
    const modePrefix = viewMode.toLowerCase();
    const layersOut: PathLayer<TrackSegment>[] = [];

    const makePath = (
      satId: number,
      segments: TrackSegment[],
      color: [number, number, number],
      idSuffix: string
    ) =>
      segments.map(
        (seg, i) =>
          new PathLayer<TrackSegment>({
            id: `${modePrefix}-sat-track-${satId}-${idSuffix}-${i}`,
            data: [seg],
            getPath: (d) => d.path,
            getColor: () =>
              [color[0], color[1], color[2], Math.round(seg.opacity * 100)] as [
                number,
                number,
                number,
                number,
              ],
            getWidth: 3.5,
            widthMinPixels: 1.5,
            widthMaxPixels: 3.5,
            widthUnits: 'pixels',
            opacity: seg.opacity,
            pickable: false,
            coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
            wrapLongitude: true,
          })
      );

    for (const satId of selectedSatelliteIds) {
      const track = tracksById[satId];
      if (!track || !showTrackById[satId]) continue;

      const color = colorForId(satId, selectedSatelliteIds);
      if (!color) continue;

      layersOut.push(...makePath(satId, track.past, color, 'past'));
      layersOut.push(...makePath(satId, track.future, color, 'future'));
    }

    return layersOut;
  }, [selectedSatelliteIds, showTrackById, tracksById, viewMode]);

  const orbitPathLayers = useMemo(() => {
    if (viewMode !== '3D') return [];

    const layersOut: PathLayer<OrbitPathSegment>[] = [];
    for (const satId of selectedSatelliteIds) {
      if (!showOrbitPathById[satId]) continue;

      const orbitPath = orbitPathsById[satId];
      if (!orbitPath) continue;

      const color = colorForId(satId, selectedSatelliteIds);
      if (!color) continue;

      layersOut.push(
        ...orbitPath.segments.map(
          (segment, i) =>
            new PathLayer<OrbitPathSegment>({
              id: `3d-selected-orbit-path-${satId}-${i}`,
              data: [segment],
              getPath: (d) =>
                d.path.map(
                  ([lon, lat, altKm]) =>
                    [lon, lat, altKm * 300] as [number, number, number]
                ),
              getColor: [color[0], color[1], color[2], 190],
              getWidth: 2.5,
              widthMinPixels: 1.5,
              widthMaxPixels: 3,
              widthUnits: 'pixels',
              opacity: 0.75,
              pickable: false,
              coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
              wrapLongitude: true,
            })
        )
      );
    }

    return layersOut;
  }, [orbitPathsById, selectedSatelliteIds, showOrbitPathById, viewMode]);

  return useMemo(
    () => [
      ...(showBands && bandTrack
        ? splitBandAtAntimeridian(bandTrack.path).map(
            (segment, i) =>
              new PathLayer({
                id: `${viewMode.toLowerCase()}-inclination-band-${i}`,
                data: [segment],
                getPath: (d) => d,
                getColor: [0, 200, 255, 180],
                widthMinPixels: 1.5,
                opacity: 0.7,
                pickable: false,
              })
          )
        : []),
      ...densityLayers,
      ...trackLayers,
      ...orbitPathLayers,
      new ScatterplotLayer<SatellitePoint>({
        id: `${viewMode.toLowerCase()}-satellite-layer`,
        data: filteredSatellites,
        getPosition: (d) => [d.lon, d.lat, viewMode === '2D' ? 0 : d.alt * 300],
        getFillColor: (d): [number, number, number, number] => {
          const selectedColor = colorForId(d.id, selectedSatelliteIds);
          if (selectedColor) {
            return [selectedColor[0], selectedColor[1], selectedColor[2], 255];
          }

          if (showBands) {
            return bandSatelliteIds.has(d.id) ? [0, 255, 255, 220] : [60, 60, 80, 100];
          }

          if (showDensity) {
            return densityColor(getSatelliteDensity(d.id));
          }

          if (showReentry) {
            const risk = reentryRisksRef.current.get(d.id);
            if (risk?.tier === 'critical') return [255, 60, 40, 230];
            if (risk?.tier === 'warning') return [255, 160, 30, 210];
            if (risk?.tier === 'nominal') return [255, 220, 80, 180];
            return [60, 60, 80, 100];
          }

          return baseSatelliteColor(d);
        },
        radiusUnits: viewMode === '2D' ? 'pixels' : 'meters',
        getRadius: (d) => {
          if (viewMode === '2D') {
            if (selectedSatelliteIds.includes(d.id)) return d.isDebris ? 4 : 6;
            if (showReentry && reentryRisksRef.current.has(d.id)) return 2.5;

            const base = d.isDebris ? 2 : 2.5;
            const density = getSatelliteDensity(d.id);
            return showDensity && density > 0 ? base * (1 + density * 0.5) : base;
          }

          if (selectedSatelliteIds.includes(d.id)) {
            return d.isDebris ? 30000 : 60000;
          }
          if (showReentry && reentryRisksRef.current.has(d.id)) return 40000;

          const baseRadius = d.isDebris ? 15000 : 30000;
          const density = getSatelliteDensity(d.id);
          return showDensity && density > 0
            ? baseRadius * (1 + density * 0.3)
            : baseRadius;
        },
        radiusMinPixels: 1,
        radiusMaxPixels: 6,
        opacity: 0.9,
        pickable: true,
        onClick: (info) => {
          const satellite = info.object as SatellitePoint | null;
          if (satellite) onSatelliteClick(satellite.id);
        },
      }),
      ...(focusedSelected
        ? [
            new ScatterplotLayer<SatellitePoint>({
              id: `${viewMode.toLowerCase()}-selected-glow-layer`,
              data: filteredSatellites.filter(
                (satellite) => satellite.id === focusedSelected.id
              ),
              getPosition: (d) => [
                d.lon,
                d.lat,
                viewMode === '2D' ? 0 : d.alt * 300,
              ],
              getFillColor: (): [number, number, number, number] => {
                const color = colorForId(
                  focusedSelected.id,
                  selectedSatelliteIds
                );
                if (!color) return [0, 200, 255, 100];
                return [color[0], color[1], color[2], showDensity ? 150 : 110];
              },
              radiusUnits: viewMode === '2D' ? 'pixels' : 'meters',
              getRadius: (d) => {
                if (viewMode === '2D') return d.isDebris ? 10 : 15;
                return d.isDebris ? 80000 : 150000;
              },
              opacity: 0.6,
              pickable: false,
            }),
          ]
        : []),
    ],
    [
      bandSatelliteIds,
      bandTrack,
      densityLayers,
      filteredSatellites,
      focusedSelected,
      getSatelliteDensity,
      onSatelliteClick,
      orbitPathLayers,
      selectedSatelliteIds,
      showBands,
      showDensity,
      showReentry,
      trackLayers,
      viewMode,
    ]
  );
}
