import { decodeAlpha5CatalogNumber } from './alpha5';
import { parseTLEMeta } from './satelliteHelpers';
import type { TleEntry } from './types';

export function isDebrisLikeName(name: string): boolean {
  const lowerName = name.toLowerCase();
  return (
    lowerName.includes('deb') ||
    lowerName.includes('r/b') ||
    lowerName.includes('rkt') ||
    lowerName.includes('rocket') ||
    lowerName.includes('platform')
  );
}

export function classifyObjectType(
  name: string
): 'debris' | 'rocket_body' | 'payload' | 'unknown' {
  const lowerName = name.toLowerCase();
  if (lowerName.includes('deb')) return 'debris';
  if (
    lowerName.includes('r/b') ||
    lowerName.includes('rkt') ||
    lowerName.includes('rocket')
  ) {
    return 'rocket_body';
  }
  if (!name.trim()) return 'unknown';
  return 'payload';
}

export function parseTleText(tleText: string): TleEntry[] {
  const lines = tleText.split(/\r?\n/).filter(Boolean);
  const entries: TleEntry[] = [];

  for (let i = 0; i + 2 < lines.length; i += 3) {
    const rawNameLine = lines[i].trim();
    // Space-Track's  format/3le includes  "0 " line-type
    // marker on name (matching "1 "/"2 " on the element lines); CelesTrak's FORMAT=3le omits it.
    const name = rawNameLine.startsWith('0 ')
      ? rawNameLine.slice(2).trim()
      : rawNameLine;
    const l1 = lines[i + 1];
    const l2 = lines[i + 2];

    if (!l1.startsWith('1 ') || !l2.startsWith('2 ')) continue;

    const id = decodeAlpha5CatalogNumber(l1.substring(2, 7));
    if (id === null) continue;

    entries.push({
      id,
      name,
      operator: name.split('-')[0],
      l1,
      l2,
      ...parseTLEMeta(l1, l2),
      isDebris: isDebrisLikeName(name),
    });
  }

  return entries;
}

/** Inverse of parseTleText — used by the ingestion service to write a
 * merged Map<id, TleEntry> snapshot back to the 3-line TLE text the Redis
 * cache and every downstream consumer expect. */
export function serializeTleEntries(entries: TleEntry[]): string {
  return entries.map((e) => `${e.name}\n${e.l1}\n${e.l2}`).join('\n') + '\n';
}
