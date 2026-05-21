import * as satellite from 'satellite.js';
import { ReentryRisk, TleEntry } from './types';

const EARTH_RADIUS_KM = 6378.137;

/**
 * Format distance in kilometers to human-readable string
 */
export function formatDistance(distanceKm: number): string {
  if (distanceKm >= 1) {
    return `${distanceKm.toFixed(2)} km`;
  }
  return `${Math.max(distanceKm * 1000, 0).toFixed(0)} m`;
}

/**
 * Convert TLE epoch (year + day of year) to ISO string
 */
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

/**
 * Parse TLE metadata (inclination and epoch)
 */
export function parseMeanMotionDot(l1: string): number {
  const raw = l1.slice(33, 43).trim();
  if (!raw) return 0;

  const meanMotionDot = Number(raw);
  return Number.isFinite(meanMotionDot) ? meanMotionDot : 0;
}

export function parseTLEMeta(l1: string, l2: string) {
  const inclination = parseFloat(l2.slice(8, 16));
  const meanMotion = parseFloat(l2.slice(52, 63));
  const meanMotionDot = parseMeanMotionDot(l1);
  const tleEpoch = tleEpochToIso(l1);

  const ecc = parseFloat('0.' + l2.slice(26, 33).trim()) || 0;
  const n = (meanMotion * 2 * Math.PI) / 1440 / 60;
  const a = Math.pow(398600.4418 / (n * n), 1 / 3);
  const perigeeKm = Math.max(0, a * (1 - ecc) - 6378.137);
  const apogeeKm = Math.max(0, a * (1 + ecc) - 6378.137);
  return {
    inclination,
    tleEpoch,
    meanMotion,
    meanMotionDot,
    ecc,
    perigeeKm,
    apogeeKm,
  };
}

/**
 * Calculate velocity from TLE at a given date
 */
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

/**
 * Classify orbit type based on inclination
 */
export function classifyOrbit(inclination: number): string {
  if (inclination < 10) return 'Equatorial';
  if (Math.abs(inclination - 90) < 5) return 'Polar';
  if (inclination >= 96 && inclination <= 99) return 'Sun-synchronous';
  return 'Inclined';
}

/**
 * Get orbit type based on Mean Motion and debris flag
 */
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
    // TLE line 1, columns 54-61 (1-indexed), 0-indexed: 53-60
    // Format: ±NNNNN±N where ± is space (positive) or '-' (negative)
    // Represents: 0.NNNNN × 10^(±N)
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

// Kepler's third law gives us semi-major axis from mean motion, then subtract Earth radius
export function estimateAltitudeFromMeanMotion(meanMotion: number): number {
  // meanMotion in rev/day → rad/min
  const n = (meanMotion * 2 * Math.PI) / 1440; // rad/min
  const MU = 398600.4418; // km³/s²
  const nPerSec = n / 60;
  const a = Math.pow(MU / (nPerSec * nPerSec), 1 / 3); // semi-major axis km
  return Math.max(0, a - EARTH_RADIUS_KM); // altitude above surface
}

function maxPlausibleDecayRateKmPerDay(altKm: number): number {
  // Terminal re-entry can accelerate far beyond the mid-LEO anomaly cap.
  if (altKm <= 180) return Number.POSITIVE_INFINITY;

  // The original 20 km/day cap is useful around mid-LEO, but below 300km
  // plausible decay rates rise rapidly with atmospheric density.
  if (altKm < 300) {
    return 20 * Math.exp((300 - altKm) / 60);
  }

  return 20;
}

function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}

function getReentryTierThresholds(altKm: number) {
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

type TierThresholds = {
  critical: number;
  warning: number;
  nominal: number;
};

function assignTier(
  estimatedDays: number,
  thresholds: TierThresholds,
  signalsAgree: boolean,
  altKm: number
): ReentryRisk['tier'] {
  // Signal agreement at high altitude restores one suppressed band.
  // Rationale: two independent signals surviving the same solar noise
  // meaningfully raises confidence over BSTAR alone.
  const relaxed = signalsAgree && altKm > 500;
  const effectiveWarning = relaxed
    ? Math.max(thresholds.warning, 90) // restore warning if suppressed
    : thresholds.warning;
  const effectiveNominal = relaxed
    ? Math.max(thresholds.nominal, 180) // restore nominal if suppressed
    : thresholds.nominal;

  if (estimatedDays < thresholds.critical) return 'critical';
  if (effectiveWarning > 0 && estimatedDays < effectiveWarning)
    return 'warning';
  if (effectiveNominal > 0 && estimatedDays < effectiveNominal)
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

export function getReentryRisk(
  entry: TleEntry,
  currentAltKm?: number
): ReentryRisk {
  const bstar = parseBSTAR(entry.l1);
  const decayAltKm =
    currentAltKm ?? estimateAltitudeFromMeanMotion(entry.meanMotion);

  // here perigee is used only as a sanity gate
  // objects with high perigee genuinely cannot be in significant drag regardless of BSTAR value.
  const perigeeKm = entry.perigeeKm;

  const NDOT_DECAY_THRESHOLD = 1e-6; // rev/day² — below this, Ṅ is noise

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
  };

  // GEO / deep space — not re-entering
  const periodMin = 1440 / Math.max(entry.meanMotion, 0.001);
  // if perigee is above 2000km, drag is negligible regardless of what mean motion says.
  if (periodMin > 600 || perigeeKm > 2000) return stable;

  // Only screen objects classified as debris by the parser.
  // Active satellites with propulsion have meaningless BSTAR.
  const nameUpper = entry.name.toUpperCase();
  const isDebrisObject =
    entry.isDebris || nameUpper.includes('DEB') || nameUpper.includes('DEBRIS');

  if (!isDebrisObject) return stable;

  // da/dt = -3π × B* × ρ_ref × (a/R_e) × v  [km/day]

  const MU = 398600.4418;
  const v_km_s = Math.sqrt(MU / (EARTH_RADIUS_KM + decayAltKm));

  // Scale height correction — drag increases exponentially as alt decreases
  // H ≈ 60km scale height for 300-600km range
  const H_SCALE = 60;
  const REF_ALT = 400; // km — reference altitude where formula is calibrated
  const densityFactor = Math.exp((REF_ALT - decayAltKm) / H_SCALE);

  // Base decay at reference altitude: 1 B* unit → ~7.4e5 km/day
  // (derived from SGP4 ρ₀ = 2.461e-5 kg/m²/Re, R_earth = 6378km)
  const BASE_FACTOR = 7.4e5;
  const decayRateKmPerDay =
    Math.abs(bstar) * BASE_FACTOR * densityFactor * (v_km_s / 7.905); // normalize to circular velocity at sea level

  // Altitude-aware anomaly guard. Mid-LEO values above 20 km/day are usually
  // bad fitted BSTAR, but terminal decay below ~180km can legitimately exceed it.
  if (decayRateKmPerDay > maxPlausibleDecayRateKmPerDay(decayAltKm)) {
    return stable;
  }

  const altAboveReentry = Math.max(0, decayAltKm - 120);
  if (decayRateKmPerDay < 1e-4) return stable;

  const nDot = entry.meanMotionDot ?? 0;
  const signalsAgree = nDot > NDOT_DECAY_THRESHOLD;
  const confidence = getReentryConfidence(signalsAgree, decayAltKm);

  // Atmospheric density increases as altitude decreases.
  // Use 0.67 as a standard "Drag Acceleration" multiplier.
  const linearDays = altAboveReentry / decayRateKmPerDay;
  if (linearDays > 3650) return stable;

  // 2/3 correction: accounts for increasing drag as altitude decreases.
  const estimatedDaysRemaining = Math.max(1, Math.ceil(linearDays * (2 / 3)));

  const thresholds = getReentryTierThresholds(decayAltKm);

  const tier = assignTier(
    estimatedDaysRemaining,
    thresholds,
    signalsAgree,
    decayAltKm
  );

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
  };
}
