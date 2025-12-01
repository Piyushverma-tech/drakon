import * as Comlink from 'comlink';
import * as satellite from 'satellite.js';

export type PropagatedPosition = {
  lat: number;
  lon: number;
  altKm: number;
};

type DensityWorkerInput = {
  id: number;
  lat: number;
  lon: number;
  altKm: number;
  operator?: string;
};

type DensityWorkerOptions = {
  voxelSizeKm?: number;
  detectionRadiusKm?: number;
  gridCellSizeDeg?: number;
  maxPairs?: number;
};

type DensityCell = {
  lat: number;
  lon: number;
  count: number;
};

type CandidatePair = {
  idA: number;
  idB: number;
  distanceKm: number;
  altitudeA: number;
  altitudeB: number;
  operatorA?: string;
  operatorB?: string;
  latA: number;
  lonA: number;
  latB: number;
  lonB: number;
};

type DensityResult = {
  densityCells: DensityCell[];
  candidatePairs: CandidatePair[];
  stats: {
    totalSatellites: number;
    totalCells: number;
    maxCellCount: number;
    detectionRadiusKm: number;
    voxelSizeKm: number;
    gridCellSizeDeg: number;
  };
  generatedAt: string;
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

function getNeighborKeys(
  baseKey: string,
  voxelSize: number
): string[] {
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

    const latIdx = Math.floor((sat.lat + 90) / gridCellSizeDeg);
    const lonIdx = Math.floor((sat.lon + 180) / gridCellSizeDeg);
    const densityKey = `${latIdx},${lonIdx}`;
    const existing = densityMap.get(densityKey);
    if (existing) {
      existing.count += 1;
    } else {
      densityMap.set(densityKey, { count: 1, latIdx, lonIdx });
    }
  }

  const candidatePairs: CandidatePair[] = [];

  // Track processed pairs to avoid duplicates
  const processedPairs = new Set<string>();

  for (const [key, satList] of voxels.entries()) {
    const neighborKeys = getNeighborKeys(key, voxelSizeKm);
    for (const sat of satList) {
      for (const neighborKey of neighborKeys) {
        const neighbors = voxels.get(neighborKey);
        if (!neighbors) continue;
        for (const other of neighbors) {
          // Use consistent pair ordering (min, max) for duplicate tracking
          const minId = Math.min(sat.id, other.id);
          const maxId = Math.max(sat.id, other.id);
          
          // Skip if we've already processed this pair (ensures consistent ordering)
          const pairKey = `${minId},${maxId}`;
          if (processedPairs.has(pairKey)) continue;
          
          // Mark as processed before calculating distance to prevent duplicate processing
          processedPairs.add(pairKey);

          const dx = sat.x - other.x;
          const dy = sat.y - other.y;
          const dz = sat.z - other.z;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          
          // Only include pairs within detection radius and with meaningful distance (> 0.01 km)
          if (dist <= detectionRadiusKm && dist > 0.01) {
            // Use consistent ordering (minId, maxId) for pair representation
            // Determine which satellite corresponds to minId and maxId
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

  candidatePairs.sort((a, b) => a.distanceKm - b.distanceKm);
  const limitedPairs = candidatePairs.slice(0, maxPairs);

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
    stats: {
      totalSatellites: items.length,
      totalCells: densityCells.length,
      maxCellCount,
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
  computeCollisionDensity,
};

Comlink.expose(api);
