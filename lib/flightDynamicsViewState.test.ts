import {
  computeInitialViewState,
  eyeDirectionFromViewState,
  nadirPointsIntoScreen,
} from './flightDynamicsViewState';

describe('computeInitialViewState', () => {
  it('places the camera on the zenith side so nadir points into the screen', () => {
    // Circular equatorial: r=+X, v=+Y, h=+Z
    const frame = {
      radialUnit: { x: 1, y: 0, z: 0 },
      orbitNormalUnit: { x: 0, y: 0, z: 1 },
    };
    const vs = computeInitialViewState(frame);
    expect(nadirPointsIntoScreen(frame, vs)).toBe(true);

    // Camera should have a positive X component (zenith side), not -X (nadir/Earth side).
    const eye = eyeDirectionFromViewState(vs);
    expect(eye.x).toBeGreaterThan(0);
  });

  it('keeps nadir into the screen for an ISS-like inclined frame', () => {
    const incl = (51.6 * Math.PI) / 180;
    const frame = {
      radialUnit: { x: 1, y: 0, z: 0 },
      orbitNormalUnit: { x: 0, y: Math.sin(incl), z: Math.cos(incl) },
    };
    const vs = computeInitialViewState(frame);
    expect(nadirPointsIntoScreen(frame, vs)).toBe(true);
    expect(vs.rotationX).toBeGreaterThanOrEqual(28);
    expect(vs.rotationX).toBeLessThanOrEqual(58);
  });

  it('keeps nadir into the screen when the satellite is in the southern hemisphere', () => {
    const frame = {
      radialUnit: { x: 0.2, y: -0.5, z: -0.84 },
      orbitNormalUnit: { x: 0.6, y: 0.5, z: 0.624 },
    };
    const vs = computeInitialViewState(frame);
    expect(nadirPointsIntoScreen(frame, vs)).toBe(true);
  });
});

describe('eyeDirectionFromViewState', () => {
  it('matches deck.gl OrbitViewport Z-up camera positions at known angles', () => {
    const at0 = eyeDirectionFromViewState({ rotationX: 0, rotationOrbit: 0 });
    expect(at0.x).toBeCloseTo(0, 6);
    expect(at0.y).toBeCloseTo(-1, 6);
    expect(at0.z).toBeCloseTo(0, 6);

    const atMinus90 = eyeDirectionFromViewState({
      rotationX: 0,
      rotationOrbit: -90,
    });
    expect(atMinus90.x).toBeCloseTo(1, 6);
    expect(atMinus90.y).toBeCloseTo(0, 6);
    expect(atMinus90.z).toBeCloseTo(0, 6);
  });
});
