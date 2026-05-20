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
  candidatePairs: CandidatePair[]; // Nearest close-approach pairs returned for map/list rendering. Full detected count is tracked in stats.totalCandidatePairs.
  satelliteDensities?: Record<number, number>;
  stats: {
    totalSatellites: number;
    totalCells: number;
    maxCellCount: number;
    totalCandidatePairs: number;
    displayedCandidatePairs: number;
    closeApproachSatelliteCount: number;
    maxSatelliteDensity: number;
    maxRawSatelliteDensity: number;
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
  meanMotionDot: number;
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

export type SatelliteMetadata = {
  noradId: number;

  // UCS fields: rich metadata for active payloads
  name?: string;
  operator?: string;
  country?: string;
  purpose?: string;
  userType?: string;
  orbitClass?: string;
  launchDate?: string;
  launchSite?: string;
  launchVehicle?: string;
  massKg?: number;

  // CelesTrak SATCAT fields: basic metadata for all catalog objects
  cosparId?: string;
  objectName?: string;
  objectType?: 'PAYLOAD' | 'ROCKET BODY' | 'DEBRIS' | 'UNKNOWN';
  orbitStatus?: string;
  countryCode?: string;
  decayDate?: string | null;
  periodMinutes?: number;
  inclination?: number;
  apogeeKm?: number;
  perigeeKm?: number;

  // Source tracking
  source: 'ucs+celestrak' | 'ucs' | 'celestrak' | 'none';
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

export type ReentryRisk = {
  satId: number;
  bstar: number;
  meanMotionDot: number; // first derivative of mean motion, rev/day^2
  signalsAgree: boolean; // BSTAR-derived decay and meanMotionDot both indicate decay
  confidence: 'high' | 'medium' | 'low';
  altKm: number; // current altitude (from meanMotion)
  decayRateKmPerDay: number; // estimated altitude loss per day
  estimatedDaysRemaining: number | null; // null = stable / indeterminate
  tier: 'critical' | 'warning' | 'nominal' | 'stable';
  // critical = < 30 days
  // warning/nominal = altitude- and confidence-adjusted longer horizons
  // stable = beyond horizon, invalid signal, or GEO/deep-space
};
export type TrackSegment = {
  path: [number, number][]; // [lon, lat] pairs, antimeridian-split
  opacity: number; // 0–1, used as getColor alpha multiplier
};

export type SatelliteTrack = {
  satId: number;
  past: TrackSegment[]; // array because antimeridian split produces N segments
  future: TrackSegment[]; // same
};
