import { NextResponse } from 'next/server';
import redis from '@/lib/redis';
import { ingestTleHistory } from '@/lib/jobs/ingestTleHistory';
import { processTrendJobs } from '@/lib/jobs/computeObjectTrends';
import { parseTleText } from '@/lib/tle';
import { solarFluxResponseHeaders } from '@/lib/solarFlux';
import { after } from 'next/server';

export const maxDuration = 60;

const GROUPS = [
  'active',
  'iridium-33-debris',
  'cosmos-2251-debris',
  'fengyun-1c-debris',
];
const CACHE_KEY = 'tle:combined';
const STALE_CACHE_KEY = 'tle:combined:stale';
const CACHE_TTL_SECONDS = 7200;

// Upstash JSON-encodes all values, which can escape newlines in multiline strings.
// This normalizes them back to real newline characters.
function normalizeNewlines(str: string): string {
  return str
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n');
}

async function fetchFromCelestrak(
  groups: string[],
  format: string
): Promise<string> {
  const results: string[] = [];

  for (const g of groups) {
    try {
      const url = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(g)}&FORMAT=${format}`;

      const res = await fetch(url, { cache: 'no-store' });

      if (!res.ok) {
        console.warn(`[TLE] Celestrak returned ${res.status} for group ${g}`);
        continue;
      }

      const text = await res.text();

      // Celestrak returns 200 with error text for invalid groups
      if (
        text.trim().startsWith('Invalid query') ||
        text.trim().startsWith('No GP data')
      ) {
        console.warn(
          `[TLE] Celestrak rejected group ${g}: ${text.slice(0, 80)}`
        );
        continue;
      }

      // Sanity check — valid TLE text should have lines starting with "1 " and "2 "
      const lines = text.split('\n').filter(Boolean);
      const hasTleLines = lines.some(
        (l) => l.startsWith('1 ') || l.startsWith('2 ')
      );
      if (!hasTleLines) {
        console.warn(`[TLE] Celestrak returned non-TLE content for group ${g}`);
        continue;
      }

      results.push(text);
      console.log(
        `[TLE] Fetched group ${g}: ~${Math.floor(lines.length / 3)} objects`
      );
    } catch (err) {
      console.error(`[TLE] Failed to fetch group ${g}:`, err);
    }
    await new Promise((r) => setTimeout(r, 1100));
  }
  return results.filter(Boolean).join('\n');
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const groups = searchParams.getAll('group');
  const format = searchParams.get('format') || 'tle';
  const effectiveGroups = groups.length > 0 ? groups : GROUPS;

  const isDefaultGroups =
    JSON.stringify([...effectiveGroups].sort()) ===
    JSON.stringify([...GROUPS].sort());

  // Step 1: Try Redis cache
  if (isDefaultGroups) {
    try {
      const [cached, solarHeaders] = await Promise.all([
        redis.get<string>(CACHE_KEY),
        solarFluxResponseHeaders(),
      ]);
      if (cached && cached.trim()) {
        console.log(`[TLE] Cache HIT (${cached.length} bytes)`);
        return new NextResponse(normalizeNewlines(cached), {
          headers: {
            'content-type': 'text/plain',
            'x-cache': 'HIT',
            ...solarHeaders,
          },
        });
      }
      console.log('[TLE] Cache MISS');
    } catch (err) {
      console.warn('[TLE] Redis GET failed:', err);
    }
  }

  // Step 2: Fetch from Celestrak
  const combined = await fetchFromCelestrak(effectiveGroups, format);

  const lines = combined.split('\n').filter(Boolean);
  console.log(
    `[TLE] Combined fetch: ${Math.floor(lines.length / 3)} objects total`
  );

  if (!combined.trim()) {
    // Celestrak blocked — serve stale
    console.warn('[TLE] Celestrak empty — trying stale cache');
    try {
      const [stale, solarHeaders] = await Promise.all([
        redis.get<string>(STALE_CACHE_KEY),
        solarFluxResponseHeaders(),
      ]);

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
    } catch (err) {
      console.warn('[TLE] Stale cache read failed:', err);
    }

    return NextResponse.json(
      { error: 'No TLE data available from Celestrak or cache' },
      { status: 502 }
    );
  }

  // Step 3: Fresh data — write cache
  if (isDefaultGroups) {
    try {
      await redis.set(CACHE_KEY, combined, { ex: CACHE_TTL_SECONDS });
      await redis.set(STALE_CACHE_KEY, combined);
      console.log(
        `[TLE] Cached ${combined.length} bytes, TTL ${CACHE_TTL_SECONDS}s`
      );
    } catch (err) {
      console.warn('[TLE] Cache write failed:', err);
    }
  }

  after(async () => {
    try {
      const parsedEntries = parseTleText(combined);
      const ingestResult = await ingestTleHistory(
        parsedEntries,
        effectiveGroups.join(',')
      );
      console.log('[TLE] Historical ingest:', ingestResult);
      await processTrendJobs(100);
    } catch (err) {
      console.warn('[TLE] Post-response pipeline failed:', err);
    }
  });

  const solarHeaders = await solarFluxResponseHeaders();

  return new NextResponse(combined, {
    headers: {
      'content-type': 'text/plain',
      'x-cache': 'MISS',
      ...solarHeaders,
    },
  });
}
