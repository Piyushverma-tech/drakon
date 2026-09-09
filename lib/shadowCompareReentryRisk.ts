/**
 * Shadow-mode comparison for the re-entry model (plan §17 Phase 6).
 *
 * Runs the existing TypeScript resolveReentryRisk() (still the sole
 * authoritative result) alongside the Python compute engine's
 * /compute/reentry, and reports how well they agree. The Python side is
 * best-effort: any failure calling it is caught and reported as
 * `pythonError`, never thrown, and never affects the returned `result`.
 *
 * This is intentionally NOT wired into lib/jobs/computeObjectTrends.ts or
 * any other production code path. Doing that is a real behavior change --
 * every trend computation would start making an outbound HTTP call -- and
 * deserves its own deliberate decision, not a silent addition alongside
 * building the comparison logic itself. What this file proves is that the
 * comparison CAN be made correctly; whether and when to actually run it in
 * the live cron path is a separate call. Before flipping
 * reentry_resolution's registry status (backend/compute/registry.py) past
 * "experimental", plan §17's remaining intent is for this comparison to
 * run against real production trend data for a meaningful stretch of time
 * with an acceptable divergence rate -- not just against the golden
 * fixtures, which by construction already agree.
 */
import { resolveReentryRisk } from './objectTrendRisk';
import {
  ComputeEngineError,
  resolveReentryRiskViaComputeEngine,
} from './reentryComputeClient';
import type { ObjectTrend, ReentryRisk, TleEntry } from './types';

// Same design as backend/tests/_golden_compare.py's FIELD_TOLERANCES:
// exact match by default, a small named/justified tolerance only for
// fields with a measured (not assumed) source of cross-runtime
// floating-point noise. Keep these two lists in sync -- they're comparing
// the same computation across the same TS/Python boundary, so the same
// noise sources apply here as in the golden-fixture parity tests.
const TOLERANCE_FIELDS = new Set(['bstar', 'decayRateKmPerDay', 'decayAltKm']);
const RELATIVE_TOLERANCE = 1e-9;
const ABSOLUTE_TOLERANCE = 1e-9;

export type FieldDifference = {
  field: string;
  tsValue: unknown;
  pythonValue: unknown;
};

export type ShadowComparisonResult = {
  /** The TS result -- this is what callers should actually use. Shadow
   * comparison never changes this. */
  result: ReentryRisk;
  pythonResult: ReentryRisk | null;
  /** Set when the Python call failed; pythonResult is null in that case. */
  pythonError: string | null;
  /** True only when pythonResult exists and every field matched (within
   * documented tolerance for the fields in TOLERANCE_FIELDS). False if the
   * Python call failed -- a failure is not a match. */
  matches: boolean;
  differences: FieldDifference[];
};

function numbersMatch(field: string, a: number, b: number): boolean {
  if (a === b) return true;
  if (!TOLERANCE_FIELDS.has(field)) return false;
  const diff = Math.abs(a - b);
  return diff <= ABSOLUTE_TOLERANCE || diff <= RELATIVE_TOLERANCE * Math.max(Math.abs(a), Math.abs(b));
}

function compareReentryRisk(ts: ReentryRisk, python: ReentryRisk): FieldDifference[] {
  const differences: FieldDifference[] = [];
  const fields = new Set<keyof ReentryRisk>([
    ...(Object.keys(ts) as (keyof ReentryRisk)[]),
    ...(Object.keys(python) as (keyof ReentryRisk)[]),
  ]);

  for (const field of fields) {
    const tsValue = ts[field];
    const pythonValue = python[field];

    if (tsValue === pythonValue) continue;
    if (
      typeof tsValue === 'number' &&
      typeof pythonValue === 'number' &&
      numbersMatch(field as string, tsValue, pythonValue)
    ) {
      continue;
    }
    // signals array / nested objects aren't part of ReentryRisk's shape,
    // so a plain reference/value inequality here is a real difference.
    differences.push({ field: field as string, tsValue, pythonValue });
  }

  return differences;
}

export async function shadowCompareReentryRisk(
  entry: TleEntry,
  trend: ObjectTrend | null | undefined,
  solarFluxMultiplier: number
): Promise<ShadowComparisonResult> {
  const result = resolveReentryRisk(entry, trend ?? undefined, solarFluxMultiplier);

  try {
    const pythonResult = await resolveReentryRiskViaComputeEngine(
      entry,
      trend,
      solarFluxMultiplier
    );
    const differences = compareReentryRisk(result, pythonResult);
    return {
      result,
      pythonResult,
      pythonError: null,
      matches: differences.length === 0,
      differences,
    };
  } catch (err) {
    const message =
      err instanceof ComputeEngineError ? err.message : (err as Error).message;
    return {
      result,
      pythonResult: null,
      pythonError: message,
      matches: false,
      differences: [],
    };
  }
}
