import { NextResponse } from 'next/server';
import {
  GEOMAG_ACTIVITY_THRESHOLD,
  GEOMAG_AMPLITUDE,
  GEOMAG_MODEL_VERSION,
  GEOMAG_POWER,
  GEOMAG_SCALE,
  MAX_GEOMAG_MULTIPLIER,
  getGeomagneticState,
  refreshGeomagneticIndexInRedis,
} from '@/lib/geomagneticIndex';

/**
 * Stage 2 observability endpoint (plan §14, §21). Deliberately separate
 * from /api/tle, mirroring how /api/solar-flux is separate from it — this
 * route's output is not consumed anywhere in the production risk path.
 * `calibrated: false` in every response is intentional: the multiplier
 * parameters here are Stage 2 placeholders (see lib/geomagneticIndex.ts),
 * not a validated correction.
 */
export async function GET() {
  const state = await getGeomagneticState();

  return NextResponse.json({
    ...state,
    calibration: {
      modelVersion: GEOMAG_MODEL_VERSION,
      activityThreshold: GEOMAG_ACTIVITY_THRESHOLD,
      scale: GEOMAG_SCALE,
      power: GEOMAG_POWER,
      amplitude: GEOMAG_AMPLITUDE,
      maxMultiplier: MAX_GEOMAG_MULTIPLIER,
      calibrated: false,
    },
  });
}

export async function POST(req: Request) {
  const secret = req.headers.get('x-internal-secret');
  if (secret !== process.env.INTERNAL_JOB_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await refreshGeomagneticIndexInRedis();
    if (!result) {
      return NextResponse.json(
        { error: 'Failed to fetch or validate Kp from NOAA' },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ...result,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[GeomagneticIndex] Refresh failed:', err);
    return NextResponse.json(
      { error: 'Geomagnetic index refresh failed' },
      { status: 500 }
    );
  }
}
