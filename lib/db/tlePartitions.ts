import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';

//Todo: Add an advisory lock
const DAILY_PATTERN = /^tle_history_(\d{4})_(\d{2})_(\d{2})$/;
const MONTHLY_PATTERN = /^tle_history_(\d{4})_(\d{2})$/; // legacy -- retires Jul/Aug on the old rule
const FUTURE_PARTITIONS = 7; // days of forward buffer
const RETENTION_BUFFER_DAYS = 35; // unchanged: 30-day trend window + safety margin
const DAILY_CUTOVER_MS = Date.UTC(2026, 8, 1); // Sept 1 -- Aug is already fully owned by tle_history_2026_08

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dayRange(date: Date): { name: string; start: Date; end: Date } {
  const start = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const name = `tle_history_${isoDate(start).replace(/-/g, '_')}`;
  return { name, start, end };
}

function monthRange(
  year: number,
  monthIndex0: number
): { start: Date; end: Date } {
  const start = new Date(Date.UTC(year, monthIndex0, 1));
  const end = new Date(Date.UTC(year, monthIndex0 + 1, 1));
  return { start, end };
}

export interface PartitionMaintenanceResult {
  created: string[];
  dropped: string[];
}

export async function ensureUpcomingPartitions(
  now: Date = new Date()
): Promise<string[]> {
  const created: string[] = [];
  const startDayMs = Math.max(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    DAILY_CUTOVER_MS
  );

  for (let i = 0; i <= FUTURE_PARTITIONS; i++) {
    const day = new Date(startDayMs + i * 24 * 60 * 60 * 1000);
    const { name, start, end } = dayRange(day);

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

  const { rows } = await db.execute<{ relname: string }>(sql`
    SELECT child.relname
    FROM pg_inherits
    JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
    JOIN pg_class child ON pg_inherits.inhrelid = child.oid
    WHERE parent.relname = 'tle_history'
  `);

  const dropped: string[] = [];

  for (const { relname } of rows) {
    let end: Date;

    const daily = relname.match(DAILY_PATTERN);
    if (daily) {
      const [, y, m, d] = daily;
      end = dayRange(
        new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)))
      ).end;
    } else {
      const monthly = relname.match(MONTHLY_PATTERN);
      if (!monthly) continue; // tle_history_default, anything unexpected -- never touched
      const [, y, m] = monthly;
      end = monthRange(Number(y), Number(m) - 1).end;
    }

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
