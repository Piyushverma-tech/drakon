import { db } from '@/lib/db';
import { tleHistory, tleArchive, trendJobs } from '@/lib/db/schema';
import { parseBSTAR } from '@/lib/satelliteHelpers';
import type { TleEntry } from '@/lib/types';
import { and, eq, inArray } from 'drizzle-orm';

const CHUNK_SIZE = 500;

export async function ingestTleHistory(
  entries: TleEntry[],
  sourceGroup: string
): Promise<{ inserted: number; skipped: number; invalid: number }> {
  let inserted = 0;
  let skipped = 0;
  let invalid = 0;

  for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
    const chunk = entries.slice(i, i + CHUNK_SIZE);

    // ── Write parsed parameters to tle_history ──────────────────────────────
    const validChunk = chunk.filter((entry) => {
      const epoch = new Date(entry.tleEpoch);
      const valid =
        Number.isFinite(epoch.getTime()) &&
        Number.isFinite(entry.meanMotion) &&
        entry.meanMotion > 0;
      if (!valid) invalid += 1;
      return valid;
    });

    if (!validChunk.length) continue;

    const historyRows = validChunk.map((e) => ({
      noradId: e.id,
      epoch: new Date(e.tleEpoch),
      bstar: parseBSTAR(e.l1),
      meanMotion: e.meanMotion,
      meanMotionDot: e.meanMotionDot,
      eccentricity: e.ecc,
      inclination: e.inclination,
      raan: e.raan,
      argPerigee: e.argPerigee,
      meanAnomaly: e.meanAnomaly,
      perigeeKm: e.perigeeKm,
      apogeeKm: e.apogeeKm,
      semiMajorAxisKm: e.semiMajorAxisKm,
      sourceGroup,
    }));

    const historyResult = await db
      .insert(tleHistory)
      .values(historyRows)
      .onConflictDoNothing() // (norad_id, epoch) already exists
      .returning({ noradId: tleHistory.noradId });

    const insertedIds = historyResult.map((r) => r.noradId);

    // ── Write raw TLE lines to tle_archive ───────────────────────────────────
    // Only for rows that were actually new (don't re-archive known epochs)
    const insertedSet = new Set(insertedIds);
    const archiveRows = validChunk
      .filter((e) => insertedSet.has(e.id))
      .map((e) => ({
        noradId: e.id,
        epoch: new Date(e.tleEpoch),
        name: e.name,
        tleLine1: e.l1,
        tleLine2: e.l2,
      }));

    if (archiveRows.length > 0) {
      await db.insert(tleArchive).values(archiveRows).onConflictDoNothing();
    }

    // ── Enqueue trend jobs for this chunk only ──────────────────────────────
    if (insertedIds.length > 0) {
      const jobRows = insertedIds.map((id) => ({ noradId: id }));
      await db.insert(trendJobs).values(jobRows).onConflictDoNothing();
    }

    // Priority requeue: force re-trend any object currently below 250km
    // regardless of whether this epoch was new, so DB stays fresh for terminal objects
    const terminalChunk = validChunk.filter((e) => e.perigeeKm < 250);
    if (terminalChunk.length > 0) {
      // Delete existing pending jobs for these objects first
      const terminalNoradIds = terminalChunk.map((e) => e.id);
      await db
        .delete(trendJobs)
        .where(
          and(
            inArray(trendJobs.noradId, terminalNoradIds),
            eq(trendJobs.status, 'pending')
          )
        );
      await db
        .insert(trendJobs)
        .values(terminalChunk.map((e) => ({ noradId: e.id })))
        .onConflictDoNothing();
    }

    inserted += insertedIds.length;
    skipped += validChunk.length - insertedIds.length;
  }

  return { inserted, skipped, invalid };
}
