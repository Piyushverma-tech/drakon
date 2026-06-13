import { db } from '@/lib/db';
import { tleHistory, tleArchive, trendJobs } from '@/lib/db/schema';
import { parseBSTAR } from '@/lib/satelliteHelpers';
import type { TleEntry } from '@/lib/types';

const CHUNK_SIZE = 500;

export async function ingestTleHistory(
  entries: TleEntry[],
  sourceGroup: string
): Promise<{ inserted: number; skipped: number; invalid: number }> {
  let inserted = 0;
  let skipped = 0;
  let invalid = 0;
  const newNoradIds = new Set<number>();

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
    insertedIds.forEach((id) => newNoradIds.add(id));
    inserted += insertedIds.length;
    skipped += validChunk.length - insertedIds.length;

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
  }

  // ── Enqueue trend jobs for updated objects ───────────────────────────────
  // One job per unique NORAD ID that received a new epoch.
  // Skip if already a pending job for this NORAD ID (prevents pile-up).
  if (newNoradIds.size > 0) {
    const jobRows = [...newNoradIds].map((id) => ({ noradId: id }));

    await db.insert(trendJobs).values(jobRows).onConflictDoNothing(); // if pending job exists, leave it
    // Note: add UNIQUE(norad_id) WHERE status='pending' as a partial unique
    // index in migration to make this work correctly
  }

  return { inserted, skipped, invalid };
}
