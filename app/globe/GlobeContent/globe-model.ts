import { DensityResult, SatellitePoint, TleEntry } from '@/lib/types';
import {
  classifyOrbit,
  getOrbitType,
  velocityFromTLE,
} from '@/lib/satelliteHelpers';

export type SelectedMeta = {
  id: number;
  name: string;
  lat: number;
  lon: number;
  alt: number;
  vel: number;
  inclination: number;
  orbitType: string;
  apogeeKm: number;
  perigeeKm: number;
  ecc: number;
  tleEpoch?: string;
};

export type SelectedTagMeta = {
  id: number;
  name: string;
};

export type GlobeStats = {
  debris: number;
  leo: number;
  meo: number;
  geo: number;
  total: number;
  filtered: number;
};

export type CandidatePairDatum = DensityResult['candidatePairs'][number];

export function getLoadErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Unable to load satellite data right now.';
}

export function buildSelectedMeta(
  selectedPosition: SatellitePoint,
  meta: TleEntry,
  simulationOffsetHours: number
): SelectedMeta {
  const targetDate = new Date(
    Date.now() + simulationOffsetHours * 60 * 60 * 1000
  );
  const vel = velocityFromTLE(meta.l1, meta.l2, targetDate);
  const orbitType = classifyOrbit(meta.inclination);

  return {
    id: selectedPosition.id,
    name: meta.name ?? 'Unknown',
    lat: selectedPosition.lat,
    lon: selectedPosition.lon,
    alt: selectedPosition.alt,
    vel,
    inclination: meta.inclination,
    orbitType,
    apogeeKm: meta.apogeeKm,
    perigeeKm: meta.perigeeKm,
    ecc: meta.ecc,
    tleEpoch: meta.tleEpoch,
  };
}

export function buildSelectedTagsById(
  selectedIds: number[],
  selectedPositionsById: Map<number, SatellitePoint>,
  entryById: Map<number, TleEntry>
): Record<number, SelectedTagMeta> {
  const next: Record<number, SelectedTagMeta> = {};

  for (const satId of selectedIds) {
    const position = selectedPositionsById.get(satId);
    const meta = entryById.get(satId);
    if (!position && !meta) continue;

    next[satId] = {
      id: satId,
      name: position?.name ?? meta?.name ?? 'Unknown',
    };
  }

  return next;
}

export function buildGlobeStats(
  entries: TleEntry[],
  activeSatelliteCount: number,
  filteredSatelliteCount: number
): GlobeStats {
  const debris = entries.filter((entry) => entry.isDebris).length;
  const leo = entries.filter(
    (entry) => getOrbitType(entry.meanMotion, entry.isDebris) === 'LEO'
  ).length;
  const meo = entries.filter(
    (entry) => getOrbitType(entry.meanMotion, entry.isDebris) === 'MEO'
  ).length;
  const geo = entries.filter(
    (entry) => getOrbitType(entry.meanMotion, entry.isDebris) === 'GEO'
  ).length;

  return {
    debris,
    leo,
    meo,
    geo,
    total: activeSatelliteCount,
    filtered: filteredSatelliteCount,
  };
}

export function splitBandAtAntimeridian(
  path: [number, number][]
): [number, number][][] {
  const segments: [number, number][][] = [[]];

  for (let i = 0; i < path.length; i++) {
    segments.at(-1)!.push(path[i]);
    if (i < path.length - 1 && Math.abs(path[i + 1][0] - path[i][0]) > 180) {
      segments.push([]);
    }
  }

  return segments.filter((segment) => segment.length > 1);
}
