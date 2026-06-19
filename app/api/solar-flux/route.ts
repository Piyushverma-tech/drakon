import { NextResponse } from 'next/server';
import { getSolarFlux, refreshSolarFluxInRedis } from '@/lib/solarFlux';

export async function GET() {
  const { f107, multiplier } = await getSolarFlux();

  return NextResponse.json({
    f107,
    multiplier,
    source: f107 !== null ? 'redis' : 'default',
  });
}

export async function POST(req: Request) {
  const secret = req.headers.get('x-internal-secret');
  if (secret !== process.env.INTERNAL_JOB_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await refreshSolarFluxInRedis();
    if (!result) {
      return NextResponse.json(
        { error: 'Failed to fetch or validate F10.7 from NOAA' },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ...result,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[SolarFlux] Refresh failed:', err);
    return NextResponse.json(
      { error: 'Solar flux refresh failed' },
      { status: 500 }
    );
  }
}
