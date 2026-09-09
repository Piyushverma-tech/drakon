/**
 * Full-stack verification: TS client -> real running compute engine ->
 * response parsed back into a ReentryRisk, compared against the TS
 * reference for every resolveReentryRisk golden case.
 *
 * Requires a live compute engine at BACKEND_URL (e.g.
 * `cd backend && uvicorn main:app --port 8000`, then
 * `BACKEND_URL=http://127.0.0.1:8000 npx jest reentryComputeClient.e2e`).
 * Skips cleanly (not a failure) when BACKEND_URL isn't set, since the
 * plain `npm test` / CI `test-typescript` job doesn't boot the Python
 * service -- this is a deliberate manual/local integration check, not
 * part of the default suite. See lib/shadowCompareReentryRisk.ts's module
 * docstring for why this isn't wired into production code yet either.
 */
import goldenFixtures from '../fixtures/reentry-model/golden_cases.json';
import { resolveReentryRiskViaComputeEngine } from './reentryComputeClient';
import { shadowCompareReentryRisk } from './shadowCompareReentryRisk';
import type { ObjectTrend, TleEntry } from './types';

const hasBackend = Boolean(process.env.BACKEND_URL);
const describeIfBackend = hasBackend ? describe : describe.skip;

describeIfBackend('reentryComputeClient — live compute engine', () => {
  it.each(
    goldenFixtures.resolveReentryRisk.map((c) => [c.id, c] as const)
  )('%s: resolveReentryRiskViaComputeEngine matches the golden output', async (_id, testCase) => {
    const { entry, trend, solarFluxMultiplier } = testCase.input as {
      entry: TleEntry;
      trend: ObjectTrend | undefined;
      solarFluxMultiplier: number;
    };

    const result = await resolveReentryRiskViaComputeEngine(
      entry,
      trend,
      solarFluxMultiplier
    );

    // Same tolerance as backend/tests/_golden_compare.py: exact except the
    // three named fields with measured cross-runtime pow()-rounding noise.
    const TOLERANT_FIELDS = new Set(['bstar', 'decayRateKmPerDay', 'decayAltKm']);
    for (const [key, expected] of Object.entries(testCase.output)) {
      const actual = (result as Record<string, unknown>)[key];
      if (
        typeof expected === 'number' &&
        typeof actual === 'number' &&
        TOLERANT_FIELDS.has(key)
      ) {
        expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1e-9);
      } else {
        expect(actual).toEqual(expected);
      }
    }
  });

  it.each(
    goldenFixtures.resolveReentryRisk.map((c) => [c.id, c] as const)
  )('%s: shadowCompareReentryRisk reports a match', async (_id, testCase) => {
    const { entry, trend, solarFluxMultiplier } = testCase.input as {
      entry: TleEntry;
      trend: ObjectTrend | undefined;
      solarFluxMultiplier: number;
    };

    const comparison = await shadowCompareReentryRisk(entry, trend, solarFluxMultiplier);

    expect(comparison.pythonError).toBeNull();
    expect(comparison.differences).toEqual([]);
    expect(comparison.matches).toBe(true);
  });
});

if (!hasBackend) {
  console.log(
    'Skipping lib/reentryComputeClient.e2e.test.ts — set BACKEND_URL to a ' +
      'running compute engine (e.g. `cd backend && uvicorn main:app --port 8000`) to run it.'
  );
}
