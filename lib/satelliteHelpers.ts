import * as satellite from 'satellite.js';

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
  if (isDebris) return "Debris";

  if (!Number.isFinite(meanMotion) || meanMotion <= 0) return "Unknown";

  // Convert mean motion to orbital period
  const periodMinutes = 1440 / meanMotion;

  // GEO: around 23h56m (sidereal day)
  if (periodMinutes > 1350 && periodMinutes < 1530) {
    return "GEO";
  }

  // MEO (e.g., GPS 11-12h)
  if (periodMinutes > 120 && periodMinutes <= 1350) {
    return "MEO";
  }

  // LEO (approx 90–120 min)
  if (periodMinutes <= 120) {
    return "LEO";
  }

  return "Unknown";
}


