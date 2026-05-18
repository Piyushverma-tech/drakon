import * as Comlink from 'comlink';
import * as satellite from 'satellite.js';
import {
  CandidatePair,
  DensityCell,
  DensityResult,
  DensityWorkerInput,
  DensityWorkerOptions,
  FilterOptions,
} from '../types';

export type PropagatedPosition = {
  lat: number;
  lon: number;
  altKm: number;
};

const EARTH_RADIUS_KM = 6378.137;

function positionFromTLE(
  tleLine1: string,
  tleLine2: string,
  dateIso?: string
): PropagatedPosition {
  const date = dateIso ? new Date(dateIso) : new Date();
  const satrec = satellite.twoline2satrec(tleLine1, tleLine2);
  const gmst = satellite.gstime(date);
  const eci = satellite.propagate(satrec, date);

  if (!eci || !eci.position) {
    return { lat: 0, lon: 0, altKm: 0 };
  }

  const geodetic = satellite.eciToGeodetic(eci.position, gmst);
  const longitude = satellite.degreesLong(geodetic.longitude);
  const latitude = satellite.degreesLat(geodetic.latitude);
  const altitudeKm = geodetic.height;
  return { lat: latitude, lon: longitude, altKm: altitudeKm };
}

function tleToLatLonAlt(l1: string, l2: string) {
  const satrec = satellite.twoline2satrec(l1, l2);
  const now = new Date();
  const positionAndVelocity = satellite.propagate(satrec, now);
  if (!positionAndVelocity) {
    return null;
  }
  const positionGd = satellite.eciToGeodetic(
    positionAndVelocity.position!,
    satellite.gstime(now)
  );

  const lat = (positionGd.latitude * 180) / Math.PI;
  const lon = (positionGd.longitude * 180) / Math.PI;
  const alt = positionGd.height;

  return { lat, lon, alt };
}

function satrecFromTLE(tle1: string, tle2: string) {
  return satellite.twoline2satrec(tle1, tle2);
}

async function batchPositionFromTLE(
  items: Array<{ l1: string; l2: string; dateIso?: string }>
) {
  return items.map((it) => positionFromTLE(it.l1, it.l2, it.dateIso));
}

async function generateGroundTrack(
  l1: string,
  l2: string,
  samples: number = 360
): Promise<Array<[number, number]> | null> {
  try {
    const satrec = satellite.twoline2satrec(l1, l2);
    const meanMotionRadPerMin = satrec.no;
    if (!meanMotionRadPerMin || !Number.isFinite(meanMotionRadPerMin)) {
      return null;
    }
    const periodMinutes = (2 * Math.PI) / meanMotionRadPerMin;
    const periodMs = periodMinutes * 60 * 1000;

    const now = new Date();
    const items: Array<{ l1: string; l2: string; dateIso: string }> = [];

    for (let i = 0; i < samples; i++) {
      const t = new Date(now.getTime() + (i / samples) * periodMs);
      items.push({ l1, l2, dateIso: t.toISOString() });
    }

    const positions = await batchPositionFromTLE(items);
    const path: [number, number][] = [];

    for (const pos of positions) {
      if (!pos) continue;
      const p = pos as PropagatedPosition;
      if (p.lat === 0 && p.lon === 0 && p.altKm === 0) continue;
      path.push([p.lon, p.lat]);
    }

    return path.length > 0 ? path : null;
  } catch (error) {
    console.warn('Error generating ground track in worker:', error);
    return null;
  }
}

// Generate satellite track segments for past and future, with opacity encoding distance from current position
async function generateSatelliteTrack(
  l1: string,
  l2: string,
  centerDateIso: string,
  samples: number = 120 // per direction — 120 past + 120 future
): Promise<{
  past: Array<[number, number, number]>;
  future: Array<[number, number, number]>;
} | null> {
  try {
    const satrec = satellite.twoline2satrec(l1, l2);
    const meanMotionRadPerMin = satrec.no;
    if (!meanMotionRadPerMin || !Number.isFinite(meanMotionRadPerMin))
      return null;

    const periodMs = ((2 * Math.PI) / meanMotionRadPerMin) * 60 * 1000;
    const centerTime = new Date(centerDateIso).getTime();

    // Past: from centerTime - 1 period → centerTime
    const pastItems = Array.from({ length: samples }, (_, i) => {
      const t = new Date(centerTime - periodMs + (i / samples) * periodMs);
      return { l1, l2, dateIso: t.toISOString() };
    });

    // Future: from centerTime → centerTime + 1 period
    const futureItems = Array.from({ length: samples }, (_, i) => {
      const t = new Date(centerTime + (i / samples) * periodMs);
      return { l1, l2, dateIso: t.toISOString() };
    });

    const [pastPos, futurePos] = await Promise.all([
      batchPositionFromTLE(pastItems),
      batchPositionFromTLE(futureItems),
    ]);

    // Build [lon, lat, normalizedT] — normalizedT encodes opacity distance
    // Past: normalizedT goes 1.0 (oldest) → 0.0 (at satellite)
    const past: [number, number, number][] = pastPos
      .map((p, i) => {
        if (!p || (p.lat === 0 && p.lon === 0)) return null;
        const t = 1.0 - i / (samples - 1); // 1 at start, 0 at end
        return [p.lon, p.lat, t] as [number, number, number];
      })
      .filter((p): p is [number, number, number] => p !== null);

    // Future: normalizedT goes 0.0 (at satellite) → 1.0 (furthest)
    const future: [number, number, number][] = futurePos
      .map((p, i) => {
        if (!p || (p.lat === 0 && p.lon === 0)) return null;
        const t = i / (samples - 1);
        return [p.lon, p.lat, t] as [number, number, number];
      })
      .filter((p): p is [number, number, number] => p !== null);

    return { past, future };
  } catch {
    return null;
  }
}

function latLonAltToECEF(latDeg: number, lonDeg: number, altKm: number) {
  const latRad = (latDeg * Math.PI) / 180;
  const lonRad = (lonDeg * Math.PI) / 180;
  const radius = EARTH_RADIUS_KM + altKm;
  const cosLat = Math.cos(latRad);

  const x = radius * cosLat * Math.cos(lonRad);
  const y = radius * cosLat * Math.sin(lonRad);
  const z = radius * Math.sin(latRad);
  return { x, y, z };
}

function getVoxelKey(x: number, y: number, z: number, size: number) {
  const ix = Math.floor(x / size);
  const iy = Math.floor(y / size);
  const iz = Math.floor(z / size);
  return `${ix},${iy},${iz}`;
}

function getNeighborKeys(baseKey: string): string[] {
  const [ix, iy, iz] = baseKey.split(',').map((v) => Number(v));
  const keys: string[] = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        keys.push(`${ix + dx},${iy + dy},${iz + dz}`);
      }
    }
  }
  return keys;
}

// Helper: name prefix (first token, uppercase)
function namePrefix(name?: string) {
  if (!name) return '';
  // uppercase, remove trailing numeric suffixes and common tokens
  const s = name.toUpperCase().trim();
  // remove trailing digits, dashes and parentheses blocks, keep first token
  const token = s.split(/\s|_/)[0].replace(/[-_()]+/g, '');
  // strip trailing numbers, common suffixes
  return token.replace(/\d+$/, '').replace(/-DEPLOY|DEPLOY|STACK|PAYLOAD/g, '');
}

// Compute relative speed using satellite.js - returns km/s
function relativeSpeedKmS(
  l1A: string,
  l2A: string,
  l1B: string,
  l2B: string,
  date: Date
): number {
  try {
    const recA = satellite.twoline2satrec(l1A, l2A);
    const recB = satellite.twoline2satrec(l1B, l2B);
    const pvA = satellite.propagate(recA, date);
    const pvB = satellite.propagate(recB, date);
    if (!pvA || !pvA.velocity || !pvB || !pvB.velocity) return Infinity;
    const vx = pvA.velocity.x - pvB.velocity.x;
    const vy = pvA.velocity.y - pvB.velocity.y;
    const vz = pvA.velocity.z - pvB.velocity.z;
    return Math.sqrt(vx * vx + vy * vy + vz * vz);
  } catch (err) {
    console.warn('Error computing relative speed:', err);
    return Infinity;
  }
}

// Filter candidate pairs based on metadata and distance/altitude
function filterCandidatePairs(
  candidatePairs: CandidatePair[],
  itemsMap: Map<
    number,
    { name?: string; operator?: string; l1?: string; l2?: string }
  >,
  opts: FilterOptions = {}
) {
  const {
    sameLaunchIdDiff = 5, // <= this difference -> likely same launch
    relSpeedThresh = 0.001, // km/s -> 0.001 km/s = 1 m/s
    separationThreshKm = 0.05, // 50 meters
    altDiffThreshKm = 1, // 1 km altitude difference tolerance for "identical altitude"
    requireVelocityCheck = true,
  } = opts;

  const filtered: CandidatePair[] = [];
  const now = new Date();

  for (const p of candidatePairs) {
    const metaA = itemsMap.get(p.idA);
    const metaB = itemsMap.get(p.idB);

    // Quick cheap checks first
    const idDiff = Math.abs(p.idA - p.idB);
    const nameA = metaA?.name ?? '';
    const nameB = metaB?.name ?? '';
    const opA = (metaA?.operator || '').toUpperCase();
    const opB = (metaB?.operator || '').toUpperCase();

    // 1) same-launch / id proximity + similar name
    if (idDiff <= sameLaunchIdDiff) {
      const prefixA = namePrefix(nameA);
      const prefixB = namePrefix(nameB);
      if (prefixA && prefixA === prefixB) {
        // likely same stack / deployment
        continue;
      }
      if (opA && opA === opB && opA !== '') {
        // same operator and very near ids -> likely intentional
        continue;
      }
    }

    // 2) same operator + very small separation
    if (opA && opA === opB && p.distanceKm <= separationThreshKm) {
      continue;
    }

    // 3) separation + altitude similarity
    if (
      p.distanceKm <= separationThreshKm &&
      Math.abs(p.altitudeA - p.altitudeB) <= altDiffThreshKm
    ) {
      // very close and same altitude - likely attached
      continue;
    }

    // 4) relative velocity check (slower expensive check)
    if (
      requireVelocityCheck &&
      metaA?.l1 &&
      metaA?.l2 &&
      metaB?.l1 &&
      metaB?.l2
    ) {
      const relV = relativeSpeedKmS(
        metaA.l1,
        metaA.l2,
        metaB.l1,
        metaB.l2,
        now
      );
      if (relV <= relSpeedThresh) {
        // nearly zero relative speed -> probably attached or formation flying
        continue;
      }

      // Co-docked / proximity-hold check: objects within 5 km with < 50 m/s relative velocity are attached or in controlled hold
      // Real conjunctions in LEO have relative velocities of 1–15 km/s
      if (p.distanceKm < 5 && relV < 0.05) {
        continue;
      }
    }

    // Passed filters, keep it
    filtered.push(p);
  }

  return filtered;
}

function incrementHotspotCell(
  densityMap: Map<string, { count: number; latIdx: number; lonIdx: number }>,
  lat: number,
  lon: number,
  gridCellSizeDeg: number,
  satelliteId: number,
  countedHotspotSatellites: Set<number>
) {
  if (countedHotspotSatellites.has(satelliteId)) {
    return;
  }
  countedHotspotSatellites.add(satelliteId);

  const latIdx = Math.floor((lat + 90) / gridCellSizeDeg);
  const lonIdx = Math.floor((lon + 180) / gridCellSizeDeg);
  const densityKey = `${latIdx},${lonIdx}`;
  const existing = densityMap.get(densityKey);

  if (existing) {
    existing.count += 1;
  } else {
    densityMap.set(densityKey, { count: 1, latIdx, lonIdx });
  }
}

async function computeCollisionDensity(
  items: DensityWorkerInput[],
  options?: DensityWorkerOptions
): Promise<DensityResult> {
  const voxelSizeKm = options?.voxelSizeKm ?? 50;
  const detectionRadiusKm = options?.detectionRadiusKm ?? 75;
  const gridCellSizeDeg = options?.gridCellSizeDeg ?? 2;
  const maxPairs = options?.maxPairs ?? 50;

  if (!items || !items.length) {
    return {
      densityCells: [],
      candidatePairs: [],
      stats: {
        totalSatellites: 0,
        totalCells: 0,
        maxCellCount: 0,
        totalCandidatePairs: 0,
        displayedCandidatePairs: 0,
        closeApproachSatelliteCount: 0,
        maxSatelliteDensity: 0,
        maxRawSatelliteDensity: 0,
        detectionRadiusKm,
        voxelSizeKm,
        gridCellSizeDeg,
      },
      generatedAt: new Date().toISOString(),
    };
  }

  type VoxelSat = DensityWorkerInput & {
    x: number;
    y: number;
    z: number;
  };

  const voxels = new Map<string, VoxelSat[]>();
  const densityMap = new Map<
    string,
    { count: number; latIdx: number; lonIdx: number }
  >();

  // Track per-satellite close-approach counts for density coloring.
  const satDensity = new Map<number, number>();
  const rawSatDensity = new Map<number, number>();
  let maxSatDensity = 0;
  let maxRawSatDensity = 0;

  for (const sat of items) {
    const { x, y, z } = latLonAltToECEF(sat.lat, sat.lon, sat.altKm);
    const key = getVoxelKey(x, y, z, voxelSizeKm);
    const list = voxels.get(key);
    const satRecord: VoxelSat = { ...sat, x, y, z };
    if (list) {
      list.push(satRecord);
    } else {
      voxels.set(key, [satRecord]);
    }
  }

  const candidatePairs: CandidatePair[] = [];

  // Track processed pairs to avoid duplicates
  const processedPairs = new Set<string>();

  for (const [key, satList] of voxels.entries()) {
    const neighborKeys = getNeighborKeys(key);
    for (const sat of satList) {
      for (const neighborKey of neighborKeys) {
        const neighbors = voxels.get(neighborKey);
        if (!neighbors) continue;
        for (const other of neighbors) {
          if (sat.id === other.id) continue;

          const minId = Math.min(sat.id, other.id);
          const maxId = Math.max(sat.id, other.id);
          const pairKey = `${minId},${maxId}`;

          // Skip if already processed
          if (processedPairs.has(pairKey)) continue;

          const dx = sat.x - other.x;
          const dy = sat.y - other.y;
          const dz = sat.z - other.z;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

          if (dist <= detectionRadiusKm && dist > 0.01) {
            // mark processed before counting or pushing pair
            processedPairs.add(pairKey);

            const rawCountA = (rawSatDensity.get(minId) || 0) + 1;
            const rawCountB = (rawSatDensity.get(maxId) || 0) + 1;
            rawSatDensity.set(minId, rawCountA);
            rawSatDensity.set(maxId, rawCountB);
            maxRawSatDensity = Math.max(maxRawSatDensity, rawCountA, rawCountB);

            const satIsMin = sat.id === minId;
            candidatePairs.push({
              idA: minId,
              idB: maxId,
              distanceKm: dist,
              altitudeA: satIsMin ? sat.altKm : other.altKm,
              altitudeB: satIsMin ? other.altKm : sat.altKm,
              operatorA: satIsMin ? sat.operator : other.operator,
              operatorB: satIsMin ? other.operator : sat.operator,
              latA: satIsMin ? sat.lat : other.lat,
              lonA: satIsMin ? sat.lon : other.lon,
              latB: satIsMin ? other.lat : sat.lat,
              lonB: satIsMin ? other.lon : sat.lon,
            });
          }
        }
      }
    }
  }

  // itemsMap from original input (items array)
  const itemsMap = new Map<
    number,
    { name?: string; operator?: string; l1?: string; l2?: string }
  >();
  for (const it of items) {
    itemsMap.set(it.id, {
      name: it.name,
      operator: it.operator,
      l1: it.l1,
      l2: it.l2,
    });
  }

  const filteredCandidatePairs = filterCandidatePairs(
    candidatePairs,
    itemsMap,
    {
      sameLaunchIdDiff: 5,
      relSpeedThresh: 0.001,
      separationThreshKm: 0.05,
      altDiffThreshKm: 1,
      requireVelocityCheck: true,
    }
  );

  const countedHotspotSatellites = new Set<number>();

  for (const pair of filteredCandidatePairs) {
    const newCountA = (satDensity.get(pair.idA) || 0) + 1;
    const newCountB = (satDensity.get(pair.idB) || 0) + 1;
    satDensity.set(pair.idA, newCountA);
    satDensity.set(pair.idB, newCountB);
    maxSatDensity = Math.max(maxSatDensity, newCountA, newCountB);
    incrementHotspotCell(
      densityMap,
      pair.latA,
      pair.lonA,
      gridCellSizeDeg,
      pair.idA,
      countedHotspotSatellites
    );
    incrementHotspotCell(
      densityMap,
      pair.latB,
      pair.lonB,
      gridCellSizeDeg,
      pair.idB,
      countedHotspotSatellites
    );
  }

  filteredCandidatePairs.sort((a, b) => a.distanceKm - b.distanceKm);
  const limitedPairs = filteredCandidatePairs.slice(0, maxPairs);
  const totalCandidatePairs = filteredCandidatePairs.length;

  const densityCells: DensityCell[] = [];
  let maxCellCount = 0;

  for (const { count, latIdx, lonIdx } of densityMap.values()) {
    maxCellCount = Math.max(maxCellCount, count);

    // Calculate cell center with bounds checking to prevent invalid coordinates
    const latCenter = latIdx * gridCellSizeDeg - 90 + gridCellSizeDeg / 2;
    const lonCenter = lonIdx * gridCellSizeDeg - 180 + gridCellSizeDeg / 2;

    // Clamp latitude to valid range [-90, 90]
    const clampedLat = Math.max(-90, Math.min(90, latCenter));

    // Normalize longitude to valid range [-180, 180]
    let normalizedLon = lonCenter;
    while (normalizedLon > 180) normalizedLon -= 360;
    while (normalizedLon < -180) normalizedLon += 360;

    densityCells.push({
      count,
      lat: clampedLat,
      lon: normalizedLon,
    });
  }

  return {
    densityCells,
    candidatePairs: limitedPairs,
    satelliteDensities: Object.fromEntries(satDensity),
    stats: {
      totalSatellites: items.length,
      totalCells: densityCells.length,
      maxCellCount,
      totalCandidatePairs,
      displayedCandidatePairs: limitedPairs.length,
      closeApproachSatelliteCount: satDensity.size,
      maxSatelliteDensity: maxSatDensity,
      maxRawSatelliteDensity: maxRawSatDensity,
      detectionRadiusKm,
      voxelSizeKm,
      gridCellSizeDeg,
    },
    generatedAt: new Date().toISOString(),
  };
}

const api = {
  positionFromTLE,
  tleToLatLonAlt,
  satrecFromTLE,
  batchPositionFromTLE,
  generateGroundTrack,
  generateSatelliteTrack,
  computeCollisionDensity,
};

Comlink.expose(api);
