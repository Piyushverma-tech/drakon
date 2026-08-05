jest.mock('@/lib/db', () => ({
  db: {
    insert: jest.fn(),
    delete: jest.fn(),
    execute: jest.fn(),
  },
}));

jest.mock('@/lib/redis', () => ({
  __esModule: true,
  default: { get: jest.fn(), set: jest.fn(), del: jest.fn() },
}));

import { db } from '@/lib/db';
import { tleArchive, tleHistory, trendJobs } from '@/lib/db/schema';
import type { TleEntry } from '@/lib/types';
import { ingestTleHistory } from './ingestTleHistory';

const mockDb = db as unknown as {
  insert: jest.Mock;
  delete: jest.Mock;
  execute: jest.Mock;
};

function entry(overrides: Partial<TleEntry> = {}): TleEntry {
  const id = overrides.id ?? 25544;
  const idStr = String(id).padStart(5, '0');
  return {
    id,
    name: `OBJ-${id}`,
    operator: 'TEST',
    l1: `1 ${idStr}U 98067A   26199.50000000  .00016717  00000-0  10270-3 0  9994`,
    l2: `2 ${idStr}  51.6400 208.9163 0007540  69.9862  25.2906 15.49560000123456`,
    inclination: 51.64,
    raan: 208.9163,
    argPerigee: 69.9862,
    meanAnomaly: 25.2906,
    meanMotion: 15.4956,
    meanMotionDot: 0.00016717,
    tleEpoch: '2026-07-18T12:00:00.000Z',
    ecc: 0.000754,
    perigeeKm: 400,
    apogeeKm: 420,
    semiMajorAxisKm: 6778,
    ...overrides,
  };
}

function insertChain(returningRows: { noradId: number }[] = []) {
  return {
    values: jest.fn().mockReturnThis(),
    onConflictDoNothing: jest.fn().mockReturnThis(),
    returning: jest.fn().mockResolvedValue(returningRows),
  };
}

describe('ingestTleHistory', () => {
  beforeEach(() => {
    mockDb.insert.mockReset();
    mockDb.delete.mockReset();
    mockDb.execute.mockReset();
    mockDb.execute.mockResolvedValue({ rows: [] });
  });

  it('skips stable deep-space geometry before history, archive, and trend writes', async () => {
    const result = await ingestTleHistory(
      [
        entry({ id: 1001, meanMotion: 2, perigeeKm: 500, apogeeKm: 700 }),
        entry({ id: 1002, perigeeKm: 50_000, apogeeKm: 50_200 }),
        entry({ id: 1003, meanMotion: 12, perigeeKm: 300, apogeeKm: 4_000 }),
      ],
      'test-source'
    );

    expect(result).toEqual({ inserted: 0, skipped: 3, invalid: 0 });
    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(mockDb.delete).not.toHaveBeenCalled();
    expect(mockDb.execute).not.toHaveBeenCalled();
  });

  it('continues writing actionable low-orbit entries', async () => {
    const chains = [
      insertChain([{ noradId: 2001 }]),
      insertChain(),
      insertChain(),
    ];
    mockDb.insert.mockImplementation(() => chains.shift());

    const result = await ingestTleHistory(
      [entry({ id: 2001, meanMotion: 15, perigeeKm: 400, apogeeKm: 430 })],
      'test-source'
    );

    expect(result).toEqual({ inserted: 1, skipped: 0, invalid: 0 });
    expect(mockDb.insert.mock.calls.map(([table]) => table)).toEqual([
      tleHistory,
      tleArchive,
      trendJobs,
    ]);
    expect(mockDb.delete).not.toHaveBeenCalled();
  });
});
