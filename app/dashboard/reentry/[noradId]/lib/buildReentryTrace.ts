import {
  reconstructSignalContributions,
  type SignalContribution,
} from '@/lib/explainReentryTrend';
import { ObjectTrend, ReentryRisk } from '@/lib/types';

export type TraceStepIcon =
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
  icon: TraceStepIcon;
  status: TraceStepStatus;
  claim: string;
  detail: string;
}

export interface ReentryVerdict {
  tier: ReentryRisk['tier'];
  headline: string;
  confidenceLine: string;
  /** Only set for critical/warning tiers -- the one-line "why" between the
   * verdict and the trace toggle. Null for stable/nominal. */
  callout: string | null;
}

export interface ReentryTrace {
  verdict: ReentryVerdict;
  steps: ReentryTraceStep[];
  /** Verbatim from the persisted object_trends.updatedAt column. */
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

function signalStep(signal: SignalContribution): ReentryTraceStep {
  const label = SIGNAL_LABEL[signal.name];
  const claim = signal.agrees
    ? signal.name === 'bstar'
      ? `${label} is increasing`
      : signal.name === 'ndot'
        ? `${label} confirms drag acceleration`
        : `${label} is decreasing`
    : `${label} shows no clear trend`;

  return {
    id: `signal-${signal.name}`,
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
      icon: 'alert-triangle',
      status: 'neutral',
      claim: 'Maneuver signature detected',
      detail: 're-entry estimate suppressed',
    };
  }

  if (risk.estimatedDaysRemaining === null) {
    return {
      id: 'tier',
      icon: 'help-circle',
      status: 'neutral',
      claim: 'No re-entry estimate',
      detail: 'insufficient evidence of sustained decay',
    };
  }

  return {
    id: 'tier',
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

function buildCallout(
  risk: ReentryRisk,
  signals: SignalContribution[]
): string | null {
  if (risk.tier !== 'critical' && risk.tier !== 'warning') return null;

  if (risk.source === 'single_epoch' && risk.decaySignal === 'decaying') {
    return 'Object below 220km driven by live altitude data, not the trend model';
  }

  if (signals.length === 0) return null;
  const agreeing = signals.filter((s) => s.agrees);
  if (agreeing.length === signals.length) return 'All signals agree';
  if (agreeing.length === 0) return null;

  const dominant = [...signals].sort(
    (a, b) => b.contribution - a.contribution
  )[0];
  return `Driven primarily by ${SIGNAL_LABEL[dominant.name].toLowerCase()}`;
}

export function buildReentryTrace({
  risk,
  trend,
  isCurrentModelVersion = true,
}: BuildReentryTraceInput): ReentryTrace {
  const steps: ReentryTraceStep[] = [];
  const signals = trend ? reconstructSignalContributions(trend) : [];

  for (const signal of signals) {
    steps.push(signalStep(signal));
  }

  if (trend) {
    const consensus = consensusStep(trend);
    if (consensus) steps.push(consensus);
  }

  steps.push(tierStep(risk));

  if (trend) {
    const override = overrideStep(risk, trend);
    if (override) steps.push(override);
  }

  const verdict: ReentryVerdict = {
    tier: risk.tier,
    headline: buildHeadline(risk),
    confidenceLine: buildConfidenceLine(risk),
    callout: buildCallout(risk, signals),
  };

  return {
    verdict,
    steps,
    computedAt: trend?.updatedAt ?? null,
    isCurrentModelVersion,
  };
}
