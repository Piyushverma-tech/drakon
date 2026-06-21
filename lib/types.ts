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
  raan: number;
  argPerigee: number;
  meanAnomaly: number;
  meanMotion: number;
  meanMotionDot: number;
  tleEpoch: string;
  isDebris?: boolean;

  ecc: number;
  perigeeKm: number;
  apogeeKm: number;
  semiMajorAxisKm: number;
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
  perigeeKm: number; // perigee altitude, which is more relevant to re-entry than mean altitude
  decayAltKm: number; // current altitude (from meanMotion)
  decayRateKmPerDay: number; // estimated altitude loss per day
  estimatedDaysRemaining: number | null; // null = stable / indeterminate
  tier: 'critical' | 'warning' | 'nominal' | 'stable';
  source?: 'single_epoch' | 'multi_epoch';
  decaySignal?: ObjectTrend['decaySignal'];
  decayConfidence?: number | null;
  maneuverLikelihood?: number | null;
  epochsAvailable?: number;
  historyDaysAvailable?: number;
  estimatedReentryAt?: string | null;
  // critical = < 30 days
  // warning/nominal = altitude- and confidence-adjusted longer horizons
  // stable = beyond horizon, invalid signal, or GEO/deep-space
};

export type ObjectTrend = {
  noradId: number;
  updatedAt: string;
  trendVersion: number;
  epochsAvailable: number;
  historyDaysAvailable: number;
  bstarLatest: number | null;
  bstarSlope7d: number | null;
  bstarSlope14d: number | null;
  bstarSlope30d: number | null;
  bstarMean14d: number | null;
  bstarStddev14d: number | null;
  bstarRsq14d: number | null;
  perigeeLatest: number | null;
  perigeeSlope7d: number | null;
  perigeeSlope14d: number | null;
  perigeeSlope30d: number | null;
  apogeeLatest: number | null;
  apogeeSlope14d: number | null;
  smaLatest: number | null;
  smaSlope7d: number | null;
  smaSlope14d: number | null;
  meanMotionDotLatest: number | null;
  meanMotionDotMean14d: number | null;
  decaySignal: 'decaying' | 'stable' | 'maneuvering' | 'insufficient_data';
  maneuverLikelihood: number | null;
  decayConfidence: number | null;
  estimatedDaysRemaining: number | null;
  estimatedReentryAt: string | null;
  reentryTier: 'critical' | 'warning' | 'nominal' | 'stable';
  objectType: 'debris' | 'rocket_body' | 'payload' | 'unknown' | null;
  isDebris: boolean;
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

export type OrbitPathSegment = {
  path: [number, number, number][]; // [lon, lat, altKm] pairs, antimeridian-split
};

export type SatelliteOrbitPath = {
  satId: number;
  segments: OrbitPathSegment[];
};
