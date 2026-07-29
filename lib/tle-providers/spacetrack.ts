import redis from '@/lib/redis';
import { parseTleText } from '@/lib/tle';
import type { TLEProvider, TleFetchOptions, TleFetchResult } from './types';

const SESSION_KEY = 'spacetrack:session_cookie';
// Space-Track doesn't publish an exact idle timeout for the session
// cookie, so re-authenticate every 2h regardless of whether it's still valid.
const SESSION_TTL_SECONDS = 60 * 60 * 2;

export function extractSessionCookie(setCookieHeader: string): string {
  const match = setCookieHeader.match(/chocolatechip=[^;]+/);
  if (!match) {
    throw new Error('Space-Track login response had no chocolatechip cookie');
  }
  return match[0];
}

async function getSession(): Promise<string> {
  const cached = await redis.get<string>(SESSION_KEY);
  if (cached) return cached;

  const res = await fetch('https://www.space-track.org/ajaxauth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      identity: process.env.SPACETRACK_IDENTITY ?? '',
      password: process.env.SPACETRACK_PASSWORD ?? '',
    }),
  });
  if (!res.ok) throw new Error(`Space-Track auth failed: ${res.status}`);

  const rawCookie = res.headers.get('set-cookie');
  if (!rawCookie) {
    throw new Error('Space-Track auth response had no session cookie');
  }

  const cookie = extractSessionCookie(rawCookie);
  await redis.set(SESSION_KEY, cookie, { ex: SESSION_TTL_SECONDS });
  return cookie;
}

// ─── Query ───────────────────────────────────────────────────────────────

// Explicitly percent-encode each value (comma stays literal — it's
// Space-Track's own OR-list separator within one predicate, not something
// to escape). Built this way rather than a raw 'OBJECT_TYPE/PAYLOAD,ROCKET BODY'
// string so the space in "ROCKET BODY" doesn't depend on whatever URL
// parser happens to run this — same explicit-encoding approach celestrak.ts
// already uses for its own GROUP parameter.
const SPACETRACK_OBJECT_TYPES = ['PAYLOAD', 'ROCKET BODY'];
const SPACETRACK_SCOPE = `OBJECT_TYPE/${SPACETRACK_OBJECT_TYPES.map(encodeURIComponent).join(',')}`;

const HOURLY_WINDOW_DAYS = 3;
const RESYNC_WINDOW_DAYS = 45;

async function fetchFromSpaceTrack(
  options: TleFetchOptions = {}
): Promise<TleFetchResult> {
  const cookie = await getSession();
  const windowDays = options.fullResync
    ? RESYNC_WINDOW_DAYS
    : HOURLY_WINDOW_DAYS;

  const predicates = [
    SPACETRACK_SCOPE,
    'decay_date/null-val', // Space-Track's own recommendation — skip objects that can't be propagated
    `epoch/>now-${windowDays}`,
    'orderby/EPOCH asc',
    `format/${options.format ?? '3le'}`,
  ];
  const url = `https://www.space-track.org/basicspacedata/query/class/gp/${predicates.join('/')}`;

  const res = await fetch(url, { headers: { cookie } });

  if (res.status === 401 || res.status === 403) {
    // Re-authenticate once on the next call.
    await redis.del(SESSION_KEY);
    throw new Error(
      `Space-Track session rejected (${res.status}) — will retry with fresh auth next call`
    );
  }
  if (!res.ok) throw new Error(`Space-Track query failed: ${res.status}`);

  const raw = await res.text();

  const lines = raw.split(/\r?\n/).filter(Boolean);
  const hasTleLines = lines.some(
    (l) => l.startsWith('1 ') || l.startsWith('2 ')
  );
  if (!hasTleLines) {
    throw new Error(
      'Space-Track query returned no valid TLE lines (empty or degraded response)'
    );
  }

  const entries = parseTleText(raw);
  return {
    raw,
    provider: 'spacetrack',
    fetchedAt: new Date(),
    objectCount: entries.length,
  };
}

export const spacetrackProvider: TLEProvider = {
  name: 'spacetrack',
  fetch: fetchFromSpaceTrack,
};
