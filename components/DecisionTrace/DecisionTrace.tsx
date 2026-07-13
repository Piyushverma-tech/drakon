'use client';

import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

export interface DecisionTraceProps {
  badge: ReactNode;
  headline: string;
  subline?: ReactNode;
  callout?: ReactNode;
  /** Reasoning steps, in order -- TraceStep elements. */
  children: ReactNode;
  evidence?: ReactNode;
  defaultExpanded?: boolean;
}

export function DecisionTrace({
  badge,
  headline,
  subline,
  callout,
  children,
  evidence,
  defaultExpanded = false,
}: DecisionTraceProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className="">
      <div className="flex items-center gap-2.5">{badge}</div>
      <p className="text-lg font-medium text-gray-100 mt-2">{headline}</p>
      {subline && <div className="text-sm text-gray-400">{subline}</div>}

      {callout && (
        <div className="flex items-start gap-2 px-3 py-2.5 bg-white/5 rounded-lg mb-8">
          {callout}
        </div>
      )}

      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex items-center gap-1 text-[13px] text-cyan-300 hover:text-cyan-200 mb-4 cursor-pointer"
        aria-expanded={expanded}
      >
        {expanded ? 'Hide decision trace' : 'Show decision trace'}
        {expanded ? (
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
        ) : (
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        )}
      </button>

      {expanded && (
        <div className=" bg-white/5 px-3 py-2.5 rounded-lg pt-4 flex flex-col gap-3.5">
          {children}
        </div>
      )}

      {evidence && (
        <div className="border-t border-white/10 mt-4 pt-4">{evidence}</div>
      )}
    </div>
  );
}
