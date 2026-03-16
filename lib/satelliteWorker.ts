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

import {
  CandidatePair,
  DensityCell,
  DensityResult,
  DensityWorkerInput,
  DensityWorkerOptions,
} from './types';

export type {
  CandidatePair,
  DensityCell,
  DensityResult,
  DensityWorkerInput,
  DensityWorkerOptions,
};

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
  generateGroundTrack: (
    l1: string,
    l2: string,
    samples?: number
  ) => Promise<Array<[number, number]> | null>;
  computeCollisionDensity: (
    items: DensityWorkerInput[],
    options?: DensityWorkerOptions
  ) => Promise<DensityResult>;
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

// Batch position at offset : a thin wrapper that stamps a future date on every item
export async function batchPositionAtOffsetAsync(
  entries: Array<{ l1: string; l2: string }>,
  offsetMs: number
): Promise<Array<{ lat: number; lon: number; altKm: number } | null>> {
  const targetDate = new Date(Date.now() + offsetMs);
  const items = entries.map((e) => ({
    l1: e.l1,
    l2: e.l2,
    date: targetDate,
  }));
  return batchPositionFromTLEAsync(items) as Promise<Array<{ lat: number; lon: number; altKm: number } | null>>;
}


// Generate ground track
export async function generateGroundTrackAsync(
  l1: string,
  l2: string,
  samples: number = 360
): Promise<Array<[number, number]> | null> {
  const key = makeKey('generateGroundTrack', [l1, l2, samples]);
  if (cache.has(key)) return cache.get(key) as Array<[number, number]> | null;

  const v = await (async () => {
    try {
      const proxy = await getWorkerProxy();
      if (proxy) {
        return await (proxy as SatelliteWorkerProxy).generateGroundTrack(
          l1,
          l2,
          samples
        );
      }
    } catch (err) {
      console.warn(
        'satellite worker failed for ground track, falling back',
        err
      );
    }
    return null;
  })();

  cache.set(key, v);
  if (cache.size > CACHE_MAX) {
    const it = cache.keys().next();
    cache.delete(it.value as string);
  }
  return v;
}

export async function computeCollisionDensityAsync(
  items: DensityWorkerInput[],
  options?: DensityWorkerOptions
): Promise<DensityResult> {
  // Create a hash of satellite positions for cache key
  // Use rounded positions to allow for small floating point variations
  // This ensures different satellite configurations don't share cache entries
  const positionHash = items
    .map(
      (item) =>
        `${item.id}:${Math.round(item.lat * 100)}:${Math.round(
          item.lon * 100
        )}:${Math.round(item.altKm * 10)}`
    )
    .sort()
    .join('|');

  const key = makeKey('computeCollisionDensity', [
    positionHash,
    items.length,
    options?.voxelSizeKm,
    options?.detectionRadiusKm,
    options?.gridCellSizeDeg,
    options?.maxPairs,
  ]);

  if (cache.has(key)) {
    return cache.get(key) as DensityResult;
  }

  const v = await (async () => {
    try {
      const proxy = await getWorkerProxy();
      if (proxy) {
        return await (proxy as SatelliteWorkerProxy).computeCollisionDensity(
          items,
          options
        );
      }
    } catch (err) {
      console.warn(
        'satellite worker failed for collision density, returning empty result',
        err
      );
    }
    return {
      densityCells: [],
      candidatePairs: [],
      stats: {
        totalSatellites: 0,
        totalCells: 0,
        maxCellCount: 0,
        detectionRadiusKm: options?.detectionRadiusKm ?? 75,
        voxelSizeKm: options?.voxelSizeKm ?? 50,
        gridCellSizeDeg: options?.gridCellSizeDeg ?? 2,
      },
      generatedAt: new Date().toISOString(),
    } as DensityResult;
  })();

  cache.set(key, v);
  if (cache.size > CACHE_MAX) {
    const it = cache.keys().next();
    cache.delete(it.value as string);
  }
  return v;
}
