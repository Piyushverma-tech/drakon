import { parseTleText } from '@/lib/tle';
import type { TLEProvider, TleFetchOptions, TleFetchResult } from './types';

// Same two jobs described in the migration plan (§6):
//  1. Always-on source for the three static debris clouds, fetched every
//     cycle regardless of which provider is primary.
//  2. Outage fallback for the payload/rocket-body scope, only when the
//     primary provider fails.
// This module only knows how to fetch+validate CelesTrak groups; which job
// it's being used for is the caller's decision (see the ingestion service).
const DEFAULT_GROUPS = ['active'];

// Content validation logic is unchanged from the original app/api/tle/route.ts
// fetchFromCelestrak() — CelesTrak returns HTTP 200 with an error body for
// invalid/discontinued groups, so a status check alone isn't enough.
async function fetchGroup(group: string, format: string): Promise<string> {
  const url = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(group)}&FORMAT=${format}`;

  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    console.warn(`[TLE] Celestrak returned ${res.status} for group ${group}`);
    return '';
  }

  const text = await res.text();

  if (
    text.trim().startsWith('Invalid query') ||
    text.trim().startsWith('No GP data')
  ) {
    console.warn(
      `[TLE] Celestrak rejected group ${group}: ${text.slice(0, 80)}`
    );
    return '';
  }

  const lines = text.split('\n').filter(Boolean);
  const hasTleLines = lines.some(
    (l) => l.startsWith('1 ') || l.startsWith('2 ')
  );
  if (!hasTleLines) {
    console.warn(`[TLE] Celestrak returned non-TLE content for group ${group}`);
    return '';
  }

  console.log(
    `[TLE] Fetched group ${group}: ~${Math.floor(lines.length / 3)} objects`
  );
  return text;
}

async function fetchFromCelestrak(
  groups: string[],
  format: string
): Promise<string> {
  const results: string[] = [];
  for (const group of groups) {
    try {
      const text = await fetchGroup(group, format);
      if (text) results.push(text);
    } catch (err) {
      console.error(`[TLE] Failed to fetch group ${group}:`, err);
    }
    // Respect CelesTrak's rate limits — unchanged from the original route.
    await new Promise((r) => setTimeout(r, 1100));
  }
  return results.filter(Boolean).join('\n');
}

export const celestrakProvider: TLEProvider = {
  name: 'celestrak',

  async fetch(options: TleFetchOptions = {}): Promise<TleFetchResult> {
    const groups = options.groups?.length ? options.groups : DEFAULT_GROUPS;
    // CelesTrak documents FORMAT=tle and FORMAT=3le as synonyms (both
    // include the name line), unlike Space-Track — but request 3le
    // explicitly anyway for consistency across providers.
    const format = options.format ?? '3le';

    const raw = await fetchFromCelestrak(groups, format);
    const entries = parseTleText(raw);

    return {
      raw,
      provider: 'celestrak',
      fetchedAt: new Date(),
      objectCount: entries.length,
    };
  },
};
