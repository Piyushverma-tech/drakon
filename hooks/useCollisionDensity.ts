import { useState, useEffect, useMemo } from 'react';
import {
  computeCollisionDensityAsync,
  DensityResult,
} from '@/lib/satelliteWorker';
import { SatellitePoint } from './useSatellitePositions';

type UseCollisionDensityOptions = {
  showDensity: boolean;
  satellites: SatellitePoint[];
  densityRadiusKm: number;
  debounceMs?: number;
};

export function useCollisionDensity({
  showDensity,
  satellites,
  densityRadiusKm,
  debounceMs = 500,
}: UseCollisionDensityOptions) {
  const [densityResult, setDensityResult] = useState<DensityResult | null>(
    null
  );
  const [densityLoading, setDensityLoading] = useState(false);
  const [densityError, setDensityError] = useState<string | null>(null);

  // Compute density
  useEffect(() => {
    let cancelled = false;
    if (!showDensity || satellites.length === 0) {
      setDensityResult(null);
      setDensityLoading(false);
      setDensityError(null);
      return () => {
        cancelled = true;
      };
    }

    const timer = setTimeout(() => {
      if (cancelled) return;

      setDensityLoading(true);
      setDensityError(null);

      const payload = satellites.map((sat) => ({
        id: sat.id,
        lat: sat.lat,
        lon: sat.lon,
        altKm: sat.alt,
        operator: sat.operator,
        name: sat.name,
        l1: sat.l1,
        l2: sat.l2,
      }));

      const voxelSizeKm = Math.max(densityRadiusKm, 20);
      const gridCellSizeDeg =
        densityRadiusKm >= 150 ? 4 : densityRadiusKm >= 80 ? 3 : 2;

      computeCollisionDensityAsync(payload, {
        detectionRadiusKm: densityRadiusKm,
        voxelSizeKm,
        gridCellSizeDeg,
        maxPairs: 50,
      })
        .then((result) => {
          if (cancelled) return;
          setDensityResult(result);
          setDensityLoading(false);
        })
        .catch((err) => {
          if (cancelled) return;
          console.warn('Collision density worker failed', err);
          setDensityError('Unable to compute density');
          setDensityResult(null);
          setDensityLoading(false);
        });
    }, debounceMs);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [showDensity, satellites, densityRadiusKm, debounceMs]);

  // spatial hash map for density lookup (only used for fallback 2D logic)
  const densityMap = useMemo(() => {
    if (
      !showDensity ||
      !densityResult ||
      densityResult.densityCells.length === 0
    ) {
      return new Map<string, number>();
    }

    // If we have 3D density data, we don't need this 2D map for satellite coloring
    if (densityResult.satelliteDensities) {
      return new Map<string, number>();
    }

    const map = new Map<string, number>();
    const maxCount = densityResult.stats.maxCellCount;
    const cellSizeDeg = densityResult.stats.gridCellSizeDeg || 2;

    for (const cell of densityResult.densityCells) {
      const normalizedDensity = maxCount > 0 ? cell.count / maxCount : 0;
      const latIdx = Math.round(
        (cell.lat + 90 - cellSizeDeg / 2) / cellSizeDeg
      );
      const lonIdx = Math.round(
        (cell.lon + 180 - cellSizeDeg / 2) / cellSizeDeg
      );
      const key = `${latIdx},${lonIdx}`;
      map.set(key, normalizedDensity);
    }

    return map;
  }, [showDensity, densityResult]);

  // Pre-compute satellite densities
  const satelliteDensities = useMemo(() => {
    if (!showDensity || !densityResult) {
      return new Map<number, number>();
    }

    // PREFERRED: Use 3D density from worker if available
    if (densityResult.satelliteDensities) {
      const densities = new Map<number, number>();
      const rawDensities = densityResult.satelliteDensities;
      const maxDensity = densityResult.stats.maxSatelliteDensity || 1;

      for (const [idStr, count] of Object.entries(rawDensities)) {
        const id = Number(idStr);
        const normalized = maxDensity > 0 ? count / maxDensity : 0;
        densities.set(id, normalized);
      }
      return densities;
    }

    // FALLBACK: Use 2D grid lookup
    if (densityMap.size === 0 || satellites.length === 0) {
      return new Map<number, number>();
    }

    const densities = new Map<number, number>();
    const cellSizeDeg = densityResult.stats.gridCellSizeDeg || 2;

    for (const sat of satellites) {
      const latIdx = Math.floor((sat.lat + 90) / cellSizeDeg);
      const lonIdx = Math.floor((sat.lon + 180) / cellSizeDeg);
      const key = `${latIdx},${lonIdx}`;
      const density = densityMap.get(key) || 0;
      densities.set(sat.id, density);
    }

    return densities;
  }, [showDensity, densityMap, satellites, densityResult]);

  return {
    densityResult,
    densityLoading,
    densityError,
    satelliteDensities,
  };
}
