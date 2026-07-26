jest.mock('@/lib/db', () => ({
  db: { execute: jest.fn() },
}));

import { PgDialect } from 'drizzle-orm/pg-core';
import { db } from '@/lib/db';
import {
  monthRange,
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

describe('monthRange', () => {
  it('computes the correct name and [start, end) for a normal month', () => {
    const { name, start, end } = monthRange(2026, 8); // September (0-indexed)
    expect(name).toBe('tle_history_2026_09');
    expect(start.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('rolls over into the next year across a December boundary', () => {
    const { name, start, end } = monthRange(2026, 12); // December + 1
    expect(name).toBe('tle_history_2027_01');
    expect(start.toISOString()).toBe('2027-01-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2027-02-01T00:00:00.000Z');
  });
});

describe('ensureUpcomingPartitions', () => {
  beforeEach(() => mockedExecute.mockReset());
  afterEach(() => jest.restoreAllMocks());

  it('creates the current month plus 2 months of forward buffer', async () => {
    mockedExecute.mockResolvedValue({ rows: [] });
    const now = new Date('2026-07-25T12:00:00Z');

    const created = await ensureUpcomingPartitions(now);

    expect(created).toEqual([
      'tle_history_2026_07',
      'tle_history_2026_08',
      'tle_history_2026_09',
    ]);
    expect(mockedExecute).toHaveBeenCalledTimes(3);

    const sqlTexts = mockedExecute.mock.calls.map(renderedSql);
    expect(sqlTexts[2]).toContain('CREATE TABLE IF NOT EXISTS');
    expect(sqlTexts[2]).toContain('"tle_history_2026_09"');
    expect(sqlTexts[2]).toContain(
      "FOR VALUES FROM ('2026-09-01') TO ('2026-10-01')"
    );
  });

  it('crosses a year boundary correctly when run in November/December', async () => {
    mockedExecute.mockResolvedValue({ rows: [] });
    const now = new Date('2026-12-15T00:00:00Z');

    const created = await ensureUpcomingPartitions(now);

    expect(created).toEqual([
      'tle_history_2026_12',
      'tle_history_2027_01',
      'tle_history_2027_02',
    ]);
  });
});

describe('dropStalePartitions', () => {
  beforeEach(() => mockedExecute.mockReset());
  afterEach(() => jest.restoreAllMocks());

  it('drops only partitions whose entire range is more than 35 days stale, and never touches the default partition', async () => {
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

  it('drops nothing when no partition is old enough yet', async () => {
    mockedExecute.mockResolvedValue({
      rows: [
        { relname: 'tle_history_2026_07' },
        { relname: 'tle_history_2026_08' },
      ],
    });

    const dropped = await dropStalePartitions(new Date('2026-07-25T00:00:00Z'));

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

    const result = await runPartitionMaintenance(
      new Date('2026-08-10T00:00:00Z')
    );

    expect(result.created).toEqual([
      'tle_history_2026_08',
      'tle_history_2026_09',
      'tle_history_2026_10',
    ]);
    expect(result.dropped).toEqual(['tle_history_2026_06']);
  });
});
