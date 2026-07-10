'use client';

import {
  Check,
  X,
  ShieldCheck,
  ShieldX,
  Target,
  AlertTriangle,
  HelpCircle,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  TraceStepIcon,
  TraceStepStatus,
} from '@/app/dashboard/reentry/[noradId]/lib/buildReentryTrace';

export type TraceStepEmphasis = 'critical' | 'warning' | null;

const ICONS: Record<TraceStepIcon, LucideIcon> = {
  check: Check,
  x: X,
  'shield-check': ShieldCheck,
  'shield-x': ShieldX,
  'target-arrow': Target,
  'alert-triangle': AlertTriangle,
  'help-circle': HelpCircle,
};

// Deliberately neutral: "disagree" means a signal didn't cross its
// threshold, not that something is wrong -- a disagreeing signal on an
// otherwise stable object is good news, not bad. Red/amber are reserved for
// `emphasis`, set only by the caller on the one step that should carry a
// module's actual severity signal (e.g. re-entry's tier line), not baked
// into every evidence step via this status enum.
const STATUS_COLOR: Record<TraceStepStatus, string> = {
  agree: 'text-cyan-400',
  disagree: 'text-gray-500',
  neutral: 'text-gray-400',
};

const EMPHASIS_COLOR: Record<NonNullable<TraceStepEmphasis>, string> = {
  critical: 'text-red-400',
  warning: 'text-amber-400',
};

export interface TraceStepProps {
  icon: TraceStepIcon;
  status: TraceStepStatus;
  claim: string;
  detail: string;
  emphasis?: TraceStepEmphasis;
}

/**
 * One line of a decision trace: an icon, a claim, and the specific number
 * behind it. Generic on purpose -- every DRAKON module's analysis page
 * should be able to render its reasoning as a list of these, re-entry
 * being the first, not the only, consumer.
 */
export function TraceStep({
  icon,
  status,
  claim,
  detail,
  emphasis = null,
}: TraceStepProps) {
  const Icon = ICONS[icon];
  const color = emphasis ? EMPHASIS_COLOR[emphasis] : STATUS_COLOR[status];

  return (
    <div className="flex items-start gap-2.5">
      <Icon
        className={cn('h-4 w-4 mt-0.5 shrink-0', color)}
        aria-hidden="true"
      />
      <p className="text-sm text-gray-200 leading-relaxed">
        {claim}
        <span className="text-gray-500 text-[13px]"> — {detail}</span>
      </p>
    </div>
  );
}
