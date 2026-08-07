'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { DeckGL, OrbitView } from 'deck.gl';
import type { OrbitViewState } from '@deck.gl/core';
import {
  LineLayer,
  PolygonLayer,
  ScatterplotLayer,
  TextLayer,
} from '@deck.gl/layers';
import { CornerAccents } from '@/components/MiniGlobe/CornerAccents';
import { cn } from '@/lib/utils';
import type { FlightDynamicsCanvasProps } from './types';
import { computeInitialViewState } from '@/lib/flightDynamicsViewState';

// Visual (not physical) length budget, in world units, for every vector
// arrow. H and the plane ring always draw at MAX_ARROW_LENGTH (they're
// orientation indicators, not magnitude-meaningful for this app). N and
// V instead scale within [MIN_ARROW_LENGTH, MAX_ARROW_LENGTH] based on
// the object's real altitude/speed -- see normalizeToArrowLength below.
const MAX_ARROW_LENGTH = 46;
const MIN_ARROW_LENGTH = 14;
const PLANE_RADIUS = MAX_ARROW_LENGTH * 0.85;
const EQUATOR_RADIUS = PLANE_RADIUS * 1.08;
const NORTH_AXIS_LENGTH = MAX_ARROW_LENGTH * 0.7;
const PLANE_SEGMENTS = 48;

// Reference range for scaling the nadir vector's length by real altitude.
// Chosen for LEO re-entry triage specifically: below ~120km an object is
// in its final hours; above ~1000km it's comfortably outside near-term
// decay risk, so both ends clamp rather than
// extrapolate further. A shorter N arrow reads as "closer to Earth."
const ALTITUDE_MIN_KM = 120;
const ALTITUDE_MAX_KM = 1000;

// Reference range for scaling the velocity vector's length by real
// speed. Real LEO circular speeds only span roughly this range (faster
// at lower altitude)
const SPEED_MIN_KMS = 6.9;
const SPEED_MAX_KMS = 7.85;

function normalizeToArrowLength(
  value: number,
  min: number,
  max: number
): number {
  const clamped = Math.min(max, Math.max(min, value));
  const t = (clamped - min) / (max - min);
  return MIN_ARROW_LENGTH + t * (MAX_ARROW_LENGTH - MIN_ARROW_LENGTH);
}

type RgbColor = [number, number, number];
const NADIR_COLOR: RgbColor = [150, 110, 255]; // purple
const VELOCITY_COLOR: RgbColor = [0, 220, 255]; // cyan
const ORBIT_NORMAL_COLOR: RgbColor = [180, 190, 200]; // white/grey
const EQUATOR_COLOR: RgbColor = [70, 130, 190]; // muted blue — ECI XY plane
const NORTH_COLOR: RgbColor = [210, 170, 90]; // muted gold — ECI +Z
const EARTH_COLOR: RgbColor = [70, 140, 200]; // Earth-direction cue on nadir tip
const ORIGIN_COLOR: RgbColor = [235, 235, 240]; // near-white satellite marker

const TIP_RADIUS_PX = 4;

// Where on the orbital-plane ring to draw the direction-of-motion
// chevron, in radians.
const MOTION_ARROW_THETA = -Math.PI / 2;

// Fallback only used before the first orbital frame arrives. Real framing
// comes from computeInitialViewState (zenith-side camera so N points into
// the scene). orbitAxis is 'Z' so celestial north stays the up/orbit axis.
const FALLBACK_VIEW_STATE: OrbitViewState = {
  target: [0, 0, 0],
  zoom: 1.15,
  rotationX: 40,
  rotationOrbit: 0,
};

type Vec3 = [number, number, number];

function toVec3(v: { x: number; y: number; z: number }, scale: number): Vec3 {
  return [v.x * scale, v.y * scale, v.z * scale];
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scaleVec(v: Vec3, s: number): Vec3 {
  return [v[0] * s, v[1] * s, v[2] * s];
}

/** In-plane orthonormal basis for the orbital plane: u = radial direction,
 * w = orbitNormal x u (also in-plane, perpendicular to u). Increasing
 * angle from u toward w is, by construction, the satellite's true
 * direction of travel (right-hand rule around h = r x v) -- verified
 * against the circular-orbit case in lib/orbitalFrame.test.ts's math. */
function buildOrbitPlaneBasis(
  radialUnit: Vec3,
  orbitNormalUnit: Vec3
): { u: Vec3; w: Vec3 } {
  const u = radialUnit;
  const w: Vec3 = [
    orbitNormalUnit[1] * u[2] - orbitNormalUnit[2] * u[1],
    orbitNormalUnit[2] * u[0] - orbitNormalUnit[0] * u[2],
    orbitNormalUnit[0] * u[1] - orbitNormalUnit[1] * u[0],
  ];
  return { u, w };
}

function ringPoint(u: Vec3, w: Vec3, theta: number, radius: number): Vec3 {
  const cos = Math.cos(theta) * radius;
  const sin = Math.sin(theta) * radius;
  return [
    u[0] * cos + w[0] * sin,
    u[1] * cos + w[1] * sin,
    u[2] * cos + w[2] * sin,
  ];
}

function buildPlaneRing(
  u: Vec3,
  w: Vec3,
  radius: number,
  segments: number
): Vec3[] {
  const ring: Vec3[] = [];
  for (let i = 0; i <= segments; i++) {
    ring.push(ringPoint(u, w, (i / segments) * Math.PI * 2, radius));
  }
  return ring;
}

/** ECI equatorial plane = XY (Z = celestial north). Same frame as
 * satellite.js SGP4 position/velocity, so inclination is literally the
 * dihedral angle between this disc and the orbital-plane disc. */
function buildEquatorRing(radius: number, segments: number): Vec3[] {
  const ring: Vec3[] = [];
  for (let i = 0; i <= segments; i++) {
    const theta = (i / segments) * Math.PI * 2;
    ring.push([Math.cos(theta) * radius, Math.sin(theta) * radius, 0]);
  }
  return ring;
}

/** Small filled chevron sitting on the ring, pointing toward increasing
 * theta -- i.e. the satellite's actual direction of travel. */
function buildMotionArrowhead(
  u: Vec3,
  w: Vec3,
  radius: number,
  centerTheta: number
): Vec3[] {
  const halfWidth = radius * 0.1;
  const tipAheadRad = 0.26;
  return [
    ringPoint(u, w, centerTheta + tipAheadRad, radius),
    ringPoint(u, w, centerTheta, radius + halfWidth),
    ringPoint(u, w, centerTheta, radius - halfWidth),
  ];
}

type VectorDatum = {
  id: string;
  label: string;
  tip: Vec3;
  color: RgbColor;
};

export function FlightDynamicsCanvas({
  orbitalFrame,
  className,
  emptyMessage = 'Select an object to view flight dynamics',
  heightPx = 160,
  showLegend = true,
}: FlightDynamicsCanvasProps) {
  const [viewState, setViewState] = useState<OrbitViewState>(() =>
    orbitalFrame ? computeInitialViewState(orbitalFrame) : FALLBACK_VIEW_STATE
  );

  // Auto-frame once when the first frame arrives. Do
  // not re-frame on later propagations — that would fight free-rotate.
  // Satellite switches remount via key={id}, which resets this ref.
  const didAutoFrame = useRef(orbitalFrame != null);
  useEffect(() => {
    if (!orbitalFrame || didAutoFrame.current) return;
    didAutoFrame.current = true;
    setViewState(computeInitialViewState(orbitalFrame));
  }, [orbitalFrame]);

  const vectors = useMemo<VectorDatum[]>(() => {
    if (!orbitalFrame) return [];

    // Nadir points toward Earth's center -- the negative of radialUnit. Length scales with real altitude.
    const nadirLength = normalizeToArrowLength(
      orbitalFrame.approxAltitudeKm,
      ALTITUDE_MIN_KM,
      ALTITUDE_MAX_KM
    );
    // Length scales with real speed.
    const velocityLength = normalizeToArrowLength(
      orbitalFrame.speedKmS,
      SPEED_MIN_KMS,
      SPEED_MAX_KMS
    );
    const nadirTip = toVec3(orbitalFrame.radialUnit, -nadirLength);
    const velocityTip = toVec3(orbitalFrame.velocityUnit, velocityLength);

    const result: VectorDatum[] = [
      { id: 'nadir', label: 'N', tip: nadirTip, color: NADIR_COLOR },
      { id: 'velocity', label: 'V', tip: velocityTip, color: VELOCITY_COLOR },
    ];

    if (orbitalFrame.orbitNormalUnit) {
      result.push({
        id: 'normal',
        label: 'H',
        tip: toVec3(orbitalFrame.orbitNormalUnit, MAX_ARROW_LENGTH),
        color: ORBIT_NORMAL_COLOR,
      });
    }

    return result;
  }, [orbitalFrame]);

  const nadirTip = useMemo(() => {
    return vectors.find((v) => v.id === 'nadir')?.tip ?? null;
  }, [vectors]);

  const planeBasis = useMemo(() => {
    if (!orbitalFrame?.orbitNormalUnit) return null;
    return buildOrbitPlaneBasis(
      toVec3(orbitalFrame.radialUnit, 1),
      toVec3(orbitalFrame.orbitNormalUnit, 1)
    );
  }, [orbitalFrame]);

  const planeRing = useMemo(() => {
    if (!planeBasis) return null;
    return buildPlaneRing(
      planeBasis.u,
      planeBasis.w,
      PLANE_RADIUS,
      PLANE_SEGMENTS
    );
  }, [planeBasis]);

  const equatorRing = useMemo(
    () => buildEquatorRing(EQUATOR_RADIUS, PLANE_SEGMENTS),
    []
  );

  const motionArrowhead = useMemo(() => {
    if (!planeBasis) return null;
    return buildMotionArrowhead(
      planeBasis.u,
      planeBasis.w,
      PLANE_RADIUS,
      MOTION_ARROW_THETA
    );
  }, [planeBasis]);

  const layers = useMemo(() => {
    if (vectors.length === 0) return [];

    const origin: Vec3 = [0, 0, 0];
    const northTip: Vec3 = [0, 0, NORTH_AXIS_LENGTH];

    // Absolute ECI reference: celestial equator (XY). Inclination is the
    // angle between this disc and the orbital-plane disc below.
    const equatorLayer = new PolygonLayer({
      id: 'flight-dynamics-equator',
      data: [{ ring: equatorRing }],
      getPolygon: (d: { ring: Vec3[] }) => d.ring,
      getFillColor: [...EQUATOR_COLOR, 18] as [number, number, number, number],
      getLineColor: [...EQUATOR_COLOR, 90] as [number, number, number, number],
      lineWidthUnits: 'pixels',
      getLineWidth: 1,
      stroked: true,
      filled: true,
      pickable: false,
    });

    const northAxisLayer = new LineLayer<{ tip: Vec3 }>({
      id: 'flight-dynamics-north-axis',
      data: [{ tip: northTip }],
      getSourcePosition: () => origin,
      getTargetPosition: (d) => d.tip,
      getColor: [...NORTH_COLOR, 200] as [number, number, number, number],
      getWidth: 1.5,
      widthUnits: 'pixels',
      pickable: false,
    });

    const northLabelLayer = new TextLayer<{ tip: Vec3; label: string }>({
      id: 'flight-dynamics-north-label',
      data: [{ tip: northTip, label: 'Z' }],
      getPosition: (d) => scaleVec(d.tip, 1.12) as Vec3,
      getText: (d) => d.label,
      getColor: [...NORTH_COLOR, 255] as [number, number, number, number],
      getSize: 11,
      sizeUnits: 'pixels',
      fontFamily: 'monospace',
      fontWeight: 600,
      pickable: false,
    });

    const planeLayer = planeRing
      ? new PolygonLayer({
          id: 'flight-dynamics-plane',
          data: [{ ring: planeRing }],
          getPolygon: (d: { ring: Vec3[] }) => d.ring,
          getFillColor: [...ORBIT_NORMAL_COLOR, 20] as [
            number,
            number,
            number,
            number,
          ],
          getLineColor: [...ORBIT_NORMAL_COLOR, 70] as [
            number,
            number,
            number,
            number,
          ],
          lineWidthUnits: 'pixels',
          getLineWidth: 1.25,
          stroked: true,
          filled: true,
          pickable: false,
        })
      : null;

    // Subtle chevron on the plane ring showing which way the satellite
    // actually travels around its orbit.
    const motionArrowLayer = motionArrowhead
      ? new PolygonLayer({
          id: 'flight-dynamics-motion-arrow',
          data: [{ ring: motionArrowhead }],
          getPolygon: (d: { ring: Vec3[] }) => d.ring,
          getFillColor: [...ORBIT_NORMAL_COLOR, 70] as [
            number,
            number,
            number,
            number,
          ],
          stroked: false,
          filled: true,
          pickable: false,
        })
      : null;

    const lineLayer = new LineLayer<VectorDatum>({
      id: 'flight-dynamics-vectors',
      data: vectors,
      getSourcePosition: () => origin,
      getTargetPosition: (d) => d.tip,
      getColor: (d) => [...d.color, 230] as [number, number, number, number],
      getWidth: 2.5,
      widthUnits: 'pixels',
      pickable: false,
    });

    // Soft halo under the nadir tip: N still reads purple, blue ring marks toward Earth's center
    const earthCueLayer = nadirTip
      ? new ScatterplotLayer<Vec3>({
          id: 'flight-dynamics-earth-cue',
          data: [nadirTip],
          getPosition: (d) => d,
          getFillColor: [...EARTH_COLOR, 55] as [
            number,
            number,
            number,
            number,
          ],
          getLineColor: [...EARTH_COLOR, 200] as [
            number,
            number,
            number,
            number,
          ],
          getRadius: 9,
          radiusUnits: 'pixels',
          stroked: true,
          getLineWidth: 1.5,
          lineWidthUnits: 'pixels',
          pickable: false,
        })
      : null;

    const tipLayer = new ScatterplotLayer<VectorDatum>({
      id: 'flight-dynamics-tips',
      data: vectors,
      getPosition: (d) => d.tip,
      getFillColor: (d) =>
        [...d.color, 255] as [number, number, number, number],
      getRadius: TIP_RADIUS_PX,
      radiusUnits: 'pixels',
      pickable: false,
    });

    const labelLayer = new TextLayer<VectorDatum>({
      id: 'flight-dynamics-labels',
      data: vectors,
      // Nudge labels a little past the tip so they don't overlap the arrowhead dot
      getPosition: (d) => scaleVec(subtract(d.tip, origin), 1.12) as Vec3,
      getText: (d) => d.label,
      getColor: (d) => [...d.color, 255] as [number, number, number, number],
      getSize: 12,
      sizeUnits: 'pixels',
      fontFamily: 'monospace',
      fontWeight: 600,
      pickable: false,
    });

    const originLayer = new ScatterplotLayer<Vec3>({
      id: 'flight-dynamics-origin',
      data: [origin],
      getPosition: (d) => d,
      getFillColor: [...ORIGIN_COLOR, 255] as [number, number, number, number],
      getRadius: 5,
      radiusUnits: 'pixels',
      pickable: false,
    });

    return [
      equatorLayer,
      northAxisLayer,
      ...(planeLayer ? [planeLayer] : []),
      ...(motionArrowLayer ? [motionArrowLayer] : []),
      northLabelLayer,
      lineLayer,
      ...(earthCueLayer ? [earthCueLayer] : []),
      tipLayer,
      labelLayer,
      originLayer,
    ];
  }, [vectors, planeRing, motionArrowhead, equatorRing, nadirTip]);

  const hasContent = vectors.length > 0;

  return (
    <div>
      <div
        className={cn(
          'relative bg-black/60 border border-white/10 my-3 overflow-hidden',
          className
        )}
        style={{ height: heightPx }}
      >
        <CornerAccents />
        {!hasContent ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-[11px] text-gray-500 uppercase tracking-wider">
            {emptyMessage}
          </div>
        ) : (
          <DeckGL
            views={new OrbitView({ orbitAxis: 'Z', orthographic: true })}
            viewState={viewState}
            onViewStateChange={({ viewState: vs }) =>
              setViewState(vs as OrbitViewState)
            }
            controller={true}
            layers={layers}
            style={{ width: '100%', height: '100%', position: 'relative' }}
          />
        )}
      </div>
      {hasContent && showLegend && (
        <div className="mt-1 mb-2 space-y-0.5 text-[9px] font-bold uppercase tracking-wider text-gray-500">
          <p className="flex justify-between gap-2">
            <span>
              <span style={{ color: `rgb(${NADIR_COLOR.join(',')})` }}>N</span>{' '}
              nadir
            </span>
            <span>
              <span style={{ color: `rgb(${VELOCITY_COLOR.join(',')})` }}>
                V
              </span>{' '}
              velocity
            </span>
            <span>
              <span style={{ color: `rgb(${ORBIT_NORMAL_COLOR.join(',')})` }}>
                H
              </span>{' '}
              orbit normal
            </span>
          </p>
          <p className="flex justify-between gap-2">
            <span>
              <span style={{ color: `rgb(${NORTH_COLOR.join(',')})` }}>Z</span>{' '}
              celestial n
            </span>
            <span className="text-gray-500">tilt = incl.</span>
          </p>
        </div>
      )}
    </div>
  );
}
