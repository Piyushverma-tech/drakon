/**
 * Compute-interface client for the DRAKON Compute Engine (plan §17 Phase 6).
 *
 * This is the ONLY place in the TypeScript codebase that should know about
 * BACKEND_URL. Everything else -- Vercel Service Bindings, the fact this is
 * currently a Vercel Service and not a conventional Python Function or
 * separate deployment -- is invisible past this module's boundary:
 *
 *   Next.js
 *      |
 *      | stable HTTP contract (this file)
 *      v
 *   Compute interface
 *      |
 *      +-- Vercel Service today (backend/, via BACKEND_URL)
 *      |
 *      +-- conventional Python Function / separate service later
 *
 * If the compute engine ever moves off Vercel Services, only this file's
 * request-sending should need to change -- callers keep using
 * resolveReentryRiskViaComputeEngine() exactly as they do today.
 *
 * Hardening (pre-live-shadow review): every call has an optional timeout
 * enforced via AbortController, the response envelope is validated at
 * runtime (not just asserted through a TS type -- fetch().json() returns
 * `any`), and the returned model identity is checked against what the
 * caller expected. A caller that doesn't pass timeoutMs gets no timeout
 * (matches prior behavior) -- callers on a bounded execution budget (e.g.
 * a cron route) should always pass one, computed from their own remaining
 * budget minus a persistence/resolution reserve; that calculation belongs
 * to the caller, not this module, since only the caller knows its budget.
 */
import type { ObjectTrend, ReentryRisk, TleEntry } from './types';

// Mirrors backend/contracts.py's ReentryComputeEntry exactly -- only the
// fields resolve_reentry_risk() actually reads, not the full TleEntry
// persistence shape. See that file's module docstring for why the two are
// deliberately different types.
type ReentryComputeEntry = {
  id: number;
  name: string;
  l1: string;
  meanMotion: number;
  meanMotionDot: number;
  perigeeKm: number;
  apogeeKm: number;
  isDebris: boolean;
};

// Mirrors backend/contracts.py's ReentryComputeTrend exactly.
type ReentryComputeTrend = {
  noradId: number;
  epochsAvailable: number;
  historyDaysAvailable: number;
  decaySignal: ObjectTrend['decaySignal'];
  reentryTier: ObjectTrend['reentryTier'];
  decayConfidence: number | null;
  maneuverLikelihood: number | null;
  bstarLatest: number | null;
  bstarSlope14d: number | null;
  perigeeLatest: number | null;
  perigeeSlope14d: number | null;
  smaLatest: number | null;
  smaSlope14d: number | null;
  meanMotionDotLatest: number | null;
  meanMotionDotMean14d: number | null;
  estimatedDaysRemaining: number | null;
  estimatedReentryAt: string | null;
};

type ReentryComputeInput = {
  entry: ReentryComputeEntry;
  trend: ReentryComputeTrend | null;
  solarFluxMultiplier: number;
};

export type ModelProvenance = {
  id: string;
  version: string;
  parameterSet: string;
  calibrationVersion: string | null;
};

export type ComputeEngineCallResult = {
  result: ReentryRisk;
  model: ModelProvenance;
  engine: { version: string };
};

export type ComputeEngineErrorCode =
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'HTTP_5XX'
  | 'HTTP_ERROR'
  | 'INVALID_RESPONSE'
  | 'MODEL_MISMATCH'
  | 'MODEL_VERSION_MISMATCH';

export class ComputeEngineError extends Error {
  constructor(
    message: string,
    readonly code: ComputeEngineErrorCode,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = 'ComputeEngineError';
  }
}

export type ResolveReentryRiskOptions = {
  /** Aborts the request after this many ms and throws ComputeEngineError
   * with code 'TIMEOUT'. Omit for no timeout (matches fetch's default). */
  timeoutMs?: number;
  /** Model id the response must carry. Defaults to 'reentry_resolution' --
   * the only model this endpoint currently serves. A mismatch here means
   * something is badly wired (wrong endpoint, wrong service), not a normal
   * version evolution -- always checked. */
  expectedModelId?: string;
  /** Model version the response must carry. Optional: normal version
   * bumps happen, and skipping this check is fine for exploratory calls.
   * Callers that depend on a specific model's exact numeric behavior
   * (shadow-mode comparison against golden-fixture-verified results, for
   * one) should always set this, so a silent 0.1.0 -> 0.2.0 move on the
   * server doesn't quietly invalidate what they're comparing against. */
  expectedModelVersion?: string;
};

function toComputeEntry(entry: TleEntry): ReentryComputeEntry {
  return {
    id: entry.id,
    name: entry.name,
    l1: entry.l1,
    meanMotion: entry.meanMotion,
    meanMotionDot: entry.meanMotionDot,
    perigeeKm: entry.perigeeKm,
    apogeeKm: entry.apogeeKm,
    isDebris: entry.isDebris ?? false,
  };
}

function toComputeTrend(trend: ObjectTrend): ReentryComputeTrend {
  return {
    noradId: trend.noradId,
    epochsAvailable: trend.epochsAvailable,
    historyDaysAvailable: trend.historyDaysAvailable,
    decaySignal: trend.decaySignal,
    reentryTier: trend.reentryTier,
    decayConfidence: trend.decayConfidence,
    maneuverLikelihood: trend.maneuverLikelihood,
    bstarLatest: trend.bstarLatest,
    bstarSlope14d: trend.bstarSlope14d,
    perigeeLatest: trend.perigeeLatest,
    perigeeSlope14d: trend.perigeeSlope14d,
    smaLatest: trend.smaLatest,
    smaSlope14d: trend.smaSlope14d,
    meanMotionDotLatest: trend.meanMotionDotLatest,
    meanMotionDotMean14d: trend.meanMotionDotMean14d,
    estimatedDaysRemaining: trend.estimatedDaysRemaining,
    estimatedReentryAt: trend.estimatedReentryAt,
  };
}

function backendUrl(): string {
  const url = process.env.BACKEND_URL;
  if (!url) {
    throw new ComputeEngineError(
      'BACKEND_URL is not set. This is injected by the Vercel Service ' +
        'Binding declared on the `web` service in /vercel.json -- it will ' +
        'be absent in any environment that is not deployed as a Vercel ' +
        'Service (e.g. plain `next dev`), which is expected during local ' +
        'development, not just a misconfiguration.',
      'NETWORK_ERROR'
    );
  }
  return url;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Runtime validation of the /compute/reentry response envelope. fetch()'s
 * .json() return type is `any` -- the TS ComputeEngineCallResult type is
 * not enforced by anything until this function actually checks it. Checks
 * the fields the review specifically called out (result, model.id,
 * model.version, model.parameterSet, engine.version) plus enough of
 * `result`'s own shape to catch a genuinely malformed body (the review's
 * own example: `{"result": {"...": "malformed"}}`) without hand-rolling a
 * full schema validator for a bounded, internal contract.
 */
function validateComputeResponse(raw: unknown): ComputeEngineCallResult {
  const fail = (detail: string): never => {
    throw new ComputeEngineError(
      `Compute engine response failed validation: ${detail}`,
      'INVALID_RESPONSE'
    );
  };

  if (!isPlainObject(raw)) fail('response body is not a JSON object');

  const { result, model, engine } = raw as Record<string, unknown>;

  if (!isPlainObject(result)) fail('"result" is missing or not an object');
  const r = result as Record<string, unknown>;
  const requiredResultFields: [string, string][] = [
    ['satId', 'number'],
    ['bstar', 'number'],
    ['meanMotionDot', 'number'],
    ['signalsAgree', 'boolean'],
    ['confidence', 'string'],
    ['perigeeKm', 'number'],
    ['decayAltKm', 'number'],
    ['decayRateKmPerDay', 'number'],
    ['tier', 'string'],
  ];
  for (const [field, type] of requiredResultFields) {
    if (typeof r[field] !== type) {
      fail(`"result.${field}" expected ${type}, got ${typeof r[field]}`);
    }
  }
  if (!('estimatedDaysRemaining' in r) || (typeof r.estimatedDaysRemaining !== 'number' && r.estimatedDaysRemaining !== null)) {
    fail('"result.estimatedDaysRemaining" expected number or null');
  }

  if (!isPlainObject(model)) fail('"model" is missing or not an object');
  const m = model as Record<string, unknown>;
  if (typeof m.id !== 'string') fail('"model.id" expected string');
  if (typeof m.version !== 'string') fail('"model.version" expected string');
  if (typeof m.parameterSet !== 'string') fail('"model.parameterSet" expected string');
  if (m.calibrationVersion !== null && typeof m.calibrationVersion !== 'string') {
    fail('"model.calibrationVersion" expected string or null');
  }

  if (!isPlainObject(engine)) fail('"engine" is missing or not an object');
  const e = engine as Record<string, unknown>;
  if (typeof e.version !== 'string') fail('"engine.version" expected string');

  return raw as ComputeEngineCallResult;
}

/**
 * Calls the DRAKON Compute Engine's re-entry model over HTTP and returns
 * the full response envelope: the ReentryRisk-shaped result plus model and
 * engine provenance. (tip / tipDeltaDays / tipAgreement on the result are
 * never set here -- those come from attachTipData(), a separate
 * post-processing step applied on top of either implementation's result;
 * this function is a drop-in alternative to resolveReentryRisk() itself,
 * not to attachTipData().)
 *
 * Throws ComputeEngineError on any failure (network, timeout, non-2xx,
 * malformed body, model identity mismatch) rather than returning a
 * fallback value -- callers in shadow mode should catch this explicitly
 * and treat it as "no comparison data this time", not silently swallow
 * it. See shadowCompareReentryRisk.ts.
 */
export async function resolveReentryRiskViaComputeEngine(
  entry: TleEntry,
  trend: ObjectTrend | null | undefined,
  solarFluxMultiplier: number,
  options: ResolveReentryRiskOptions = {}
): Promise<ComputeEngineCallResult> {
  const { timeoutMs, expectedModelId = 'reentry_resolution', expectedModelVersion } = options;

  const input: ReentryComputeInput = {
    entry: toComputeEntry(entry),
    trend: trend ? toComputeTrend(trend) : null,
    solarFluxMultiplier,
  };

  const controller = new AbortController();
  const timeoutHandle =
    timeoutMs !== undefined ? setTimeout(() => controller.abort(), timeoutMs) : undefined;

  let response: Response;
  try {
    response = await fetch(`${backendUrl()}/compute/reentry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new ComputeEngineError(
        `Compute engine call timed out after ${timeoutMs}ms`,
        'TIMEOUT',
        err
      );
    }
    throw new ComputeEngineError(
      `Network error calling the compute engine's /compute/reentry: ${(err as Error).message}`,
      'NETWORK_ERROR',
      err
    );
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '<unreadable body>');
    const code: ComputeEngineErrorCode = response.status >= 500 ? 'HTTP_5XX' : 'HTTP_ERROR';
    throw new ComputeEngineError(
      `Compute engine returned ${response.status} from /compute/reentry: ${bodyText}`,
      code
    );
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch (err) {
    throw new ComputeEngineError(
      `Compute engine's /compute/reentry response was not valid JSON: ${(err as Error).message}`,
      'INVALID_RESPONSE',
      err
    );
  }

  const body = validateComputeResponse(raw);

  if (body.model.id !== expectedModelId) {
    throw new ComputeEngineError(
      `Compute engine returned model id "${body.model.id}", expected "${expectedModelId}"`,
      'MODEL_MISMATCH'
    );
  }
  if (expectedModelVersion !== undefined && body.model.version !== expectedModelVersion) {
    throw new ComputeEngineError(
      `Compute engine returned model version "${body.model.version}", expected "${expectedModelVersion}"`,
      'MODEL_VERSION_MISMATCH'
    );
  }

  return body;
}
