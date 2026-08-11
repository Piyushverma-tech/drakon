import redis from '@/lib/redis';

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

export async function getSpaceTrackSession(): Promise<string> {
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

export async function invalidateSpaceTrackSession(): Promise<void> {
  await redis.del(SESSION_KEY);
}
