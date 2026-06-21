import * as satellite from 'satellite.js';
import { ReentryRisk, TleEntry } from './types';
import { DEFAULT_SOLAR_FLUX_MULTIPLIER } from './solarFlux';

const EARTH_RADIUS_KM = 6378.137;

// Format distance
export function formatDistance(distanceKm: number): string {
  if (distanceKm >= 1) {
    return `${distanceKm.toFixed(2)} km`;
  }
  return `${Math.max(distanceKm * 1000, 0).toFixed(0)} m`;
}

// Convert TLE epoch (year + day of year) to ISO string

export function tleEpochToIso(line1: string): string {
  const epochYear2 = parseInt(line1.slice(18, 20), 10);
  const epochDay = parseFloat(line1.slice(20, 32));
  if (Number.isNaN(epochYear2) || Number.isNaN(epochDay)) return '';

  const year = epochYear2 < 57 ? 2000 + epochYear2 : 1900 + epochYear2;
  const msPerDay = 24 * 60 * 60 * 1000;
  const epochMillis =
    Date.UTC(year, 0, 1) + Math.round((epochDay - 1) * msPerDay);

  return new Date(epochMillis).toISOString();
}

// Parse TLE metadata (inclination and epoch)

export function parseMeanMotionDot(l1: string): number {
  const raw = l1.slice(33, 43).trim();
  if (!raw) return 0;

  const meanMotionDot = Number(raw);
  return Number.isFinite(meanMotionDot) ? meanMotionDot : 0;
}

export function parseTLEMeta(l1: string, l2: string) {
  const inclination = parseFloat(l2.slice(8, 16));
  const raan = parseFloat(l2.slice(17, 25));
  const meanMotion = parseFloat(l2.slice(52, 63));
  const meanMotionDot = parseMeanMotionDot(l1);
  const tleEpoch = tleEpochToIso(l1);

  const ecc = parseFloat('0.' + l2.slice(26, 33).trim()) || 0;
  const argPerigee = parseFloat(l2.slice(34, 42));
  const meanAnomaly = parseFloat(l2.slice(43, 51));
  const n = (meanMotion * 2 * Math.PI) / 1440 / 60;
  const a = Math.pow(398600.4418 / (n * n), 1 / 3);
  const perigeeKm = Math.max(0, a * (1 - ecc) - 6378.137);
  const apogeeKm = Math.max(0, a * (1 + ecc) - 6378.137);
  return {
    inclination,
    raan,
    argPerigee,
    meanAnomaly,
    tleEpoch,
    meanMotion,
    meanMotionDot,
    ecc,
    perigeeKm,
    apogeeKm,
    semiMajorAxisKm: a,
  };
}

// Calculate velocity from TLE at a given date

export function velocityFromTLE(l1: string, l2: string, date: Date): number {
  try {
    const satrec = satellite.twoline2satrec(l1, l2);
    const pv = satellite.propagate(satrec, date);
    const vel = pv?.velocity;
    if (!vel) return 0;
    return Math.sqrt(vel.x ** 2 + vel.y ** 2 + vel.z ** 2); // km/s
  } catch (error) {
    console.warn('Error calculating velocity from TLE:', error);
    return 0;
  }
}

// Classify orbit type based on inclination

export function classifyOrbit(inclination: number): string {
  if (inclination < 10) return 'Equatorial';
  if (Math.abs(inclination - 90) < 5) return 'Polar';
  if (inclination >= 96 && inclination <= 99) return 'Sun-synchronous';
  return 'Inclined';
}

// Get orbit type based on Mean Motion and debris flag

export function getOrbitType(meanMotion: number, isDebris?: boolean): string {
  if (isDebris) return 'Debris';

  if (!Number.isFinite(meanMotion) || meanMotion <= 0) return 'Unknown';

  // Convert mean motion to orbital period
  const periodMinutes = 1440 / meanMotion;

  // GEO: around 23h56m (sidereal day)
  if (periodMinutes > 1350 && periodMinutes < 1530) {
    return 'GEO';
  }

  // MEO (e.g., GPS 11-12h)
  if (periodMinutes > 120 && periodMinutes <= 1350) {
    return 'MEO';
  }

  // LEO (approx 90–120 min)
  if (periodMinutes <= 120) {
    return 'LEO';
  }

  return 'Unknown';
}

// Parse BSTAR drag term from TLE line 1
export function parseBSTAR(l1: string): number {
  try {
    const raw = l1.substring(53, 61).trim();
    if (!raw || raw === '00000-0' || raw === '00000+0') return 0;

    // Handle both space-for-positive and explicit sign
    const padded = raw.padStart(8, ' ');

    const mantissaSign = padded[0] === '-' ? -1 : 1;
    const mantissaDigits = padded.substring(1, 6); // 5 digits
    const expSign = padded[6] === '-' ? -1 : 1;
    const expDigit = parseInt(padded[7], 10);

    if (isNaN(expDigit)) return 0;

    const mantissa = parseFloat('0.' + mantissaDigits) * mantissaSign;
    const result = mantissa * Math.pow(10, expSign * expDigit);
    return Number.isFinite(result) ? result : 0;
  } catch {
    return 0;
  }
}

// Kepler's third law for semi-major axis from mean motion
function estimateAltitudeFromMeanMotion(meanMotion: number): number {
  // meanMotion in rev/day → rad/min
  const n = (meanMotion * 2 * Math.PI) / 1440; // rad/min
  const MU = 398600.4418; // km³/s²
  const nPerSec = n / 60;
  const a = Math.pow(MU / (nPerSec * nPerSec), 1 / 3); // semi-major axis km
  return Math.max(0, a - EARTH_RADIUS_KM); // altitude above surface
}

const DECAY_SCALE_HEIGHT_KM = 60;
const DECAY_CAP_REF_ALT_KM = 400;
// Plausible peak drag-loss rate near 400 km; scales down with altitude like density.
const MAX_DECAY_RATE_AT_REF_KM_PER_DAY = 20;

function maxPlausibleDecayRateKmPerDay(altKm: number): number {
  // Terminal re-entry can accelerate far beyond the mid-LEO anomaly cap.
  if (altKm <= 180) return Number.POSITIVE_INFINITY;

  // Tighter cap in the 250-400km band — this is where BSTAR noise produces
  // the most false positives. At 300km solar max peak is ~5km/day,
  // solar minimum is ~0.5km/day. Cap at 8km/day as a generous upper bound.
  if (altKm <= 400 && altKm > 180) {
    const tightCap = 8 * Math.exp((300 - altKm) / 60);
    return Math.min(
      MAX_DECAY_RATE_AT_REF_KM_PER_DAY *
        Math.exp((DECAY_CAP_REF_ALT_KM - altKm) / DECAY_SCALE_HEIGHT_KM),
      Math.max(tightCap, 0.5)
    );
  }

  return (
    MAX_DECAY_RATE_AT_REF_KM_PER_DAY *
    Math.exp((DECAY_CAP_REF_ALT_KM - altKm) / DECAY_SCALE_HEIGHT_KM)
  );
}

/** Ṅ threshold (rev/day²) scales with altitude — TLE fit noise dominates above ~500 km. */
export function ndotIndicatesDecay(nDot: number, decayAltKm: number): boolean {
  if (nDot <= 0) return false;
  if (decayAltKm > 500) return nDot > 5e-5;
  if (decayAltKm > 400) return nDot > 2e-5;
  return nDot > 1e-5;
}

function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}

export function getReentryTierThresholds(altKm: number) {
  const critical = 30;

  if (altKm <= 300) {
    return { critical, warning: 180, nominal: 365 };
  }

  if (altKm <= 500) {
    const t = (altKm - 300) / 200;
    return {
      critical,
      warning: Math.floor(lerp(180, 120, t)),
      nominal: Math.floor(lerp(365, 240, t)),
    };
  }

  if (altKm <= 800) {
    const t = (altKm - 500) / 300;
    return {
      critical,
      warning: Math.floor(lerp(120, 90, t)),
      nominal: Math.floor(lerp(240, 180, t)),
    };
  }

  if (altKm <= 1000) {
    const t = (altKm - 800) / 200;
    return {
      critical,
      warning: Math.floor(lerp(90, 60, t)),
      nominal: Math.floor(lerp(180, 120, t)),
    };
  }

  const t = Math.min(1, (altKm - 1000) / 1000);
  return {
    critical,
    warning: Math.floor(lerp(60, 45, t)),
    nominal: Math.floor(lerp(120, 90, t)),
  };
}

export function assignReentryTier(
  estimatedDays: number,
  decayAltKm: number
): ReentryRisk['tier'] {
  const thresholds = getReentryTierThresholds(decayAltKm);
  if (estimatedDays < thresholds.critical) return 'critical';
  if (thresholds.warning > 0 && estimatedDays < thresholds.warning)
    return 'warning';
  if (thresholds.nominal > 0 && estimatedDays < thresholds.nominal)
    return 'nominal';
  return 'stable';
}

function getReentryConfidence(
  signalsAgree: boolean,
  altKm: number
): ReentryRisk['confidence'] {
  if (signalsAgree) return 'high';
  if (altKm <= 500) return 'medium';
  return 'low';
}

export function applyConfidenceCeiling(
  tier: ReentryRisk['tier'],
  confidence: number
): ReentryRisk['tier'] {
  if (tier === 'stable') return 'stable';

  const normalizedConf = confidence > 1 ? confidence / 100 : confidence;

  if (normalizedConf < 0.75) {
    if (tier === 'critical' || tier === 'warning') return 'nominal';
    return tier;
  }
  if (normalizedConf < 0.85) {
    if (tier === 'critical') return 'warning';
    return tier;
  }
  return tier;
}

export function getReentryRisk(
  entry: TleEntry,
  currentAltKm?: number,
  solarFluxMultiplier: number = DEFAULT_SOLAR_FLUX_MULTIPLIER
): ReentryRisk {
  const bstar = parseBSTAR(entry.l1);
  const decayAltKm =
    currentAltKm ?? estimateAltitudeFromMeanMotion(entry.meanMotion);

  // here perigee is used only as a sanity gate
  // objects with high perigee genuinely cannot be in significant drag regardless of BSTAR value.
  const perigeeKm = entry.perigeeKm;

  const stable: ReentryRisk = {
    satId: entry.id,
    bstar,
    meanMotionDot: entry.meanMotionDot,
    signalsAgree: false,
    confidence: 'low',
    decayAltKm,
    perigeeKm,
    decayRateKmPerDay: 0,
    estimatedDaysRemaining: null,
    tier: 'stable',
    source: 'single_epoch',
  };

  const periodMin = 1440 / Math.max(entry.meanMotion, 0.001);

  if (periodMin > 600 || perigeeKm > 2000) return stable;

  const nameUpper = entry.name.toUpperCase();
  const isDebrisObject =
    entry.isDebris || nameUpper.includes('DEB') || nameUpper.includes('DEBRIS');

  if (!isDebrisObject) return stable;

  // da/dt = -3π × B* × ρ_ref × (a/R_e) × v  [km/day]

  const MU = 398600.4418;
  const v_km_s = Math.sqrt(MU / (EARTH_RADIUS_KM + decayAltKm));

  const densityFactor = Math.exp(
    (DECAY_CAP_REF_ALT_KM - decayAltKm) / DECAY_SCALE_HEIGHT_KM
  );

  // Calibrated so |B*| ≈ 1e-4 yields ~0.72 km/day at 400 km (order-of-magnitude
  // screening). The prior 7.4e5 factor was ~100× too large for TLE B* values.
  const BASE_FACTOR = 7.4e3;
  const decayRateKmPerDay =
    Math.abs(bstar) *
    BASE_FACTOR *
    densityFactor *
    (v_km_s / 7.905) *
    solarFluxMultiplier;

  // Altitude-aware anomaly guard rejects misfit BSTAR; cap scales with density.
  if (decayRateKmPerDay > maxPlausibleDecayRateKmPerDay(decayAltKm)) {
    return stable;
  }

  // Re-entry completes when perigee drops to 120km
  const altAboveReentry = Math.max(0, perigeeKm - 120);
  if (decayRateKmPerDay < 1e-4) return stable;

  const nDot = entry.meanMotionDot ?? 0;
  const signalsAgree = ndotIndicatesDecay(nDot, decayAltKm);
  const confidence = getReentryConfidence(signalsAgree, decayAltKm);

  // If BSTAR is negative and orbit is raising, assume stable
  if (bstar < 0 && nDot < -1e-6) {
    return stable;
  }

  // Atmospheric density increases as altitude decreases.
  // Use 0.67 as a standard "Drag Acceleration" multiplier.
  const linearDays = altAboveReentry / decayRateKmPerDay;
  if (linearDays > 3650) return stable;

  // 2/3 correction: accounts for increasing drag as altitude decreases.
  const estimatedDaysRemaining = Math.max(1, Math.ceil(linearDays * (2 / 3)));

  const rawTier = assignReentryTier(estimatedDaysRemaining, decayAltKm);
  const confidenceScore = signalsAgree
    ? decayAltKm <= 400
      ? 0.85
      : 0.65
    : decayAltKm <= 500
      ? 0.45
      : 0.25;
  const tier = applyConfidenceCeiling(rawTier, confidenceScore);

  return {
    satId: entry.id,
    bstar,
    meanMotionDot: entry.meanMotionDot,
    signalsAgree,
    confidence,
    perigeeKm,
    decayAltKm,
    decayRateKmPerDay,
    estimatedDaysRemaining,
    tier,
    source: 'single_epoch',
  };
}

// Uses exponential scale height model calibrated to NRLMSISE-00 midpoints.
export function estimateDecayRateFromAltitude(
  altKm: number,
  solarFluxMultiplier: number = DEFAULT_SOLAR_FLUX_MULTIPLIER
): number {
  if (altKm > 300) return 0;
  const BASE_RATE_200KM = 10 * solarFluxMultiplier;
  const SCALE_HEIGHT = 35; // tighter scale height in lower thermosphere
  return BASE_RATE_200KM * Math.exp((200 - altKm) / SCALE_HEIGHT);
}

export function altitudeBasedReentryEstimate(
  perigeeKm: number,
  solarFluxMultiplier: number = DEFAULT_SOLAR_FLUX_MULTIPLIER
): {
  decayRateKmPerDay: number;
  estimatedDaysRemaining: number;
  tier: ReentryRisk['tier'];
} {
  const decayRate = estimateDecayRateFromAltitude(
    perigeeKm,
    solarFluxMultiplier
  );
  const altAboveReentry = Math.max(0, perigeeKm - 120);
  if (decayRate < 0.01) {
    return {
      decayRateKmPerDay: 0,
      estimatedDaysRemaining: 999,
      tier: 'stable',
    };
  }
  const accelerationFactor = perigeeKm <= 220 ? 0.5 : 2 / 3;
  const days = Math.max(
    1,
    Math.ceil((altAboveReentry / decayRate) * accelerationFactor)
  );
  const tier = assignReentryTier(days, perigeeKm);
  return { decayRateKmPerDay: decayRate, estimatedDaysRemaining: days, tier };
}
