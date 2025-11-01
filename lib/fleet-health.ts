import { positionFromTLE } from './satellite';
import { TleEntry } from './tle-context';

// ----------------------
// Types
// ----------------------
export type Telemetry = {
  lat: number;
  lon: number;
  altKm: number;
  timestampIso: string | null;
  lastContact?: string | null;
};

export type SatelliteHealthStatus = 'Healthy' | 'Warning' | 'Critical';

export type SatelliteHealth = {
  id: number;
  name: string;
  status: SatelliteHealthStatus;
  deviationKm: number | null;
  ageSec: number | null;
  reason: string;
  orbitClass: 'LEO' | 'MEO' | 'GEO' | 'Debris';
  predicted: { lat: number; lon: number; altKm: number };
  observed: { lat: number; lon: number; altKm: number } | null;
};

export type FleetHealthSummary = {
  total: number;
  healthy: number;
  warning: number;
  critical: number;
  healthPercent: number;
};

// ----------------------
// Configuration
// ----------------------
const CONFIG = {
  thresholds: {
    LEO: { warnKm: 3, critKm: 10, warnAgeSec: 600, critAgeSec: 3600 },
    MEO: { warnKm: 15, critKm: 40, warnAgeSec: 1800, critAgeSec: 21600 },
    GEO: { warnKm: 80, critKm: 300, warnAgeSec: 3600, critAgeSec: 43200 },
    Debris: { warnKm: 2, critKm: 10, warnAgeSec: 300, critAgeSec: 3600 },
  },
};

// ----------------------
// Distance Calculation (ECEF)
// ----------------------
const RAD = Math.PI / 180;
const EARTH_RADIUS_KM = 6378.137;

function latLonAltToECEF(latDeg: number, lonDeg: number, altKm: number) {
  // WGS84-ish spherical approximation (sufficient for deviation checks)
  const radLat = latDeg * RAD;
  const radLon = lonDeg * RAD;
  const r = EARTH_RADIUS_KM + altKm;
  const x = r * Math.cos(radLat) * Math.cos(radLon);
  const y = r * Math.cos(radLat) * Math.sin(radLon);
  const z = r * Math.sin(radLat);
  return { x, y, z };
}

export function distanceKm(
  posA: { lat: number; lon: number; altKm: number },
  posB: { lat: number; lon: number; altKm: number }
): number {
  const A = latLonAltToECEF(posA.lat, posA.lon, posA.altKm);
  const B = latLonAltToECEF(posB.lat, posB.lon, posB.altKm);
  const dx = A.x - B.x;
  const dy = A.y - B.y;
  const dz = A.z - B.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// ----------------------
// Orbit Classification
// ----------------------
export function orbitClassFromAlt(
  altKm: number,
  isDebris?: boolean
): 'LEO' | 'MEO' | 'GEO' | 'Debris' {
  if (isDebris) return 'Debris';
  if (altKm <= 1000) return 'LEO';
  if (altKm <= 2000) return 'MEO';
  return 'GEO';
}

// ----------------------
// Health Assessment
// ----------------------
export function assessSatelliteHealth(
  meta: TleEntry,
  telemetry: Telemetry | null
): SatelliteHealth {
  // Get predicted position (use current time or telemetry timestamp if available)
  const now = new Date();
  const telTime = telemetry?.timestampIso
    ? new Date(telemetry.timestampIso)
    : now;

  const predicted = positionFromTLE(meta.l1, meta.l2, telTime);
  const orbitClass = orbitClassFromAlt(predicted.altKm, meta.isDebris);
  const cfg = CONFIG.thresholds[orbitClass];

  // No telemetry case
  if (!telemetry || telemetry.timestampIso == null) {
    return {
      id: meta.id,
      name: meta.name,
      status: 'Critical',
      deviationKm: null,
      ageSec: null,
      reason: 'no_telemetry',
      orbitClass,
      predicted,
      observed: null,
    };
  }

  // Calculate telemetry age
  const ageSec = (now.getTime() - telTime.getTime()) / 1000;

  // Calculate deviation between predicted and observed
  const observed = {
    lat: telemetry.lat,
    lon: telemetry.lon,
    altKm: telemetry.altKm,
  };
  const devKm = distanceKm(predicted, observed);

  // Apply health logic (ordered by severity)
  if (ageSec > cfg.critAgeSec) {
    return {
      id: meta.id,
      name: meta.name,
      status: 'Critical',
      deviationKm: devKm,
      ageSec,
      reason: 'stale_telemetry',
      orbitClass,
      predicted,
      observed,
    };
  }

  if (devKm >= cfg.critKm) {
    return {
      id: meta.id,
      name: meta.name,
      status: 'Critical',
      deviationKm: devKm,
      ageSec,
      reason: 'large_deviation',
      orbitClass,
      predicted,
      observed,
    };
  }

  if (devKm >= cfg.warnKm) {
    return {
      id: meta.id,
      name: meta.name,
      status: 'Warning',
      deviationKm: devKm,
      ageSec,
      reason: 'deviation_warning',
      orbitClass,
      predicted,
      observed,
    };
  }

  if (ageSec >= cfg.warnAgeSec) {
    return {
      id: meta.id,
      name: meta.name,
      status: 'Warning',
      deviationKm: devKm,
      ageSec,
      reason: 'stale_warning',
      orbitClass,
      predicted,
      observed,
    };
  }

  return {
    id: meta.id,
    name: meta.name,
    status: 'Healthy',
    deviationKm: devKm,
    ageSec,
    reason: 'ok',
    orbitClass,
    predicted,
    observed,
  };
}

// ----------------------
// Fleet Aggregation
// ----------------------
export function aggregateFleetHealth(
  healthStatuses: SatelliteHealth[]
): FleetHealthSummary {
  const total = healthStatuses.length;
  const healthy = healthStatuses.filter((h) => h.status === 'Healthy').length;
  const warning = healthStatuses.filter((h) => h.status === 'Warning').length;
  const critical = healthStatuses.filter((h) => h.status === 'Critical').length;
  const healthPercent = total > 0 ? (healthy / total) * 100 : 0;

  return {
    total,
    healthy,
    warning,
    critical,
    healthPercent,
  };
}

// ----------------------
// Mock Telemetry Generator
// ----------------------
/**
 * Generates mock telemetry data for satellites.
 * In a real system, this would come from a telemetry feed.
 * This simulates realistic telemetry with small random variations.
 */
export function generateMockTelemetry(
  meta: TleEntry,
  addNoise: boolean = true
): Telemetry | null {
  const now = new Date();
  const predicted = positionFromTLE(meta.l1, meta.l2, now);

  // Simulate telemetry availability (95% availability)
  if (Math.random() < 0.05) {
    return null; // No telemetry for this satellite
  }

  // Add realistic noise to simulate telemetry measurement error
  // Most satellites have very accurate telemetry (sub-km)
  const noiseScale = meta.isDebris ? 0.5 : 0.1; // Debris has less accurate tracking
  const latNoise = addNoise
    ? (Math.random() - 0.5) * noiseScale
    : 0;
  const lonNoise = addNoise ? (Math.random() - 0.5) * noiseScale : 0;
  const altNoise = addNoise ? (Math.random() - 0.5) * noiseScale * 10 : 0;

  // Occasionally add larger deviations to simulate real issues
  const hasIssue = Math.random() < 0.02; // 2% chance of having an issue
  const issueMultiplier = hasIssue ? 5 : 1;

  // Simulate occasional stale telemetry (5% chance of being stale)
  let timestamp: Date;
  if (Math.random() < 0.05) {
    // Stale telemetry - anywhere from 15 minutes to 2 hours old
    const staleMinutes = 15 + Math.random() * 105; // 15-120 minutes
    timestamp = new Date(now.getTime() - staleMinutes * 60 * 1000);
  } else {
    timestamp = now;
  }

  return {
    lat: predicted.lat + latNoise * issueMultiplier,
    lon: predicted.lon + lonNoise * issueMultiplier,
    altKm: predicted.altKm + altNoise * issueMultiplier,
    timestampIso: timestamp.toISOString(),
    lastContact: timestamp.toISOString(),
  };
}
