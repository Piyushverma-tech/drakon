jest.mock('@/lib/db', () => ({
  db: { execute: jest.fn() },
}));

import { PgDialect } from 'drizzle-orm/pg-core';
import { db } from '@/lib/db';
import {
  ensureUpcomingPartitions,
  dropStalePartitions,
  runPartitionMaintenance,
} from './tlePartitions';

const mockedExecute = db.execute as jest.Mock;
const dialect = new PgDialect();

function renderedSql(call: unknown): string {
  // @ts-expect-error -- test-only helper, call[0] is the drizzle SQL object
  return dialect.sqlToQuery(call[0]).sql;
}

function expectedDailyNames(startIsoDate: string, count: number): string[] {
  const start = new Date(`${startIsoDate}T00:00:00.000Z`);
  return Array.from({ length: count }, (_, i) => {
    const day = new Date(start.getTime() + i * 24 * 60 * 60 * 1000);
    return `tle_history_${day.toISOString().slice(0, 10).replace(/-/g, '_')}`;
  });
}

describe('ensureUpcomingPartitions', () => {
  beforeEach(() => mockedExecute.mockReset());
  afterEach(() => jest.restoreAllMocks());

  it('creates today plus 7 days of forward buffer after the daily cutover', async () => {
    mockedExecute.mockResolvedValue({ rows: [] });
    const now = new Date('2026-12-15T00:00:00Z');

    const created = await ensureUpcomingPartitions(now);

    expect(created).toEqual(expectedDailyNames('2026-12-15', 8));
    expect(mockedExecute).toHaveBeenCalledTimes(8);

    const sqlTexts = mockedExecute.mock.calls.map(renderedSql);
    expect(sqlTexts[0]).toContain('CREATE TABLE IF NOT EXISTS');
    expect(sqlTexts[0]).toContain('"tle_history_2026_12_15"');
    expect(sqlTexts[0]).toContain(
      "FOR VALUES FROM ('2026-12-15') TO ('2026-12-16')"
    );
  });

  it('starts at the Sept 1 cutover when now is still before daily partitions begin', async () => {
    mockedExecute.mockResolvedValue({ rows: [] });
    const now = new Date('2026-07-25T12:00:00Z');

    const created = await ensureUpcomingPartitions(now);

    // Cutover is 2026-09-01; pre-cutover runs still create the first 8 daily partitions.
    expect(created).toEqual(expectedDailyNames('2026-09-01', 8));
  });
});

describe('dropStalePartitions', () => {
  beforeEach(() => mockedExecute.mockReset());
  afterEach(() => jest.restoreAllMocks());

  it('drops stale legacy monthly partitions and never touches the default partition', async () => {
    mockedExecute.mockImplementation(async (query: unknown) => {
      const text = renderedSql([query]);
      if (text.includes('pg_inherits')) {
        return {
          rows: [
            { relname: 'tle_history_2026_06' }, // June -- should be dropped
            { relname: 'tle_history_2026_07' }, // July -- should NOT be dropped yet
            { relname: 'tle_history_2026_08' }, // August -- should NOT be dropped
            { relname: 'tle_history_default' }, // never touched
            { relname: 'some_unrelated_table' }, // never touched (doesn't match pattern)
          ],
        };
      }
      return { rows: [] }; // DROP TABLE calls
    });

    // Cutoff = now - 35 days. June's exclusive end is 2026-07-01.
    // now = 2026-08-10 -> cutoff = 2026-07-06, so June (end 2026-07-01) is
    // stale, July (end 2026-08-01) is not yet.
    const now = new Date('2026-08-10T00:00:00Z');

    const dropped = await dropStalePartitions(now);

    expect(dropped).toEqual(['tle_history_2026_06']);

    const dropCalls = mockedExecute.mock.calls
      .map(renderedSql)
      .filter((s) => s.startsWith('DROP TABLE'));
    expect(dropCalls).toHaveLength(1);
    expect(dropCalls[0]).toContain('"tle_history_2026_06"');
  });

  it('drops stale daily partitions whose exclusive end is past the retention window', async () => {
    mockedExecute.mockImplementation(async (query: unknown) => {
      const text = renderedSql([query]);
      if (text.includes('pg_inherits')) {
        return {
          rows: [
            { relname: 'tle_history_2026_09_01' }, // end 09-02 -- stale
            { relname: 'tle_history_2026_10_10' }, // end 10-11 -- still within 35d
            { relname: 'tle_history_default' },
          ],
        };
      }
      return { rows: [] };
    });

    // now = 2026-10-20 -> cutoff = 2026-09-15
    const dropped = await dropStalePartitions(new Date('2026-10-20T00:00:00Z'));

    expect(dropped).toEqual(['tle_history_2026_09_01']);
  });

  it('drops nothing when no partition is old enough yet', async () => {
    mockedExecute.mockResolvedValue({
      rows: [
        { relname: 'tle_history_2026_09_01' },
        { relname: 'tle_history_2026_09_02' },
      ],
    });

    const dropped = await dropStalePartitions(new Date('2026-09-10T00:00:00Z'));

    expect(dropped).toEqual([]);
  });
});

describe('runPartitionMaintenance', () => {
  it('composes ensure + drop into one result', async () => {
    mockedExecute.mockImplementation(async (query: unknown) => {
      const text = renderedSql([query]);
      if (text.includes('pg_inherits')) {
        return { rows: [{ relname: 'tle_history_2026_06' }] };
      }
      return { rows: [] };
    });

    // 2026-08-10 is before cutover, so ensure starts at 2026-09-01.
    const result = await runPartitionMaintenance(
      new Date('2026-08-10T00:00:00Z')
    );

    expect(result.created).toEqual(expectedDailyNames('2026-09-01', 8));
    expect(result.dropped).toEqual(['tle_history_2026_06']);
  });
});
