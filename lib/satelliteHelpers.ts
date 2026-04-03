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
    const field = l1.substring(53, 61).trim();
    if (!field || field === '00000-0' || field === '00000+0') return 0;

    // Format: ±NNNNN±N  (no decimal point — implied before the digits)
    const mantissaSign = field[0] === '-' ? -1 : 1;
    const mantissa = parseFloat('0.' + field.substring(1, 6)) * mantissaSign;
    const expSign = field[6] === '-' ? -1 : 1;
    const exp = parseInt(field[7], 10) * expSign;

    const result = mantissa * Math.pow(10, exp);
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

  // GEO / deep space — not re-entering
  const periodMin = 1440 / entry.meanMotion;
  if (periodMin > 600 || altKm > 35000) {
    return {
      satId: entry.id,
      bstar,
      altKm,
      decayRateKmPerDay: 0,
      estimatedDaysRemaining: null,
      tier: 'stable',
    };
  }

  // No meaningful drag — stable
  if (Math.abs(bstar) < 1e-6) {
    return {
      satId: entry.id,
      bstar,
      altKm,
      decayRateKmPerDay: 0,
      estimatedDaysRemaining: null,
      tier: 'stable',
    };
  }

  // Rough decay rate from BSTAR + velocity
  // At LEO altitudes, orbital velocity ≈ sqrt(MU / (EARTH_R + alt))
  const MU = 398600.4418;
  const v = Math.sqrt(MU / (6371 + altKm)); // km/s
  // Drag deceleration ≈ BSTAR × v² (km/s² in ECI)
  // Convert to altitude loss: da/dt ≈ -2a × dv/dt / v (vis-viva)
  // Simplified: decay rate ∝ bstar × v² × 86400 (seconds per day)
  const dragAccel = Math.abs(bstar) * v * v; // km/s²
  const decayRateKmPerDay = dragAccel * 86400 * 0.5;
  // The 0.5 factor is an empirical fudge — BSTAR alone overestimates
  // because it doesn't account for atmospheric density variation.
  // This gives results within the right order of magnitude for screening.

  // Rough lifetime: current altitude above ~120km reentry threshold
  const reentryAlt = 120; // km — ballpark karman + drag domination
  const altAboveReentry = Math.max(0, altKm - reentryAlt);

  let estimatedDaysRemaining: number | null = null;
  if (decayRateKmPerDay > 0.001) {
    estimatedDaysRemaining = Math.round(altAboveReentry / decayRateKmPerDay);
  }

  const tier: ReentryRisk['tier'] =
    estimatedDaysRemaining === null
      ? 'stable'
      : estimatedDaysRemaining < 30
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
