'use client';

import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { parseTLEMeta } from '@/lib/satelliteHelpers';
import type { TleEntry } from '@/lib/types';

function parseTleText(tleText: string): TleEntry[] {
  const lines = tleText.split(/\r?\n/).filter(Boolean);
  const allEntries: TleEntry[] = [];

  for (let i = 0; i + 2 < lines.length; i += 3) {
    const name = lines[i].trim();
    const l1 = lines[i + 1];
    const l2 = lines[i + 2];

    if (!l1.startsWith('1 ') || !l2.startsWith('2 ')) continue;

    const id = Number(l1.substring(2, 7));
    if (!Number.isFinite(id)) continue;

    const lowerName = name.toLowerCase();
    const isDebris =
      lowerName.includes('deb') || // catches "DEB", "DEBRIS", "DEBRI"
      lowerName.includes('r/b') || // rocket bodies
      lowerName.includes('rkt') || // some older catalog names
      lowerName.includes('rocket') ||
      lowerName.includes('platform'); // defunct platforms

    allEntries.push({
      id,
      name,
      operator: name.split('-')[0],
      l1,
      l2,
      ...parseTLEMeta(l1, l2),
      isDebris,
    });
  }

  return allEntries;
}

async function fetchTleEntries(): Promise<TleEntry[]> {
  const response = await axios.get('/api/tle', { responseType: 'text' });
  return parseTleText(response.data);
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
