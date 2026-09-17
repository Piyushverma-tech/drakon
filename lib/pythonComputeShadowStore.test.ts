/**
 * Tests for lib/pythonComputeShadowStore.ts's write path. No live
 * Postgres available (see lib/shadowCatalog.test.ts's docstring for the
 * same caveat) -- these mock db.insert/db.update to verify the query
 * shape (correct table, correct fields, correct WHERE clause) rather
 * than proving a real database round-trip.
 */
const insertMock = jest.fn();
const updateMock = jest.fn();

jest.mock('./db', () => ({
  db: {
    insert: (...args: unknown[]) => insertMock(...args),
    update: (...args: unknown[]) => updateMock(...args),
  },
}));

import {
  persistPythonComputeShadowRun,
  recordPythonComputeShadowRunTiming,
} from './pythonComputeShadowStore';
import type { PythonComputeShadowSummary } from './pythonComputeShadow';

function makeSummary(
  overrides: Partial<PythonComputeShadowSummary> = {}
): PythonComputeShadowSummary {
  return {
    generatedAt: '2026-01-01T00:00:00.000Z',
    expectedModelId: 'reentry_resolution',
    expectedModelVersion: '0.1.0',
    catalogSize: 100,
    eligibleCount: 50,
    sampledCount: 10,
    successCount: 10,
    matchedCount: 10,
    valueMismatchCount: 0,
    failureCount: 0,
    failuresByType: {},
    durationMsP50: 100,
    durationMsP95: 200,
    durationMsP99: 250,
    sampleRate: 0.15,
    maxSampleSize: 20,
    rows: [],
    ...overrides,
  };
}

beforeEach(() => {
  insertMock.mockReset();
  updateMock.mockReset();
});

describe('persistPythonComputeShadowRun', () => {
  it('inserts a run row including the provided timing fields', async () => {
    const valuesMock = jest.fn().mockReturnValue({
      returning: () => Promise.resolve([{ id: 42 }]),
    });
    insertMock.mockReturnValueOnce({ values: valuesMock });

    const runId = await persistPythonComputeShadowRun(makeSummary(), {
      catalogLoadMs: 120,
      pythonComputeMs: 900,
    });

    expect(runId).toBe(42);
    const insertedValues = valuesMock.mock.calls[0][0];
    expect(insertedValues.catalogLoadMs).toBe(120);
    expect(insertedValues.pythonComputeMs).toBe(900);
    // Not known yet at insert time -- see recordPythonComputeShadowRunTiming.
    expect(insertedValues.persistenceMs).toBeNull();
    expect(insertedValues.totalRouteMs).toBeNull();
  });

  it('defaults all timing fields to null when none are provided', async () => {
    const valuesMock = jest.fn().mockReturnValue({
      returning: () => Promise.resolve([{ id: 1 }]),
    });
    insertMock.mockReturnValueOnce({ values: valuesMock });

    await persistPythonComputeShadowRun(makeSummary());

    const insertedValues = valuesMock.mock.calls[0][0];
    expect(insertedValues.catalogLoadMs).toBeNull();
    expect(insertedValues.pythonComputeMs).toBeNull();
  });

  it('does not insert delta rows when the summary has none', async () => {
    const valuesMock = jest.fn().mockReturnValue({
      returning: () => Promise.resolve([{ id: 1 }]),
    });
    insertMock.mockReturnValueOnce({ values: valuesMock });

    await persistPythonComputeShadowRun(makeSummary({ rows: [] }));

    expect(insertMock).toHaveBeenCalledTimes(1); // only the run insert
  });

  it('inserts one delta row per non-matching object', async () => {
    const runValuesMock = jest.fn().mockReturnValue({
      returning: () => Promise.resolve([{ id: 7 }]),
    });
    const deltaValuesMock = jest.fn().mockReturnValue(Promise.resolve());
    insertMock.mockReturnValueOnce({ values: runValuesMock });
    insertMock.mockReturnValueOnce({ values: deltaValuesMock });

    await persistPythonComputeShadowRun(
      makeSummary({
        rows: [
          {
            noradId: 123,
            requestId: 'req-1',
            durationMs: 50,
            matched: false,
            pythonFailureType: 'MODEL_VALUE_MISMATCH',
            differenceCount: 1,
            differences: [{ field: 'tier', tsValue: 'stable', pythonValue: 'nominal' }],
            tsTier: 'stable',
            pythonTier: 'nominal',
          },
        ],
      })
    );

    expect(insertMock).toHaveBeenCalledTimes(2);
    const deltaRows = deltaValuesMock.mock.calls[0][0];
    expect(deltaRows).toHaveLength(1);
    expect(deltaRows[0]).toMatchObject({ runId: 7, noradId: 123, tsTier: 'stable' });
  });
});

describe('recordPythonComputeShadowRunTiming', () => {
  it('updates only persistenceMs/totalRouteMs for the given run id', async () => {
    const whereMock = jest.fn().mockReturnValue(Promise.resolve());
    const setMock = jest.fn().mockReturnValue({ where: whereMock });
    updateMock.mockReturnValueOnce({ set: setMock });

    await recordPythonComputeShadowRunTiming(42, {
      persistenceMs: 33,
      totalRouteMs: 1500,
    });

    expect(setMock).toHaveBeenCalledWith({ persistenceMs: 33, totalRouteMs: 1500 });
    expect(whereMock).toHaveBeenCalledTimes(1);
  });
});
