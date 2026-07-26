import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';

const PARTITION_NAME_PATTERN = /^tle_history_(\d{4})_(\d{2})$/;
const MONTHS_AHEAD = 2; // current month + this many months of forward buffer
const RETENTION_BUFFER_DAYS = 35; // 30-day trend window + safety margin

export function monthRange(
  year: number,
  monthIndex0: number
): { name: string; start: Date; end: Date } {
  const start = new Date(Date.UTC(year, monthIndex0, 1));
  const end = new Date(Date.UTC(year, monthIndex0 + 1, 1));
  const name = `tle_history_${start.getUTCFullYear()}_${String(
    start.getUTCMonth() + 1
  ).padStart(2, '0')}`;
  return { name, start, end };
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10); // 'YYYY-MM-DD'
}

export interface PartitionMaintenanceResult {
  created: string[];
  dropped: string[];
}

export async function ensureUpcomingPartitions(
  now: Date = new Date()
): Promise<string[]> {
  const created: string[] = [];

  for (let i = 0; i <= MONTHS_AHEAD; i++) {
    const { name, start, end } = monthRange(
      now.getUTCFullYear(),
      now.getUTCMonth() + i
    );
    if (!PARTITION_NAME_PATTERN.test(name)) continue;

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ${sql.identifier(name)}
      PARTITION OF tle_history
      FOR VALUES FROM (${sql.raw(`'${isoDate(start)}'`)}) TO (${sql.raw(`'${isoDate(end)}'`)})
    `);
    created.push(name);
  }

  return created;
}

export async function dropStalePartitions(
  now: Date = new Date()
): Promise<string[]> {
  const cutoff = new Date(
    now.getTime() - RETENTION_BUFFER_DAYS * 24 * 60 * 60 * 1000
  );

  // Discover actual partitions rather than assume a fixed list, so this
  // naturally picks up whatever ensureUpcomingPartitions has created over
  // time (including in previous runs of this same job).
  const { rows } = await db.execute<{ relname: string }>(sql`
    SELECT child.relname
    FROM pg_inherits
    JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
    JOIN pg_class child ON pg_inherits.inhrelid = child.oid
    WHERE parent.relname = 'tle_history'
  `);

  const dropped: string[] = [];

  for (const { relname } of rows) {
    const match = relname.match(PARTITION_NAME_PATTERN);
    if (!match) continue; // tle_history_default or anything unexpected -- never touched

    const [, yearStr, monthStr] = match;
    const { end } = monthRange(Number(yearStr), Number(monthStr) - 1);

    if (end <= cutoff) {
      await db.execute(sql`DROP TABLE IF EXISTS ${sql.identifier(relname)}`);
      dropped.push(relname);
    }
  }

  return dropped;
}

export async function runPartitionMaintenance(
  now: Date = new Date()
): Promise<PartitionMaintenanceResult> {
  const created = await ensureUpcomingPartitions(now);
  const dropped = await dropStalePartitions(now);
  return { created, dropped };
}
