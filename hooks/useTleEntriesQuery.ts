'use client';

import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { parseTleText } from '@/lib/tle';
import type { TleEntry } from '@/lib/types';

async function fetchTleEntries(): Promise<TleEntry[]> {
  try {
    const response = await axios.get('/api/tle', { responseType: 'text' });
    return parseTleText(response.data);
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
