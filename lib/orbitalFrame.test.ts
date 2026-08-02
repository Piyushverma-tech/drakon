import { computeOrbitalState, deriveOrbitalFrame } from './orbitalFrame';

describe('deriveOrbitalFrame (pure vector math)', () => {
  it('gives zero flight-path angle for a purely circular velocity', () => {
    // Position along +X, velocity along +Y -> perpendicular, r.v = 0
    const frame = deriveOrbitalFrame(
      { x: 7000, y: 0, z: 0 },
      { x: 0, y: 7.5, z: 0 }
    );

    expect(frame).not.toBeNull();
    expect(frame!.flightPathAngleDeg).toBeCloseTo(0, 6);
    expect(frame!.radialUnit).toEqual({ x: 1, y: 0, z: 0 });
    expect(frame!.velocityUnit).toEqual({ x: 0, y: 1, z: 0 });
    expect(frame!.orbitNormalUnit).toEqual({ x: 0, y: 0, z: 1 });
  });

  it('computes a known non-zero flight-path angle from an exact 3-4-5 triangle', () => {
    // r . v = 7000*3 = 21000, |r| = 7000, |v| = 5 -> sin(gamma) = 0.6 -> 36.87deg
    const frame = deriveOrbitalFrame(
      { x: 7000, y: 0, z: 0 },
      { x: 3, y: 4, z: 0 }
    );

    expect(frame).not.toBeNull();
    expect(frame!.flightPathAngleDeg).toBeCloseTo(36.8699, 3);
    expect(frame!.speedKmS).toBeCloseTo(5, 6);
  });

  it('gives a negative flight-path angle when descending (radial component opposes position)', () => {
    const frame = deriveOrbitalFrame(
      { x: 7000, y: 0, z: 0 },
      { x: -3, y: 4, z: 0 }
    );

    expect(frame).not.toBeNull();
    expect(frame!.flightPathAngleDeg).toBeCloseTo(-36.8699, 3);
  });

  it('keeps every returned vector unit length', () => {
    const frame = deriveOrbitalFrame(
      { x: 6800, y: 1200, z: -300 },
      { x: 1.2, y: -6.9, z: 2.1 }
    );

    expect(frame).not.toBeNull();
    const mag = (v: { x: number; y: number; z: number }) =>
      Math.sqrt(v.x ** 2 + v.y ** 2 + v.z ** 2);

    expect(mag(frame!.radialUnit)).toBeCloseTo(1, 6);
    expect(mag(frame!.velocityUnit)).toBeCloseTo(1, 6);
    expect(mag(frame!.orbitNormalUnit!)).toBeCloseTo(1, 6);
  });

  it('orbit-normal is perpendicular to both radial and velocity directions', () => {
    const frame = deriveOrbitalFrame(
      { x: 6800, y: 1200, z: -300 },
      { x: 1.2, y: -6.9, z: 2.1 }
    );

    expect(frame).not.toBeNull();
    const dot = (a: { x: number; y: number; z: number }, b: typeof a) =>
      a.x * b.x + a.y * b.y + a.z * b.z;

    expect(dot(frame!.orbitNormalUnit!, frame!.radialUnit)).toBeCloseTo(0, 6);
    expect(dot(frame!.orbitNormalUnit!, frame!.velocityUnit)).toBeCloseTo(
      0,
      6
    );
  });

  it('returns null instead of NaN vectors for a degenerate zero position', () => {
    const frame = deriveOrbitalFrame(
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 }
    );
    expect(frame).toBeNull();
  });

  it('returns a null orbit-normal (not NaN) when velocity is purely radial', () => {
    // r x v = 0 when velocity is parallel to position -- degenerate normal.
    const frame = deriveOrbitalFrame(
      { x: 7000, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 }
    );

    expect(frame).not.toBeNull();
    expect(frame!.orbitNormalUnit).toBeNull();
    expect(frame!.flightPathAngleDeg).toBeCloseTo(90, 6);
  });
});

describe('computeOrbitalState (SGP4 integration smoke test)', () => {
  // ISS, near-circular (ecc ~= 0.0006) -- flight-path angle should stay
  // close to zero everywhere along the orbit, so this is a stable
  // assertion regardless of propagation-time drift.
  const issL1 =
    '1 25544U 98067A   26030.50000000  .00016717  00000-0  10270-3 0  9994';
  const issL2 =
    '2 25544  51.6400 208.9163 0006703  69.9862  25.2906 15.49560700 12345';

  it('returns unit-length vectors and a small flight-path angle for a near-circular orbit', () => {
    const state = computeOrbitalState(
      issL1,
      issL2,
      new Date('2026-01-30T12:00:00Z')
    );

    expect(state).not.toBeNull();
    expect(state!.speedKmS).toBeGreaterThan(6.5);
    expect(state!.speedKmS).toBeLessThan(8.5);
    expect(Math.abs(state!.flightPathAngleDeg)).toBeLessThan(2);

    const mag = (v: { x: number; y: number; z: number }) =>
      Math.sqrt(v.x ** 2 + v.y ** 2 + v.z ** 2);
    expect(mag(state!.radialUnit)).toBeCloseTo(1, 4);
    expect(mag(state!.velocityUnit)).toBeCloseTo(1, 4);
    expect(mag(state!.orbitNormalUnit!)).toBeCloseTo(1, 4);
  });

  it('returns null for garbage TLE lines instead of throwing', () => {
    const state = computeOrbitalState('not a tle', 'also not a tle');
    expect(state).toBeNull();
  });
});
