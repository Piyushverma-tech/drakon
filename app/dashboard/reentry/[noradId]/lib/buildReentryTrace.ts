import {
  reconstructSignalContributions,
  type SignalContribution,
} from '@/lib/explainReentryTrend';
import { ObjectTrend, ReentryRisk } from '@/lib/types';

export type TraceStepIcon =
  | 'database'
  | 'check'
  | 'x'
  | 'shield-check'
  | 'shield-x'
  | 'target-arrow'
  | 'alert-triangle'
  | 'help-circle';

export type TraceStepStatus = 'agree' | 'disagree' | 'neutral';

export interface ReentryTraceStep {
  id: string;
  stage: string;
  icon: TraceStepIcon;
  status: TraceStepStatus;
  claim: string;
  detail: string;
}

export interface ReentryVerdict {
  tier: ReentryRisk['tier'];
  headline: string;
  confidenceLine: string;
  summary: string;
}

export interface ReentryTrace {
  verdict: ReentryVerdict;
  steps: ReentryTraceStep[];
  computedAt: string | null;
  isCurrentModelVersion: boolean;
}

export interface BuildReentryTraceInput {
  /** The final, authoritative risk -- same resolveReentryRisk() output the
   * dashboard and detail panel already render. This, not the trend row
   * alone, is the source of truth for the verdict, because for objects
   * below the altitude threshold it may already reflect a more pessimistic
   * live-altitude estimate than the trend model's last computation. */
  risk: ReentryRisk;
  /** The trend row, if one exists. Supplies the per-signal breakdown and
   * consensus steps, and is compared against `risk` to detect when a live
   * altitude estimate has overridden it. */
  trend: ObjectTrend | undefined;
  isCurrentModelVersion?: boolean;
}

function pct(value: number): number {
  return Math.round(value * 100);
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const SIGNAL_LABEL: Record<SignalContribution['name'], string> = {
  bstar: 'Bstar drag coefficient',
  ndot: 'N-dot',
  altitude: 'Altitude',
};

const CONFIDENCE_WORD: Record<ReentryRisk['confidence'], string> = {
  high: 'high',
  medium: 'moderate',
  low: 'low',
};

function loadHistoryStep(trend: ObjectTrend): ReentryTraceStep {
  const epochs = trend.epochsAvailable;
  const days = trend.historyDaysAvailable;
  return {
    id: 'load-history',
    stage: 'Load history',
    icon: 'database',
    status: 'neutral',
    claim:
      epochs === null
        ? 'Historical epochs unavailable'
        : `Loaded ${epochs} historical epoch${epochs === 1 ? '' : 's'}`,
    detail:
      days === null
        ? 'basis for regression'
        : `spanning ${days.toFixed(1)} days — basis for regression`,
  };
}

function signalStep(signal: SignalContribution): ReentryTraceStep {
  const label = SIGNAL_LABEL[signal.name];
  const stage =
    signal.name === 'bstar'
      ? 'Bstar analysis'
      : signal.name === 'ndot'
        ? 'N-dot analysis'
        : 'Altitude analysis';
  const claim = signal.agrees
    ? signal.name === 'bstar'
      ? `${label} is increasing`
      : signal.name === 'ndot'
        ? `${label} confirms drag acceleration`
        : `${label} is decreasing`
    : `${label} shows no clear trend`;

  return {
    id: `signal-${signal.name}`,
    stage,
    icon: signal.agrees ? 'check' : 'x',
    status: signal.agrees ? 'agree' : 'disagree',
    claim,
    detail: `strength ${signal.strength.toFixed(2)}, weight ${pct(signal.weight)}%`,
  };
}

function consensusStep(trend: ObjectTrend): ReentryTraceStep | null {
  const { consensusRequired, consensusMet } = trend;
  if (consensusRequired === null || consensusMet === null) return null;

  if (consensusRequired === 'none') {
    return {
      id: 'consensus',
      stage: 'Consensus',
      icon: 'shield-check',
      status: 'neutral',
      claim: 'No cross-signal consensus required',
      detail: 'below 220km, altitude alone is decisive',
    };
  }

  const band =
    consensusRequired === 'full'
      ? 'full consensus required above 300km'
      : 'partial consensus required in the 220-300km band';

  return {
    id: 'consensus',
    stage: 'Consensus',
    icon: consensusMet ? 'shield-check' : 'shield-x',
    status: consensusMet ? 'agree' : 'disagree',
    claim: consensusMet
      ? 'Signals meet consensus'
      : 'Signals do not meet consensus',
    detail: band,
  };
}

function tierStep(risk: ReentryRisk): ReentryTraceStep {
  if (risk.decaySignal === 'maneuvering') {
    return {
      id: 'tier',
      stage: 'Verdict',
      icon: 'alert-triangle',
      status: 'neutral',
      claim: 'Maneuver signature detected',
      detail: 're-entry estimate suppressed',
    };
  }

  if (risk.estimatedDaysRemaining === null) {
    return {
      id: 'tier',
      stage: 'Verdict',
      icon: 'help-circle',
      status: 'neutral',
      claim: 'No re-entry estimate',
      detail: 'insufficient evidence of sustained decay',
    };
  }

  return {
    id: 'tier',
    stage: 'Verdict',
    icon: 'target-arrow',
    status: 'agree',
    claim: `Re-entry estimated in ~${risk.estimatedDaysRemaining} days`,
    detail: `tier assigned: ${risk.tier}`,
  };
}

/**
 * Set only when the live, altitude-driven risk resolution (resolveReentryRisk)
 * disagrees with what the trend model's own last computation said.
 */
function overrideStep(
  risk: ReentryRisk,
  trend: ObjectTrend
): ReentryTraceStep | null {
  if (trend.reentryTier === risk.tier) return null;

  const trendDays =
    trend.estimatedDaysRemaining === null
      ? 'no estimate'
      : `~${trend.estimatedDaysRemaining} days`;

  return {
    id: 'override',
    stage: 'Live override',
    icon: 'alert-triangle',
    status: 'neutral',
    claim: 'Live altitude data overrides the trend model',
    detail: `trend model: ${trendDays} (tier ${trend.reentryTier}) — current perigee is more pessimistic`,
  };
}

function buildHeadline(risk: ReentryRisk): string {
  if (risk.decaySignal === 'maneuvering') return 'Maneuver signature detected';
  if (risk.estimatedDaysRemaining === null)
    return 'No significant decay detected';
  return `Re-entry expected in ~${risk.estimatedDaysRemaining} days`;
}

function buildConfidenceLine(risk: ReentryRisk): string {
  if (risk.decayConfidence != null) {
    return `${pct(risk.decayConfidence)}% confidence`;
  }
  return `${capitalize(risk.confidence)} confidence`;
}

function characterize(
  risk: ReentryRisk,
  signals: SignalContribution[]
): string {
  if (risk.decaySignal === 'maneuvering') {
    return 'This object shows a probable maneuver signature, with drag behavior inconsistent with passive decay';
  }

  if (risk.estimatedDaysRemaining === null) {
    return 'This object shows no significant orbital decay at this time';
  }

  if (risk.source === 'single_epoch' && risk.decaySignal === 'decaying') {
    return `This object's live perigee of ${Math.round(risk.perigeeKm)}km places it in an active decay regime, ahead of what the trend model has captured`;
  }

  if (signals.length === 0) {
    return 'This object is showing orbital decay';
  }

  const agreeing = signals.filter((s) => s.agrees);
  if (agreeing.length === signals.length) {
    return 'This object is showing sustained orbital decay, with bstar, n-dot, and altitude signals all in agreement';
  }
  if (agreeing.length === 0) {
    return 'This object shows a borderline decay signal, with no individual indicator clearly crossing its threshold';
  }

  const dominant = [...signals].sort(
    (a, b) => b.contribution - a.contribution
  )[0];
  return `This object is showing orbital decay driven primarily by ${SIGNAL_LABEL[dominant.name].toLowerCase()}, with mixed secondary signals`;
}

function evidenceClause(
  risk: ReentryRisk,
  trend: ObjectTrend | undefined
): string {
  const basis =
    trend?.epochsAvailable != null
      ? `Based on ${trend.epochsAvailable} historical epoch${trend.epochsAvailable === 1 ? '' : 's'}`
      : risk.source === 'single_epoch'
        ? 'Based on live altitude data alone'
        : 'Based on limited historical data';

  if (risk.decaySignal === 'maneuvering') {
    return `${basis}, the re-entry estimate is suppressed until the signature clears.`;
  }

  if (risk.estimatedDaysRemaining === null) {
    return `${basis}, there is no re-entry estimate to report.`;
  }

  const confidenceWord = CONFIDENCE_WORD[risk.confidence];
  return `${basis}, estimated re-entry in approximately ${risk.estimatedDaysRemaining} days with ${confidenceWord} confidence.`;
}

function buildSummary(
  risk: ReentryRisk,
  trend: ObjectTrend | undefined,
  signals: SignalContribution[]
): string {
  return `${characterize(risk, signals)}. ${evidenceClause(risk, trend)}`;
}

export function buildReentryTrace({
  risk,
  trend,
  isCurrentModelVersion = true,
}: BuildReentryTraceInput): ReentryTrace {
  const steps: ReentryTraceStep[] = [];
  const signals = trend ? reconstructSignalContributions(trend) : [];

  if (trend) {
    steps.push(loadHistoryStep(trend));
  }

  for (const signal of signals) {
    steps.push(signalStep(signal));
  }

  if (trend) {
    const consensus = consensusStep(trend);
    if (consensus) steps.push(consensus);
  }

  if (trend) {
    const override = overrideStep(risk, trend);
    if (override) steps.push(override);
  }

  steps.push(tierStep(risk));

  const verdict: ReentryVerdict = {
    tier: risk.tier,
    headline: buildHeadline(risk),
    confidenceLine: buildConfidenceLine(risk),
    summary: buildSummary(risk, trend, signals),
  };

  return {
    verdict,
    steps,
    computedAt: trend?.updatedAt ?? null,
    isCurrentModelVersion,
  };
}
