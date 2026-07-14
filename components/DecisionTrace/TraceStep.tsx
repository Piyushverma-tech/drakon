'use client';

import {
  Check,
  X,
  ShieldCheck,
  ShieldX,
  Target,
  AlertTriangle,
  HelpCircle,
  Database,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  TraceStepIcon,
  TraceStepStatus,
} from '@/app/dashboard/reentry/[noradId]/lib/buildReentryTrace';

export type TraceStepEmphasis = 'critical' | 'warning' | null;

const ICONS: Record<TraceStepIcon, LucideIcon> = {
  database: Database,
  check: Check,
  x: X,
  'shield-check': ShieldCheck,
  'shield-x': ShieldX,
  'target-arrow': Target,
  'alert-triangle': AlertTriangle,
  'help-circle': HelpCircle,
};

const STATUS_COLOR: Record<TraceStepStatus, string> = {
  agree: 'text-cyan-400 border-cyan-400/40',
  disagree: 'text-gray-500 border-white/15',
  neutral: 'text-gray-400 border-white/15',
};

const EMPHASIS_COLOR: Record<NonNullable<TraceStepEmphasis>, string> = {
  critical: 'text-red-400 border-red-400/50',
  warning: 'text-amber-400 border-amber-400/50',
};

export interface TraceStepProps {
  stage: string;
  icon: TraceStepIcon;
  status: TraceStepStatus;
  claim: string;
  detail: string;
  emphasis?: TraceStepEmphasis;
  /** Suppresses the connector line below this node -- set on the last
   * step in a trace. */
  isLast?: boolean;
}

export function TraceStep({
  stage,
  icon,
  status,
  claim,
  detail,
  emphasis = null,
  isLast = false,
}: TraceStepProps) {
  const Icon = ICONS[icon];
  const colorClasses = emphasis
    ? EMPHASIS_COLOR[emphasis]
    : STATUS_COLOR[status];

  return (
    <div className="relative flex gap-3.5 pb-6 last:pb-0">
      {!isLast && (
        <div
          className="absolute left-[13px] top-7 bottom-0 w-px bg-white/10"
          aria-hidden="true"
        />
      )}
      <div
        className={cn(
          'relative z-10 flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border bg-black',
          colorClasses
        )}
      >
        <Icon
          className={cn('h-3 w-3', colorClasses.split(' ')[0])}
          aria-hidden="true"
        />
      </div>
      <div className="pt-0.5 min-w-0">
        <p className="text-[10.5px] font-semibold uppercase tracking-wider text-gray-500">
          {stage}
        </p>
        <p className="text-sm text-gray-200 leading-relaxed mt-0.5">
          {claim}
          <span className="text-gray-500 text-[13px]"> — {detail}</span>
        </p>
      </div>
    </div>
  );
}
