export type DensityWorkerInput = {
  id: number;
  lat: number;
  lon: number;
  altKm: number;
  operator?: string;
  name?: string;
  l1?: string;
  l2?: string;
};

export type DensityWorkerOptions = {
  voxelSizeKm?: number;
  detectionRadiusKm?: number;
  gridCellSizeDeg?: number;
  maxPairs?: number;
};

export type DensityCell = {
  lat: number;
  lon: number;
  count: number;
};

export type CandidatePair = {
  idA: number;
  idB: number;
  distanceKm: number;
  altitudeA: number;
  altitudeB: number;
  operatorA?: string;
  operatorB?: string;
  latA: number;
  lonA: number;
  latB: number;
  lonB: number;
};

export type DensityResult = {
  densityCells: DensityCell[];
  candidatePairs: CandidatePair[];
  satelliteDensities?: Record<number, number>;
  stats: {
    totalSatellites: number;
    totalCells: number;
    maxCellCount: number;
    maxSatelliteDensity?: number;
    detectionRadiusKm: number;
    voxelSizeKm: number;
    gridCellSizeDeg: number;
  };
  generatedAt: string;
};

export type TleEntry = {
  id: number;
  name: string;
  operator: string;
  l1: string;
  l2: string;
  inclination: number;
  meanMotion: number;
  tleEpoch: string;
  isDebris?: boolean;
};

export type SatellitePoint = {
  id: number;
  meanMotion: number;
  lat: number;
  lon: number;
  alt: number; // km above Earth's surface
  isDebris?: boolean;
  operator?: string;
  name?: string;
  l1?: string;
  l2?: string;
};

export type BandTrack = {
  id: string;
  path: [number, number][];
};

export interface FilterOptions {
  sameLaunchIdDiff?: number;
  relSpeedThresh?: number;
  separationThreshKm?: number;
  altDiffThreshKm?: number;
  requireVelocityCheck?: boolean;
}

export type TrackSegment = {
  path: [number, number][]; // [lon, lat] pairs, antimeridian-split
  opacity: number; // 0–1, used as getColor alpha multiplier
};

export type SatelliteTrack = {
  satId: number;
  past: TrackSegment[]; // array because antimeridian split produces N segments
  future: TrackSegment[]; // same
};
