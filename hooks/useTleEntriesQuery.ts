'use client';

import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { parseTleText } from '@/lib/tle';
import { DEFAULT_SOLAR_FLUX_MULTIPLIER } from '@/lib/solarFlux';
import type { TleEntry } from '@/lib/types';

export type TleEntriesQueryData = {
  entries: TleEntry[];
  f107: number | null;
  solarFluxMultiplier: number;
};

function parseSolarFluxHeaders(headers: Record<string, unknown>): {
  f107: number | null;
  solarFluxMultiplier: number;
} {
  const f107Raw = headers['x-f107'];
  const multiplierRaw = headers['x-solar-flux-multiplier'];
  const f107 =
    typeof f107Raw === 'string' && Number.isFinite(Number(f107Raw))
      ? Number(f107Raw)
      : null;
  const solarFluxMultiplier =
    typeof multiplierRaw === 'string' && Number.isFinite(Number(multiplierRaw))
      ? Number(multiplierRaw)
      : DEFAULT_SOLAR_FLUX_MULTIPLIER;

  return { f107, solarFluxMultiplier };
}

async function fetchTleEntries(): Promise<TleEntriesQueryData> {
  try {
    const response = await axios.get('/api/tle', { responseType: 'text' });
    const { f107, solarFluxMultiplier } = parseSolarFluxHeaders(
      response.headers as Record<string, unknown>
    );

    return {
      entries: parseTleText(response.data),
      f107,
      solarFluxMultiplier,
    };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const data = error.response?.data;
      let message: string | undefined;

      if (typeof data === 'string') {
        try {
          const parsed = JSON.parse(data) as { error?: unknown };
          message =
            typeof parsed.error === 'string' ? parsed.error : undefined;
        } catch {
          message = data.trim() || undefined;
        }
      } else if (
        data &&
        typeof data === 'object' &&
        'error' in data &&
        typeof data.error === 'string'
      ) {
        message = data.error;
      }

      throw new Error(message ?? 'Unable to load satellite data right now.');
    }

    throw error;
  }
}

export function useTleEntriesQuery() {
  return useQuery({
    queryKey: ['tle-entries'],
    queryFn: fetchTleEntries,
    staleTime: 2 * 60 * 60 * 1000, // 2 hours to match redis cache TTL
    gcTime: 4 * 60 * 60 * 1000, // 4 hours to keep old data around for a while
    refetchOnWindowFocus: false,
  });
}
