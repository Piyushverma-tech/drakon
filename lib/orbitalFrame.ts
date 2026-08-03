import * as satellite from 'satellite.js';

export type Vector3 = { x: number; y: number; z: number };

// short: a spherical approximation, used only to give the flight-dynamics visualization a relative sense of scale. not the app's authoritative geodetic altitude (WGS84) used elsewhere.
const EARTH_RADIUS_KM = 6378.137;

// Instantaneous orbital state expressed in the LVLH-relevant vectors:
// radial (position) direction, velocity direction, and orbit-normal
// (angular momentum) direction, plus flight-path angle.
export type OrbitalFrame = {
  positionEciKm: Vector3;
  velocityEciKmS: Vector3;
  speedKmS: number;
  radialUnit: Vector3; // position direction, normalized (points away from Earth's center)
  velocityUnit: Vector3; // velocity direction, normalized
  orbitNormalUnit: Vector3 | null; // r x v, normalized (angular momentum direction); null if degenerate
  flightPathAngleDeg: number; // angle between velocity and local horizontal; +ve = ascending
  approxAltitudeKm: number; // r - EARTH_RADIUS_KM, not authoritative geodetic altitude
};

function magnitude(v: Vector3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

function normalize(v: Vector3): Vector3 | null {
  const m = magnitude(v);
  if (!Number.isFinite(m) || m < 1e-9) return null;
  return { x: v.x / m, y: v.y / m, z: v.z / m };
}

function dot(a: Vector3, b: Vector3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Vector3, b: Vector3): Vector3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Pure vector math: derive the LVLH-relevant unit vectors and flight-path
 * angle from an ECI position/velocity pair. No propagation, no I/O —
 * safe to unit test with synthetic vectors.
 */
export function deriveOrbitalFrame(
  position: Vector3,
  velocity: Vector3
): Omit<OrbitalFrame, 'positionEciKm' | 'velocityEciKmS'> | null {
  const r = magnitude(position);
  const speedKmS = magnitude(velocity);
  if (r < 1e-9 || speedKmS < 1e-9) return null;

  const radialUnit = normalize(position);
  const velocityUnit = normalize(velocity);
  if (!radialUnit || !velocityUnit) return null;

  const angularMomentum = cross(position, velocity);
  const orbitNormalUnit = normalize(angularMomentum);

  // sin(gamma) = (r . v) / (|r| |v|) -- component of velocity along the
  // radial direction, i.e. climbing (+) vs descending (-).
  const sinGamma = clamp(dot(position, velocity) / (r * speedKmS), -1, 1);
  const flightPathAngleDeg = (Math.asin(sinGamma) * 180) / Math.PI;

  return {
    speedKmS,
    radialUnit,
    velocityUnit,
    orbitNormalUnit,
    flightPathAngleDeg,
    approxAltitudeKm: r - EARTH_RADIUS_KM,
  };
}

/**
 * Propagate a TLE at `date` and derive the orbital frame. Returns null
 * if SGP4 propagation fails (decayed/invalid TLE) rather than throwing,
 * matching the existing satellite.ts/satelliteHelpers.ts convention.
 */
export function computeOrbitalState(
  l1: string,
  l2: string,
  date: Date = new Date()
): OrbitalFrame | null {
  try {
    const satrec = satellite.twoline2satrec(l1, l2);
    const pv = satellite.propagate(satrec, date);
    if (!pv || !pv.position || !pv.velocity) {
      console.warn('Propagation failed while computing orbital state');
      return null;
    }

    const position = pv.position as Vector3;
    const velocity = pv.velocity as Vector3;
    const frame = deriveOrbitalFrame(position, velocity);
    if (!frame) return null;

    return {
      positionEciKm: position,
      velocityEciKmS: velocity,
      ...frame,
    };
  } catch (error) {
    console.warn('Error computing orbital state from TLE:', error);
    return null;
  }
}

/**
 * Shared display formatting for flight-path angle, so the left panel and
 * the re-entry analysis page render it identically. Explicit '+' on
 * ascending, plain '-' (via toFixed) on descending, no sign at ~0.
 */
export function formatFlightPathAngleDeg(
  frame: OrbitalFrame | null | undefined
): string {
  if (!frame) return '—';
  const deg = frame.flightPathAngleDeg;
  const sign = deg > 0.005 ? '+' : '';
  return `${sign}${deg.toFixed(2)}°`;
}
