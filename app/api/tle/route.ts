import { NextResponse } from 'next/server';
import redis from '@/lib/redis';
import { solarFluxResponseHeaders } from '@/lib/solarFlux';
import { CACHE_KEY, STALE_CACHE_KEY, normalizeNewlines } from '@/lib/tleCache';

export async function GET() {
  const [cached, solarHeaders] = await Promise.all([
    redis.get<string>(CACHE_KEY),
    solarFluxResponseHeaders(),
  ]);

  if (cached && cached.trim()) {
    return new NextResponse(normalizeNewlines(cached), {
      headers: {
        'content-type': 'text/plain',
        'x-cache': 'HIT',
        ...solarHeaders,
      },
    });
  }

  console.warn('[TLE] tle:combined empty — trying tle:combined:stale');
  const stale = await redis.get<string>(STALE_CACHE_KEY);

  if (stale && stale.trim()) {
    console.warn('[TLE] Serving stale TLE data');
    return new NextResponse(normalizeNewlines(stale), {
      headers: {
        'content-type': 'text/plain',
        'x-cache': 'STALE',
        ...solarHeaders,
      },
    });
  }

  console.error(
    '[TLE] No TLE data in Redis at all — has /api/internal/ingest-tle ever run successfully?'
  );
  return NextResponse.json(
    { error: 'No TLE data available yet' },
    { status: 503 }
  );
}
