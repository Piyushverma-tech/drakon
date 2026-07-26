import redis from '@/lib/redis';
import { parseTleText, serializeTleEntries } from '@/lib/tle';
import { ingestTleHistory } from '@/lib/jobs/ingestTleHistory';
import {
  celestrakProvider,
  getPrimaryProvider,
  getFallbackProvider,
  type ProviderName,
  type TleFetchResult,
} from '@/lib/tle-providers';
import {
  CACHE_KEY,
  STALE_CACHE_KEY,
  CACHE_TTL_SECONDS,
  normalizeNewlines,
} from '../tleCache';

const LAST_FULL_RESYNC_KEY = 'tle:last_full_resync';
const FULL_RESYNC_INTERVAL_MS = 24 * 60 * 60 * 1000; // once a day
const LOCK_KEY = 'tle:ingestion:lock';
const LOCK_TTL_SECONDS = 120; // generous vs. an expected ~5-15s cycle
const STATIC_DEBRIS_GROUPS = [
  'iridium-33-debris',
  'cosmos-2251-debris',
  'fengyun-1c-debris',
];

export interface IngestionCycleSummary {
  skipped: false;
  provider: string;
  fullResync: boolean;
  snapshotSize: number;
  inserted: number;
  skippedRows: number;
  invalid: number;
}

export type IngestionCycleResult = { skipped: true } | IngestionCycleSummary;

async function needsFullResync(): Promise<boolean> {
  const last = await redis.get<string>(LAST_FULL_RESYNC_KEY);
  return (
    !last || Date.now() - new Date(last).getTime() > FULL_RESYNC_INTERVAL_MS
  );
}

/**
 * One ingestion cycle: fetch from the primary provider (falling back to
 * CelesTrak on failure), always fetch the three static debris clouds from
 * CelesTrak separately, merge everything into the existing Redis snapshot,
 * and write history rows per-source so provenance stays accurate.
 */
export async function runIngestionCycle(): Promise<IngestionCycleResult> {
  // Prevent two overlapping triggers from racing on the read-modify-write
  // merge below (e.g. a manual trigger overlapping the scheduled one).
  const acquired = await redis.set(LOCK_KEY, '1', {
    nx: true,
    ex: LOCK_TTL_SECONDS,
  });
  if (!acquired) {
    console.warn('[TLE] Ingestion already in progress, skipping this trigger');
    return { skipped: true };
  }

  try {
    const primary = getPrimaryProvider();
    const fallback = getFallbackProvider();
    const doFullResync = await needsFullResync();

    let primaryResult: TleFetchResult;
    let primaryProviderUsed: ProviderName;
    let usedFallback = false;

    try {
      primaryResult = await primary.fetch({ fullResync: doFullResync });
      primaryProviderUsed = primary.name;
    } catch (err) {
      console.warn(
        `[TLE] Primary provider (${primary.name}) failed, falling back:`,
        err
      );
      primaryResult = await fallback.fetch({ groups: ['active'] });
      primaryProviderUsed = fallback.name;
      usedFallback = true;
    }

    // Static debris clouds: always CelesTrak, every cycle, ingested and
    // pruning-exempted separately from whatever the primary/fallback fetch returned.
    const debrisResult = await celestrakProvider.fetch({
      groups: STATIC_DEBRIS_GROUPS,
    });

    const primaryEntries = parseTleText(primaryResult.raw);
    const debrisEntries = parseTleText(debrisResult.raw);

    const debrisIds = new Set(debrisEntries.map((e) => e.id));

    const existingRaw = normalizeNewlines(
      (await redis.get<string>(CACHE_KEY)) ?? ''
    );
    const snapshotMap = new Map(
      parseTleText(existingRaw).map((e) => [e.id, e])
    );

    if (doFullResync && !usedFallback) {
      // Only an authoritative Space-Track sweep can drop objects
      const freshIds = new Set(primaryEntries.map((e) => e.id));
      for (const [id] of snapshotMap) {
        if (!debrisIds.has(id) && !freshIds.has(id)) snapshotMap.delete(id);
      }
      await redis.set(LAST_FULL_RESYNC_KEY, new Date().toISOString());
    }
    for (const entry of [...primaryEntries, ...debrisEntries]) {
      // Every path — windowed, resync, or fallback — merges what it fetched;
      // it never replaces the snapshot outright.
      snapshotMap.set(entry.id, entry);
    }

    const mergedRaw = serializeTleEntries([...snapshotMap.values()]);
    await redis.set(CACHE_KEY, mergedRaw, { ex: CACHE_TTL_SECONDS });
    await redis.set(STALE_CACHE_KEY, mergedRaw);

    // Ingest each source separately so tle_history.source_group stays
    // accurate per row — combining them into one array before calling
    // ingestTleHistory would mislabel every debris row with whichever
    // provider name was passed for the batch.
    const primaryIngest = await ingestTleHistory(
      primaryEntries,
      primaryProviderUsed
    );
    const debrisIngest = await ingestTleHistory(
      debrisEntries,
      'celestrak:debris'
    );

    const summary: IngestionCycleSummary = {
      skipped: false,
      provider: usedFallback
        ? `${fallback.name} (fallback)`
        : primaryProviderUsed,
      fullResync: doFullResync && !usedFallback,
      snapshotSize: snapshotMap.size,
      inserted: primaryIngest.inserted + debrisIngest.inserted,
      skippedRows: primaryIngest.skipped + debrisIngest.skipped,
      invalid: primaryIngest.invalid + debrisIngest.invalid,
    };

    console.log('[TLE] Ingestion cycle:', summary);
    return summary;
  } finally {
    await redis.del(LOCK_KEY);
  }
}
