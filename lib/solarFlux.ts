import redis from './redis';

export const SOLAR_F107_REDIS_KEY = 'solar:f107';
export const SOLAR_F107_TTL_SECONDS = 86400;

/** Flux the BSTAR / altitude decay formulas were calibrated against. */
export const F107_CALIBRATION = 200;

/** Legacy reference used when solar flux was hardcoded at calibration flux. */
export const F107_LEGACY_REFERENCE = 150;

/**
 * Drag screening used a fixed (200/150)^1.5 boost before live NOAA input.
 * Preserve that baseline at F107_CALIBRATION while allowing modest variation.
 */
export const CALIBRATION_MULTIPLIER = Math.pow(
  F107_CALIBRATION / F107_LEGACY_REFERENCE,
  1.5
);

/**
 * Thermospheric density scales sub-linearly with F10.7 for screening.
 * A 1.5 exponent over-penalizes observed flux (~125 sfu) vs the calibrated 200.
 */
export const F107_FLUX_EXPONENT = 0.3;

export const NOAA_F107_DAILY_URL =
  'https://services.swpc.noaa.gov/json/f107_cm_flux.json';

const DEFAULT_F107 = Number(process.env.NEXT_PUBLIC_F107 ?? String(F107_CALIBRATION));

type DailyF107Entry = {
  time_tag: string;
  flux: number;
  reporting_schedule?: string | null;
  ninety_day_mean?: number | null;
};

export const DEFAULT_SOLAR_FLUX_MULTIPLIER =
  solarFluxMultiplierFromF107(DEFAULT_F107);

/** Density multiplier from NOAA F10.7 (sfu). */
export function solarFluxMultiplierFromF107(f107: number): number {
  if (!Number.isFinite(f107) || f107 <= 50) {
    return CALIBRATION_MULTIPLIER;
  }
  return (
    CALIBRATION_MULTIPLIER *
    Math.pow(f107 / F107_CALIBRATION, F107_FLUX_EXPONENT)
  );
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

/** Prefer the official daily noon observation; fall back to the newest reading. */
export function pickDailyF107(data: DailyF107Entry[]): number | null {
  if (data.length === 0) return null;

  const noon =
    data.find((entry) => entry.reporting_schedule === 'Noon') ?? data[0];
  const f107 = noon?.flux;

  if (!f107 || !Number.isFinite(f107) || f107 <= 50) return null;
  return f107;
}

export async function fetchNoaaF107(): Promise<number | null> {
  const res = await fetch(NOAA_F107_DAILY_URL, { cache: 'no-store' });
  if (!res.ok) return null;

  const data = (await res.json()) as DailyF107Entry[];
  return pickDailyF107(data);
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
