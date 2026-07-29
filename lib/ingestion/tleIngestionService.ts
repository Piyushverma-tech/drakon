import redis from '@/lib/redis';
import { parseTleText, serializeTleEntries } from '@/lib/tle';
import { ingestTleHistory } from '@/lib/jobs/ingestTleHistory';
import type { TleEntry } from '@/lib/types';
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
] as const;

// Minimum healthy counts for each static debris group, below which the ingestion cycle will log a warning and skip pruning. These are based on observed counts from CelesTrak, with a generous floor to avoid false positives from transient fetch issues.
const DEBRIS_GROUP_MIN_HEALTHY: Record<
  (typeof STATIC_DEBRIS_GROUPS)[number],
  number
> = {
  'iridium-33-debris': 40, // observed ~110
  'cosmos-2251-debris': 150, // observed ~599
  'fengyun-1c-debris': 500, // observed ~1,915
};

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

    const primaryEntries = parseTleText(primaryResult.raw);

    // Static debris clouds: always CelesTrak, every cycle, ingested and
    // pruning-exempted separately from whatever the primary/fallback fetch
    // returned. Fetched and health-checked ONE GROUP AT A TIME (see
    // DEBRIS_GROUP_MIN_HEALTHY above) -- sequential, not Promise.all, to
    // keep respecting CelesTrak's rate limit the same way a single
    // multi-group call's inter-request delay already does.
    const debrisEntryMap = new Map<number, TleEntry>();
    const debrisGroupCounts: Record<string, number> = {};
    let debrisHealthy = true;

    for (const group of STATIC_DEBRIS_GROUPS) {
      const groupResult = await celestrakProvider.fetch({ groups: [group] });
      const groupEntries = parseTleText(groupResult.raw);
      debrisGroupCounts[group] = groupEntries.length;

      if (groupEntries.length < DEBRIS_GROUP_MIN_HEALTHY[group]) {
        debrisHealthy = false;
        console.warn(
          `[TLE] Debris group ${group} looks unhealthy this cycle: ${groupEntries.length} objects (floor ${DEBRIS_GROUP_MIN_HEALTHY[group]})`
        );
      }

      for (const entry of groupEntries) debrisEntryMap.set(entry.id, entry);
    }

    const debrisEntries = [...debrisEntryMap.values()];
    const debrisIds = new Set(debrisEntryMap.keys());

    const existingRaw = normalizeNewlines(
      (await redis.get<string>(CACHE_KEY)) ?? ''
    );
    const snapshotMap = new Map(
      parseTleText(existingRaw).map((e) => [e.id, e])
    );

    // Pruning eligibility. A full resync may only prune when ALL of these
    // hold:
    //  - doFullResync: enough time has passed since the last authoritative sweep
    //  - primaryProviderUsed === 'spacetrack': only Space-Track's broader
    //    catalog is authoritative enough to treat "missing from this
    //    fetch" as "actually gone" — NOT just "whatever is currently
    //    configured as primary", so an intentional TLE_PROVIDER=celestrak
    //    flip (e.g. incident response) can never prune Space-Track-only
    //    objects using CelesTrak's narrower `active` curation as if it
    //    were ground truth.
    //  - !usedFallback: an unplanned fallback this cycle is exactly as
    //    untrustworthy for pruning as a deliberate CelesTrak-primary
    //    config would be.
    //  - debrisHealthy: EVERY static debris group must individually clear
    //    its own floor this cycle — a degraded/partial fetch of any one of
    //    them must not cause its real members to fall out of both the
    //    fresh-fetch set and the exemption set simultaneously. Checked per
    //    group in the fetch loop above, since a combined total can't tell "one group returned nothing" apart from
    //    "all groups came back a little light".
    const canPrune =
      doFullResync &&
      primaryProviderUsed === 'spacetrack' &&
      !usedFallback &&
      debrisHealthy;

    if (doFullResync && !canPrune) {
      console.warn(
        '[TLE] Full resync was due but skipped this cycle (not eligible to prune):',
        {
          primaryProviderUsed,
          usedFallback,
          debrisHealthy,
          debrisGroupCounts,
        }
      );
    }

    if (canPrune) {
      const freshIds = new Set(primaryEntries.map((e) => e.id));
      for (const [id] of snapshotMap) {
        if (!debrisIds.has(id) && !freshIds.has(id)) snapshotMap.delete(id);
      }
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

    if (canPrune) {
      await redis.set(LAST_FULL_RESYNC_KEY, new Date().toISOString());
    }

    const summary: IngestionCycleSummary = {
      skipped: false,
      provider: usedFallback
        ? `${fallback.name} (fallback)`
        : primaryProviderUsed,
      fullResync: canPrune,
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
