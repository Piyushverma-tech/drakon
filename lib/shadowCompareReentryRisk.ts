/**
 * Shadow-mode comparison for the re-entry model (plan §17 Phase 6).
 *
 * Runs the existing TypeScript resolveReentryRisk() (still the sole
 * authoritative result) alongside the Python compute engine's
 * /compute/reentry, and reports how well they agree. The Python side is
 * best-effort: any failure calling it is caught and reported via
 * pythonFailureType/pythonError, never thrown, and never affects the
 * returned `result`.
 *
 * Returns structured telemetry (requestId, durationMs, model identity,
 * matched, pythonFailureType, differenceCount, differences) rather than
 * just a boolean -- a rollout decision needs to distinguish "Python was
 * unreachable" from "Python disagreed on the tier" from "Python is
 * running a different model version than expected", and needs enough
 * volume/latency/failure-rate data to evaluate against real exit criteria
 * (see docs/PYTHON_COMPUTE_SHADOW_ROLLOUT.md), not just a pass/fail count.
 */
import { randomUUID } from 'node:crypto';
import { resolveReentryRisk } from './objectTrendRisk';
import {
  ComputeEngineError,
  resolveReentryRiskViaComputeEngine,
  type ComputeEngineErrorCode,
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

const EXPECTED_MODEL_ID = 'reentry_resolution';
// The exact, golden-fixture-verified reference version this comparator's
// tolerance scheme and "any difference is a bug" assumption were built
// against. Bump only deliberately alongside compute/registry.py's version
// history and a fresh golden-fixture-verified port -- see
// backend/README.md's environmental-input-boundary note on 0.1.0 -> 0.2.0.
const DEFAULT_EXPECTED_MODEL_VERSION = '0.1.0';

export type ShadowFailureType = ComputeEngineErrorCode | 'MODEL_VALUE_MISMATCH';

export type FieldDifference = {
  field: string;
  tsValue: unknown;
  pythonValue: unknown;
};

export type ShadowComparisonResult = {
  requestId: string;
  durationMs: number;
  expectedModelId: string;
  expectedModelVersion: string;
  /** Model identity actually returned. Null when the call never got far
   * enough to read a response (network error, timeout, non-2xx). */
  actualModelId: string | null;
  actualModelVersion: string | null;
  /** The TS result -- this is what callers should actually use. Shadow
   * comparison never changes this. */
  result: ReentryRisk;
  pythonResult: ReentryRisk | null;
  matched: boolean;
  /** Null when matched. Otherwise one of the client's error codes (the
   * call itself failed) or 'MODEL_VALUE_MISMATCH' (the call succeeded but
   * the two implementations disagree on the result). */
  pythonFailureType: ShadowFailureType | null;
  /** Human-readable detail for logs; pythonFailureType is what should
   * drive any automated classification. */
  pythonError: string | null;
  differenceCount: number;
  differences: FieldDifference[];
};

export type ShadowCompareOptions = {
  /** Passed straight through to resolveReentryRiskViaComputeEngine. For a
   * cron caller this should be derived from the remaining outer execution
   * budget minus a persistence/resolution reserve, not a fixed constant --
   * see that function's option docs. */
  timeoutMs?: number;
  /** Defaults to DEFAULT_EXPECTED_MODEL_VERSION. Override only for a
   * deliberate test against a specific model version. */
  expectedModelVersion?: string;
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
    differences.push({ field: field as string, tsValue, pythonValue });
  }

  return differences;
}

export async function shadowCompareReentryRisk(
  entry: TleEntry,
  trend: ObjectTrend | null | undefined,
  solarFluxMultiplier: number,
  options: ShadowCompareOptions = {}
): Promise<ShadowComparisonResult> {
  const requestId = randomUUID();
  const expectedModelVersion = options.expectedModelVersion ?? DEFAULT_EXPECTED_MODEL_VERSION;
  const result = resolveReentryRisk(entry, trend ?? undefined, solarFluxMultiplier);

  const startedAt = performance.now();

  try {
    const response = await resolveReentryRiskViaComputeEngine(
      entry,
      trend,
      solarFluxMultiplier,
      {
        timeoutMs: options.timeoutMs,
        expectedModelId: EXPECTED_MODEL_ID,
        expectedModelVersion,
      }
    );
    const durationMs = performance.now() - startedAt;
    const differences = compareReentryRisk(result, response.result);

    return {
      requestId,
      durationMs,
      expectedModelId: EXPECTED_MODEL_ID,
      expectedModelVersion,
      actualModelId: response.model.id,
      actualModelVersion: response.model.version,
      result,
      pythonResult: response.result,
      matched: differences.length === 0,
      pythonFailureType: differences.length === 0 ? null : 'MODEL_VALUE_MISMATCH',
      pythonError: null,
      differenceCount: differences.length,
      differences,
    };
  } catch (err) {
    const durationMs = performance.now() - startedAt;
    const failureType: ShadowFailureType =
      err instanceof ComputeEngineError ? err.code : 'NETWORK_ERROR';
    const message = err instanceof Error ? err.message : String(err);

    return {
      requestId,
      durationMs,
      expectedModelId: EXPECTED_MODEL_ID,
      expectedModelVersion,
      actualModelId: null,
      actualModelVersion: null,
      result,
      pythonResult: null,
      matched: false,
      pythonFailureType: failureType,
      pythonError: message,
      differenceCount: 0,
      differences: [],
    };
  }
}
