import * as Comlink from 'comlink';

// Note: dynamic import of worker for client-side only
let proxy: unknown = null;
let workerInstance: Worker | null = null;

// Simple in-memory cache keyed by JSON args string
const cache = new Map<string, unknown>();
const CACHE_MAX = 1000;

function makeKey(name: string, args: unknown[]) {
  try {
    return name + ':' + JSON.stringify(args);
  } catch {
    return name + ':' + String(args);
  }
}

async function getWorkerProxy() {
  if (proxy) return proxy;
  if (typeof window === 'undefined') return null; // server-side

  if (!workerInstance) {
    workerInstance = new Worker(
      new URL('./workers/satellite.worker.ts', import.meta.url),
      { type: 'module' }
    );
    proxy = Comlink.wrap(workerInstance as unknown as Worker);
  }
  return proxy;
}

// Fallback imports for server-side or if worker fails
import {
  positionFromTLE as syncPositionFromTLE,
  tleToLatLonAlt as syncTleToLatLonAlt,
  satrecFromTLE as syncSatrecFromTLE,
} from './satellite';

type SatelliteWorkerProxy = {
  positionFromTLE: (
    l1: string,
    l2: string,
    dateIso?: string
  ) => Promise<unknown>;
  tleToLatLonAlt: (l1: string, l2: string) => Promise<unknown> | null;
  satrecFromTLE: (l1: string, l2: string) => Promise<unknown>;
  batchPositionFromTLE: (
    items: Array<{ l1: string; l2: string; dateIso?: string }>
  ) => Promise<unknown[]>;
};

export async function positionFromTLEAsync(
  tle1: string,
  tle2: string,
  date?: Date
) {
  const key = makeKey('positionFromTLE', [tle1, tle2, date?.toISOString()]);
  if (cache.has(key)) return cache.get(key);

  const p = await (async () => {
    try {
      const proxy = await getWorkerProxy();
      if (proxy) {
        return await (proxy as SatelliteWorkerProxy).positionFromTLE(
          tle1,
          tle2,
          date ? date.toISOString() : undefined
        );
      }
    } catch (err) {
      console.warn('satellite worker failed, falling back to sync', err);
    }
    return syncPositionFromTLE(tle1, tle2, date);
  })();

  cache.set(key, p);
  if (cache.size > CACHE_MAX) {
    // simple eviction: delete oldest
    const it = cache.keys().next();
    cache.delete(it.value as string);
  }
  return p;
}

export async function tleToLatLonAltAsync(l1: string, l2: string) {
  const key = makeKey('tleToLatLonAlt', [l1, l2]);
  if (cache.has(key)) return cache.get(key);
  const v = await (async () => {
    try {
      const proxy = await getWorkerProxy();
      if (proxy) {
        return await (proxy as SatelliteWorkerProxy).tleToLatLonAlt(l1, l2);
      }
    } catch (err) {
      console.warn('satellite worker failed, falling back to sync', err);
    }
    return syncTleToLatLonAlt(l1, l2);
  })();
  cache.set(key, v);
  if (cache.size > CACHE_MAX) {
    const it = cache.keys().next();
    cache.delete(it.value as string);
  }
  return v;
}

export async function satrecFromTLEAsync(l1: string, l2: string) {
  const key = makeKey('satrecFromTLE', [l1, l2]);
  if (cache.has(key)) return cache.get(key);
  const v = await (async () => {
    try {
      const proxy = await getWorkerProxy();
      if (proxy) {
        return await (proxy as SatelliteWorkerProxy).satrecFromTLE(l1, l2);
      }
    } catch (err) {
      console.warn('satellite worker failed, falling back to sync', err);
    }
    return syncSatrecFromTLE(l1, l2);
  })();
  cache.set(key, v);
  if (cache.size > CACHE_MAX) {
    const it = cache.keys().next();
    cache.delete(it.value as string);
  }
  return v;
}

export async function batchPositionFromTLEAsync(
  items: Array<{ l1: string; l2: string; date?: Date }>
) {
  const key = makeKey(
    'batchPositionFromTLE',
    items.map((it) => [it.l1, it.l2, it.date?.toISOString()])
  );
  if (cache.has(key)) return cache.get(key);

  const v = await (async () => {
    try {
      const proxy = await getWorkerProxy();
      if (proxy) {
        const mapped = items.map((it) => ({
          l1: it.l1,
          l2: it.l2,
          dateIso: it.date ? it.date.toISOString() : undefined,
        }));
        return await (proxy as SatelliteWorkerProxy).batchPositionFromTLE(
          mapped
        );
      }
    } catch (err) {
      console.warn('satellite worker failed, falling back to sync', err);
    }
    // fallback synchronous map
    return items.map((it) => syncPositionFromTLE(it.l1, it.l2, it.date));
  })();

  cache.set(key, v);
  if (cache.size > CACHE_MAX) {
    const it = cache.keys().next();
    cache.delete(it.value as string);
  }
  return v;
}
