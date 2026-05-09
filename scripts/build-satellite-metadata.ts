import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import Papa from 'papaparse';
import type { SatelliteMetadata } from '../lib/types';

const UCS_URL = 'https://www.ucs.org/media/11493';
const SATCAT_URL = 'https://celestrak.org/pub/satcat.csv';

const OUTPUT_PATH = path.join(
  process.cwd(),
  'public',
  'satellite-metadata.json'
);

type CsvRow = Record<string, string | number | null | undefined>;

type UcsRow = CsvRow;
type SatcatRow = CsvRow;

// field normalization helpers --------------------------------------

function cleanString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;

  const text = String(value).trim();

  if (!text || text === '-' || text.toLowerCase() === 'n/a') {
    return undefined;
  }

  return text;
}

function parseNumber(value: unknown): number | undefined {
  const text = cleanString(value);

  if (!text) return undefined;

  const normalized = text.replace(/,/g, '');
  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseNoradId(value: unknown): number | undefined {
  const text = cleanString(value);

  if (!text) return undefined;

  const digits = text.replace(/^0+/, '');
  const parsed = Number(digits);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseIsoDate(value: unknown): string | undefined {
  const text = cleanString(value);

  if (!text) return undefined;

  // Already ISO-like.
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }

  const parsed = new Date(text);

  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return parsed.toISOString().slice(0, 10);
}

function getField(row: CsvRow, candidates: string[]): string | undefined {
  for (const candidate of candidates) {
    const exact = cleanString(row[candidate]);

    if (exact) return exact;
  }

  const normalizedEntries = Object.entries(row).map(
    ([key, value]) => [normalizeHeader(key), value] as const
  );

  for (const candidate of candidates) {
    const normalizedCandidate = normalizeHeader(candidate);
    const match = normalizedEntries.find(
      ([normalizedKey]) => normalizedKey === normalizedCandidate
    );

    const value = cleanString(match?.[1]);

    if (value) return value;
  }

  return undefined;
}

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// object-type normalization------------------------------

function normalizeObjectType(
  value: unknown
): SatelliteMetadata['objectType'] | undefined {
  const text = cleanString(value)?.toUpperCase();

  if (!text) return undefined;

  if (text.includes('PAYLOAD') || text === 'PAY') return 'PAYLOAD';
  if (text.includes('ROCKET')) return 'ROCKET BODY';
  if (text.includes('DEBRIS') || text === 'DEB') return 'DEBRIS';
  if (text.includes('UNKNOWN') || text === 'UNK' || text === 'TBA') {
    return 'UNKNOWN';
  }

  return 'UNKNOWN';
}

// CSV download and parse helpers --------------------------------------

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      accept: 'text/csv,text/plain,*/*',
      'user-agent': 'drakon-satellite-metadata-build/1.0',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  const text = await response.text();

  if (!text.trim()) {
    throw new Error(`Fetched empty response from ${url}`);
  }

  return text;
}

function assertLooksLikeData(text: string, sourceName: string) {
  const sample = text.slice(0, 500).toLowerCase();

  if (sample.includes('<!doctype html') || sample.includes('<html')) {
    throw new Error(
      `${sourceName} download returned HTML instead of a data file. Check the source URL.`
    );
  }

  if (text.includes('[Content_Types].xml')) {
    throw new Error(
      `${sourceName} download is an Excel .xlsx file, not CSV/TSV text. Use the text-format URL instead.`
    );
  }
}

function parseCsv<T extends CsvRow>(
  csv: string,
  sourceName: string,
  config: Papa.ParseConfig<T> = {}
): T[] {
  const result = Papa.parse<T>(csv, {
    header: true,
    skipEmptyLines: 'greedy',
    ...config,
  });

  if (result.errors.length > 0) {
    const preview = result.errors
      .slice(0, 5)
      .map((error) => `${error.code}: ${error.message}`)
      .join('; ');

    throw new Error(`Failed to parse ${sourceName} CSV: ${preview}`);
  }

  return result.data;
}

// Convert UCS rows to metadata records --------------------------------------

function metadataFromUcs(row: UcsRow): SatelliteMetadata | null {
  const noradId = parseNoradId(
    getField(row, ['NORAD Number', 'NORAD', 'NORAD ID', 'NORAD_CAT_ID'])
  );

  if (!noradId) return null;

  const massKg = parseNumber(
    getField(row, [
      'Dry Mass (kg.)',
      'Dry Mass (kg)',
      'Mass (kg)',
      'Launch Mass (kg.)',
    ])
  );

  return {
    noradId,
    name: getField(row, [
      'Current Official Name of Satellite',
      'Name of Satellite',
      'Satellite Name',
    ]),
    country: getField(row, ['Country of Operator/Owner']),
    operator: getField(row, ['Operator/Owner', 'Operator Owner']),
    userType: getField(row, ['Users', 'User Type']),
    purpose: getField(row, ['Purpose']),
    orbitClass: getField(row, ['Class of Orbit']),
    launchDate: parseIsoDate(getField(row, ['Date of Launch', 'Launch Date'])),
    launchSite: getField(row, ['Launch Site']),
    launchVehicle: getField(row, ['Launch Vehicle']),
    massKg,
    source: 'ucs',
  };
}

// Convert SATCAT rows to metadata records --------------------------------------

function metadataFromSatcat(row: SatcatRow): SatelliteMetadata | null {
  const noradId = parseNoradId(
    getField(row, ['NORAD_CAT_ID', 'NORAD Number', 'NORAD'])
  );

  if (!noradId) return null;

  const decayDate = parseIsoDate(getField(row, ['DECAY_DATE']));
  if (decayDate) {
    return null;
  }

  return {
    noradId,
    objectName: getField(row, ['OBJECT_NAME']),
    cosparId: getField(row, [
      'OBJECT_ID',
      'INTLDES',
      'International Designator',
    ]),
    objectType: normalizeObjectType(getField(row, ['OBJECT_TYPE'])),
    orbitStatus: getField(row, ['OPS_STATUS_CODE', 'STATUS_CODE']),
    countryCode: getField(row, ['OWNER']),
    launchDate: parseIsoDate(getField(row, ['LAUNCH_DATE'])),
    launchSite: getField(row, ['LAUNCH_SITE']),
    decayDate: decayDate ?? null,
    periodMinutes: parseNumber(getField(row, ['PERIOD'])),
    inclination: parseNumber(getField(row, ['INCLINATION'])),
    apogeeKm: parseNumber(getField(row, ['APOGEE'])),
    perigeeKm: parseNumber(getField(row, ['PERIGEE'])),
    source: 'satcat',
  };
}

// Merge UCS and SATCAT records --------------------------------------

function mergeMetadata(
  ucsMap: Map<number, SatelliteMetadata>,
  satcatMap: Map<number, SatelliteMetadata>
): Record<string, SatelliteMetadata> {
  const merged: Record<string, SatelliteMetadata> = {};
  const allNoradIds = new Set<number>([...ucsMap.keys(), ...satcatMap.keys()]);

  for (const noradId of [...allNoradIds].sort((a, b) => a - b)) {
    const ucs = ucsMap.get(noradId);
    const satcat = satcatMap.get(noradId);

    if (ucs && satcat) {
      merged[String(noradId)] = {
        ...satcat,
        ...ucs,

        // Keep SATCAT-only fields even when UCS exists.
        objectName: satcat.objectName,
        cosparId: satcat.cosparId,
        objectType: satcat.objectType,
        orbitStatus: satcat.orbitStatus,
        countryCode: satcat.countryCode,
        decayDate: satcat.decayDate,
        periodMinutes: satcat.periodMinutes,
        inclination: satcat.inclination,
        apogeeKm: satcat.apogeeKm,
        perigeeKm: satcat.perigeeKm,

        // Prefer UCS launch fields, but allow SATCAT fallback.
        launchDate: ucs.launchDate ?? satcat.launchDate,
        launchSite: ucs.launchSite ?? satcat.launchSite,

        source: 'ucs+satcat',
      };
      continue;
    }

    if (ucs) {
      merged[String(noradId)] = {
        ...ucs,
        source: 'ucs',
      };
      continue;
    }

    if (satcat) {
      merged[String(noradId)] = {
        ...satcat,
        source: 'satcat',
      };
    }
  }

  return merged;
}

// index-building helper

function buildMap(
  rows: CsvRow[],
  converter: (row: CsvRow) => SatelliteMetadata | null
): Map<number, SatelliteMetadata> {
  const map = new Map<number, SatelliteMetadata>();

  for (const row of rows) {
    const metadata = converter(row);

    if (!metadata) continue;

    map.set(metadata.noradId, metadata);
  }

  return map;
}

function trimSatcatOnly(metadata: SatelliteMetadata): SatelliteMetadata {
  if (metadata.source !== 'satcat') return metadata;

  return {
    noradId: metadata.noradId,
    objectName: metadata.objectName,
    cosparId: metadata.cosparId,
    objectType: metadata.objectType,
    orbitStatus: metadata.orbitStatus,
    countryCode: metadata.countryCode,
    launchDate: metadata.launchDate,
    launchSite: metadata.launchSite,
    decayDate: metadata.decayDate,
    periodMinutes: metadata.periodMinutes,
    apogeeKm: metadata.apogeeKm,
    perigeeKm: metadata.perigeeKm,
    source: metadata.source,
  };
}

// Main script function --------------------------------------

async function main() {
  console.log('[metadata] Fetching UCS satellite database...');
  const ucsCsv = await fetchText(UCS_URL);
  assertLooksLikeData(ucsCsv, 'UCS');

  console.log('[metadata] Fetching CelesTrak SATCAT...');
  const satcatCsv = await fetchText(SATCAT_URL);
  assertLooksLikeData(satcatCsv, 'CelesTrak SATCAT');

  console.log('[metadata] Parsing CSV files...');

  const ucsRows = parseCsv<UcsRow>(ucsCsv, 'UCS', {
    delimiter: '\t',

    // UCS text export can contain unescaped quotes inside fields.
    // Treat quotes as normal characters instead of CSV quote markers.
    quoteChar: '\0',
  });
  const satcatRows = parseCsv<SatcatRow>(satcatCsv, 'CelesTrak SATCAT');

  console.log(`[metadata] UCS rows: ${ucsRows.length.toLocaleString()}`);
  console.log(`[metadata] SATCAT rows: ${satcatRows.length.toLocaleString()}`);

  const ucsMap = buildMap(ucsRows, metadataFromUcs);
  const satcatMap = buildMap(satcatRows, metadataFromSatcat);

  console.log(`[metadata] UCS indexed: ${ucsMap.size.toLocaleString()}`);
  console.log(`[metadata] SATCAT indexed: ${satcatMap.size.toLocaleString()}`);

  const merged = mergeMetadata(ucsMap, satcatMap);
  const mergedCount = Object.keys(merged).length;

  console.log(`[metadata] Merged records: ${mergedCount.toLocaleString()}`);

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });

  const compactMerged = Object.fromEntries(
    Object.entries(merged).map(([id, metadata]) => [
      id,
      trimSatcatOnly(metadata),
    ])
  );

  await writeFile(OUTPUT_PATH, `${JSON.stringify(compactMerged)}\n`, 'utf8');

  const ucsOnlyCount = Object.values(merged).filter(
    (item) => item.source === 'ucs'
  ).length;
  const ucsSatcatCount = Object.values(merged).filter(
    (item) => item.source === 'ucs+satcat'
  ).length;
  const satcatOnlyCount = Object.values(merged).filter(
    (item) => item.source === 'satcat'
  ).length;

  console.log(`[metadata] Wrote ${OUTPUT_PATH}`);
  console.log(`[metadata] Source breakdown:`);
  console.log(`  - UCS + SATCAT: ${ucsSatcatCount.toLocaleString()}`);
  console.log(`  - UCS only: ${ucsOnlyCount.toLocaleString()}`);
  console.log(`  - SATCAT only: ${satcatOnlyCount.toLocaleString()}`);
}

main().catch((error) => {
  console.error('[metadata] Build failed');
  console.error(error);
  process.exitCode = 1;
});
