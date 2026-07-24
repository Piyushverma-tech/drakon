import redis from '@/lib/redis';
import { parseTleText } from '@/lib/tle';
import type { TLEProvider, TleFetchOptions, TleFetchResult } from './types';

// ─── Auth ────────────────────────────────────────────────────────────────
// Session-cookie based, not a simple API key. Space-Track's login endpoint
// sets a cookie literally named "chocolatechip" — confirmed against their
// docs, not a typo.
const SESSION_KEY = 'spacetrack:session_cookie';
// Space-Track doesn't publish an exact idle timeout for the session
// cookie, so re-authenticate every 2h regardless of whether it's still valid.
const SESSION_TTL_SECONDS = 60 * 60 * 2;

export function extractSessionCookie(setCookieHeader: string): string {
  // "chocolatechip=abc123; Path=/; Expires=...; HttpOnly" -> "chocolatechip=abc123"
  // Store/send only the name=value pair — the raw header's other attributes
  // (Path, Expires, HttpOnly) are response-only and don't belong in a
  // request Cookie header.
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
// Scope by predicate, never by NORAD_CAT_ID list — chunking ~18,676 objects
// into ~500-per-request batches would mean ~38 sequential calls, a real
// risk of exceeding Vercel's 60s cap. OBJECT_TYPE/PAYLOAD,ROCKET BODY makes
// Space-Track filter server-side and return everything in one request.
const SPACETRACK_SCOPE = 'OBJECT_TYPE/PAYLOAD,ROCKET BODY';

// No stateful cursor. The `gp` class always returns exactly one row per
// object (the latest elset), not a history — so a wide window doesn't
// bloat the response with duplicates, it just also catches objects that
// haven't refreshed in a while. Re-fetching an unchanged epoch is a no-op
// via onConflictDoNothing downstream, so a missed cycle or two is harmless.
const HOURLY_WINDOW_DAYS = 3;
const RESYNC_WINDOW_DAYS = 45;

// Poll GP data once per hour, full stop. This is Space-Track's own
// documented retrieval guidance for the `gp` class (distinct from, and
// stricter than, the general 30/min-300/hour API throttle) and comes with
// an explicit account-suspension warning attached. Don't call fetch() on a
// tighter schedule without contacting Space-Track first — see the plan's
// §4 and §13 for the full reasoning.

async function fetchFromSpaceTrack(
  options: TleFetchOptions
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
    // Request 3le explicitly, never bare 'tle'. Space-Track's glossary
    // treats "TLE" and "Three Line Format" as distinct — unlike CelesTrak,
    // where FORMAT=tle and FORMAT=3le are documented synonyms. This is
    // NOT yet empirically confirmed against a live query (do that first,
    // per the plan's Phase 0, before trusting this in shadow mode).
    `format/${options.format ?? '3le'}`,
  ];
  const url = `https://www.space-track.org/basicspacedata/query/class/gp/${predicates.join('/')}`;

  const res = await fetch(url, { headers: { cookie } });
  if (res.status === 401 || res.status === 403) {
    // Re-authenticate once on the next call; don't retry indefinitely here —
    // let the next scheduled run pick it up if it still fails.
    await redis.del(SESSION_KEY);
    throw new Error(
      `Space-Track session rejected (${res.status}) — will retry with fresh auth next call`
    );
  }
  if (!res.ok) throw new Error(`Space-Track query failed: ${res.status}`);

  const raw = await res.text();
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
