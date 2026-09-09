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
 * NOT wired into any production code path yet (no caller in
 * lib/jobs/computeObjectTrends.ts or anywhere else). This module and
 * shadowCompareReentryRisk.ts exist so that integration can happen as its
 * own deliberate, reviewed step -- see shadowCompareReentryRisk.ts's module
 * docstring for why shadow mode, not a silent swap, is the right next step
 * before reentry_resolution's registry status moves past "experimental".
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

type ComputeResponse<TResult> = {
  result: TResult;
  model: {
    id: string;
    version: string;
    parameterSet: string;
    calibrationVersion: string | null;
  };
  engine: { version: string };
};

export class ComputeEngineError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = 'ComputeEngineError';
  }
}

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
        'development, not just a misconfiguration.'
    );
  }
  return url;
}

/**
 * Calls the DRAKON Compute Engine's re-entry model over HTTP and returns a
 * ReentryRisk shaped exactly like resolveReentryRisk()'s return value --
 * except the tip / tipDeltaDays / tipAgreement fields are never set here.
 * Those come from attachTipData(), a separate post-processing step applied
 * on top of either implementation's result; this function is a drop-in
 * alternative to resolveReentryRisk() itself, not to attachTipData().
 *
 * Throws ComputeEngineError on any failure (network, non-200, malformed
 * body) rather than returning a fallback value -- callers in shadow mode
 * should catch this explicitly and treat it as "no comparison data this
 * time", not silently swallow it. See shadowCompareReentryRisk.ts.
 */
export async function resolveReentryRiskViaComputeEngine(
  entry: TleEntry,
  trend: ObjectTrend | null | undefined,
  solarFluxMultiplier: number
): Promise<ReentryRisk> {
  const input: ReentryComputeInput = {
    entry: toComputeEntry(entry),
    trend: trend ? toComputeTrend(trend) : null,
    solarFluxMultiplier,
  };

  let response: Response;
  try {
    response = await fetch(`${backendUrl()}/compute/reentry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  } catch (err) {
    throw new ComputeEngineError(
      `Network error calling the compute engine's /compute/reentry: ${(err as Error).message}`,
      err
    );
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '<unreadable body>');
    throw new ComputeEngineError(
      `Compute engine returned ${response.status} from /compute/reentry: ${bodyText}`
    );
  }

  let body: ComputeResponse<ReentryRisk>;
  try {
    body = await response.json();
  } catch (err) {
    throw new ComputeEngineError(
      `Compute engine's /compute/reentry response was not valid JSON: ${(err as Error).message}`,
      err
    );
  }

  if (!body || typeof body !== 'object' || !('result' in body)) {
    throw new ComputeEngineError(
      'Compute engine response was missing the expected {result, model, engine} envelope shape.'
    );
  }

  return body.result;
}
