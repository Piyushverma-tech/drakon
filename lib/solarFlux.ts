import redis from './redis';

export const SOLAR_F107_REDIS_KEY = 'solar:f107';
export const SOLAR_F107_TTL_SECONDS = 86400;
export const F107_REFERENCE = 150;
export const NOAA_SOLAR_CYCLE_URL =
  'https://services.swpc.noaa.gov/json/solar-cycle/observed-solar-cycle-indices.json';

const DEFAULT_F107 = Number(process.env.NEXT_PUBLIC_F107 ?? '200');

function multiplierFromValidF107(f107: number): number {
  return Math.pow(f107 / F107_REFERENCE, 1.5);
}

// Fallback: June 2026 solar maximum estimate (~200 sfu → ~1.54×)
export const DEFAULT_SOLAR_FLUX_MULTIPLIER =
  multiplierFromValidF107(DEFAULT_F107);

/** Density multiplier from NOAA F10.7 (sfu); reference 150 ≈ mid-cycle. */
export function solarFluxMultiplierFromF107(f107: number): number {
  if (!Number.isFinite(f107) || f107 <= 50) {
    return DEFAULT_SOLAR_FLUX_MULTIPLIER;
  }
  return multiplierFromValidF107(f107);
}

export async function getSolarFlux(): Promise<{
  f107: number | null;
  multiplier: number;
}> {
  try {
    const f107 = await redis.get<number>(SOLAR_F107_REDIS_KEY);
    if (f107 && Number.isFinite(f107) && f107 > 50) {
      return { f107, multiplier: solarFluxMultiplierFromF107(f107) };
    }
  } catch {
    /* ignore */
  }
  return { f107: null, multiplier: DEFAULT_SOLAR_FLUX_MULTIPLIER };
}

export async function getSolarFluxMultiplier(): Promise<number> {
  const { multiplier } = await getSolarFlux();
  return multiplier;
}

export async function fetchNoaaF107(): Promise<number | null> {
  const res = await fetch(NOAA_SOLAR_CYCLE_URL, { cache: 'no-store' });
  if (!res.ok) return null;

  const data = (await res.json()) as Array<{ 'f10.7': number }>;
  const latest = data[data.length - 1];
  const f107 = latest?.['f10.7'];

  if (!f107 || !Number.isFinite(f107) || f107 <= 50) return null;
  return f107;
}

export async function refreshSolarFluxInRedis(): Promise<{
  f107: number;
  multiplier: number;
} | null> {
  const f107 = await fetchNoaaF107();
  if (f107 === null) return null;

  await redis.set(SOLAR_F107_REDIS_KEY, f107, { ex: SOLAR_F107_TTL_SECONDS });
  return { f107, multiplier: solarFluxMultiplierFromF107(f107) };
}

export async function solarFluxResponseHeaders(): Promise<Record<string, string>> {
  const { f107, multiplier } = await getSolarFlux();
  if (f107 === null) return {};
  return {
    'x-f107': String(f107),
    'x-solar-flux-multiplier': String(multiplier),
  };
}
