import * as satellite from 'satellite.js';
import { ReentryRisk, TleEntry } from './types';

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
export function parseTLEMeta(l1: string, l2: string) {
  const inclination = parseFloat(l2.slice(8, 16));
  const meanMotion = parseFloat(l2.slice(52, 63));
  const tleEpoch = tleEpochToIso(l1);
  return { inclination, tleEpoch, meanMotion };
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
  return Math.max(0, a - 6371); // altitude above surface
}

export function getReentryRisk(
  entry: TleEntry,
  currentAltKm?: number
): ReentryRisk {
  const bstar = parseBSTAR(entry.l1);
  const altKm =
    currentAltKm ?? estimateAltitudeFromMeanMotion(entry.meanMotion);

  const stable: ReentryRisk = {
    satId: entry.id,
    bstar,
    altKm,
    decayRateKmPerDay: 0,
    estimatedDaysRemaining: null,
    tier: 'stable',
  };

  // GEO / deep space — not re-entering
  const periodMin = 1440 / Math.max(entry.meanMotion, 0.001);
  if (periodMin > 600 || altKm > 2000) return stable;

  // Only screen debris and rocket bodies for re-entry risk
  // Active satellites with propulsion have meaningless BSTAR values
  const nameUpper = entry.name.toUpperCase();
  const isRocketBody =
    nameUpper.includes('R/B') || nameUpper.includes('ROCKET');
  const isDebrisObject =
    entry.isDebris || nameUpper.includes('DEB') || nameUpper.includes('DEBRIS');

  const isLikelyActive = !isDebrisObject && !isRocketBody;
  if (isLikelyActive) return stable;

  // No meaningful drag
  if (Math.abs(bstar) < 1e-5) return stable;

  // Filter out active maneuvers
  if (bstar <= 0) return stable;

  // da/dt = -3π × B* × ρ_ref × (a/R_e) × v  [km/day]
  const R_EARTH = 6378.137;
  const MU = 398600.4418;
  const v_km_s = Math.sqrt(MU / (R_EARTH + altKm));

  // Scale height correction — drag increases exponentially as alt decreases
  // H ≈ 60km scale height for 300-600km range
  const H_SCALE = 60;
  const REF_ALT = 400; // km — reference altitude where formula is calibrated
  const densityFactor = Math.exp((REF_ALT - altKm) / H_SCALE);

  // Base decay at reference altitude: 1 B* unit → ~7.4e5 km/day
  // (derived from SGP4 ρ₀ = 2.461e-5 kg/m²/Re, R_earth = 6378km)
  const BASE_FACTOR = 7.4e5;
  const decayRateKmPerDay =
    Math.abs(bstar) * BASE_FACTOR * densityFactor * (v_km_s / 7.905); // normalize to circular velocity at sea level

  // Sanity cap - anything above 20 km/day is data anomaly
  if (decayRateKmPerDay > 20) return stable;

  const reentryAlt = 120;
  const altAboveReentry = Math.max(0, altKm - reentryAlt);

  if (decayRateKmPerDay < 1e-4) return stable;

  const rawDays = altAboveReentry / decayRateKmPerDay;

  // Beyond 10 years — effectively stable for screening purposes
  if (rawDays > 3650) return stable;

  // Atmospheric density increases as altitude decreases.
  // Use 0.67 as a standard "Drag Acceleration" multiplier.
  const linearDays = altAboveReentry / decayRateKmPerDay;
  const estimatedDaysRemaining = Math.max(1, Math.ceil(linearDays * 0.6));

  const tier: ReentryRisk['tier'] =
    estimatedDaysRemaining < 30
      ? 'critical'
      : estimatedDaysRemaining < 180
        ? 'warning'
        : estimatedDaysRemaining < 365
          ? 'nominal'
          : 'stable';

  return {
    satId: entry.id,
    bstar,
    altKm,
    decayRateKmPerDay,
    estimatedDaysRemaining,
    tier,
  };
}
