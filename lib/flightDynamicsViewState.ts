import type { OrbitalFrame, Vector3 } from '@/lib/orbitalFrame';

export type FlightDynamicsViewState = {
  target: [number, number, number];
  zoom: number;
  rotationX: number;
  rotationOrbit: number;
};

/**
 * Derive an OrbitView (orbitAxis='Z') camera that keeps nadir pointing
 * *into* the scene (away from the viewer) while leaving both the orbital
 * and equatorial discs readable.
 *
 * Deck.gl OrbitViewport with orbitAxis Z places the camera at:
 *   [-cos(φ)·sin(θ), -cos(φ)·cos(θ), sin(φ)]
 * where φ = rotationX, θ = rotationOrbit (degrees). Inverse:
 *   φ = asin(Ez),  θ = atan2(-Ex, -Ey)
 *
 * Nadir (= -radial) points into the screen when the camera sits on the
 * zenith side (E · radial > 0). A pure zenith look makes the orbital
 * plane edge-on, so we blend in the line-of-nodes direction (Z × H) —
 * the axis that best reveals inclination between the two discs.
 */
export function computeInitialViewState(
  frame: Pick<OrbitalFrame, 'radialUnit' | 'orbitNormalUnit'>
): FlightDynamicsViewState {
  const r = frame.radialUnit;
  const h = frame.orbitNormalUnit ?? { x: 0, y: 0, z: 1 };

  // Line of nodes in the equatorial plane: Z × H = (-Hy, Hx, 0)
  const nodes = unitOrFallback(-h.y, h.x, 0, r);

  // Prefer the nodes direction that keeps a right-handed, consistent
  // 3/4 view relative to zenith (avoid flipping between satellites).
  const nodesSigned =
    nodes.x * r.y - nodes.y * r.x < 0
      ? nodes
      : { x: -nodes.x, y: -nodes.y, z: -nodes.z };

  // Weights chosen so N stays clearly into the screen while the orbit /
  // equator dihedral remains obvious without manual orbiting.
  const eye = normalize({
    x: 0.55 * r.x + 0.72 * nodesSigned.x,
    y: 0.55 * r.y + 0.72 * nodesSigned.y,
    z: 0.55 * r.z + 0.72 * nodesSigned.z + 0.28,
  });

  const rotationX = clamp(
    (Math.asin(clamp(eye.z, -1, 1)) * 180) / Math.PI,
    28,
    58
  );
  // Keep azimuth from the unclamped eye so N stays on the zenith side
  // even when elevation is clamped into the readable band.
  const rotationOrbit = (Math.atan2(-eye.x, -eye.y) * 180) / Math.PI;

  return {
    target: [0, 0, 0],
    zoom: 1.15,
    rotationX,
    rotationOrbit,
  };
}

/** True when nadir points into the screen (same half-space as the camera look direction). */
export function nadirPointsIntoScreen(
  frame: Pick<OrbitalFrame, 'radialUnit'>,
  viewState: Pick<FlightDynamicsViewState, 'rotationX' | 'rotationOrbit'>
): boolean {
  const eye = eyeDirectionFromViewState(viewState);
  // lookDir = -eye; nadir = -radial; nadir·lookDir = radial·eye
  return (
    frame.radialUnit.x * eye.x +
      frame.radialUnit.y * eye.y +
      frame.radialUnit.z * eye.z >
    0
  );
}

export function eyeDirectionFromViewState(
  viewState: Pick<FlightDynamicsViewState, 'rotationX' | 'rotationOrbit'>
): Vector3 {
  const phi = (viewState.rotationX * Math.PI) / 180;
  const theta = (viewState.rotationOrbit * Math.PI) / 180;
  const c = Math.cos(phi);
  return {
    x: -c * Math.sin(theta),
    y: -c * Math.cos(theta),
    z: Math.sin(phi),
  };
}

function unitOrFallback(
  x: number,
  y: number,
  z: number,
  radial: Vector3
): Vector3 {
  const m = Math.hypot(x, y, z);
  if (m > 1e-6) return { x: x / m, y: y / m, z: z / m };
  // Equatorial orbit (H ∥ Z): fall back to an axis ⊥ zenith in XY.
  const fx = -radial.y;
  const fy = radial.x;
  const fm = Math.hypot(fx, fy);
  if (fm > 1e-6) return { x: fx / fm, y: fy / fm, z: 0 };
  return { x: 1, y: 0, z: 0 };
}

function normalize(v: Vector3): Vector3 {
  const m = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / m, y: v.y / m, z: v.z / m };
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
