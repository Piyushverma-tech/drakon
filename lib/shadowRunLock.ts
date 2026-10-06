import redis from './redis';

/**
 * Guards against duplicate/overlapping shadow-run triggers -- a
 * scheduler retry on a slow response, or (while the geomagnetic-shadow
 * route still exists standalone for manual/replay use, see
 * app/api/internal/geomagnetic-shadow/route.ts) an external cron trigger
 * left pointed at it after the python-compute-shadow route started also
 * running geomagnetic evaluation internally. Uses Redis SET NX EX, so
 * acquisition is atomic even under truly concurrent invocations -- this
 * isn't an in-process guard, it has to work across separate serverless
 * invocations that share no memory.
 *
 * Returns true if this call acquired the lock (caller should proceed),
 * false if another invocation already holds it (caller should skip that
 * piece of work, not error -- a skipped run just means the next
 * scheduled tick does it instead, which is harmless for an hourly
 * background job).
 *
 * No explicit release: letting the TTL expire is simpler and safer than
 * an explicit delete -- a crash after acquiring but before finishing
 * leaves the same outcome (locked until TTL) either way, without an
 * extra code path to get wrong.
 *
 * Fails open (returns true, i.e. proceeds) if Redis itself errors,
 * rather than blocking every scheduled run on the lock service being
 * down -- duplicate work is wasteful but not harmful (nothing this
 * guards mutates shared state), unlike silently never running at all.
 */
export async function acquireShadowRunLock(
  key: string,
  ttlSeconds: number
): Promise<boolean> {
  try {
    const result = await redis.set(key, String(Date.now()), {
      nx: true,
      ex: ttlSeconds,
    });
    return result !== null;
  } catch (err) {
    console.error(`[acquireShadowRunLock] Redis error for key=${key}, failing open:`, err);
    return true;
  }
}
