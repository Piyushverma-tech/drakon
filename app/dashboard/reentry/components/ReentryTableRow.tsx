import { memo } from 'react';
import { cn } from '@/lib/utils';
import type { ReentryRisk, TleEntry } from '@/lib/types';
import {
  type ReentryTier,
  TIER_BADGE,
  TIER_COLOR,
  TIER_ROW_BG,
} from '../lib/constants';
import { formatEstimatedDays } from '../lib/formatters';

type Props = {
  rank: number;
  entry: TleEntry | undefined;
  risk: ReentryRisk;
  selected: boolean;
  onSelect: (satId: number) => void;
};

export const ReentryTableRow = memo(function ReentryTableRow({
  rank,
  entry,
  risk,
  selected,
  onSelect,
}: Props) {
  const tier = risk.tier as ReentryTier;

  return (
    <tr
      role="button"
      tabIndex={0}
      onClick={() => onSelect(risk.satId)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(risk.satId);
        }
      }}
      className={cn(
        'border-b border-white/5 transition-colors cursor-pointer outline-none',
        TIER_ROW_BG[tier],
        selected
          ? 'bg-cyan-500/10 ring-1 ring-inset ring-cyan-400/40'
          : 'hover:bg-cyan-500/5'
      )}
    >
      <td className="px-3 py-2.5 text-gray-500 tabular-nums text-[11px] font-mono">
        {rank}
      </td>
      <td className="px-3 py-2.5 max-w-[200px]">
        <span className="text-gray-200 text-[12px] truncate block">
          {entry?.name ?? `#${risk.satId}`}
        </span>
        {risk.source === 'multi_epoch' && (
          <span className="text-[9px] text-cyan-400/60 uppercase tracking-wider">
            {risk.epochsAvailable ?? 0} epochs
          </span>
        )}
      </td>
      <td className="px-3 py-2.5">
        <span className="font-mono text-[11px] text-white/60 bg-white/5 border border-white/10 px-1.5 py-0.5 tracking-wider">
          #{risk.satId}
        </span>
      </td>
      <td className="px-3 py-2.5">
        <span
          className={`inline-flex items-center border px-2 py-0.5 text-[10px] uppercase tracking-wider font-semibold ${TIER_BADGE[tier]}`}
        >
          {tier}
        </span>
      </td>
      <td
        className={`px-3 py-2.5 font-mono tabular-nums text-[13px] font-medium ${TIER_COLOR[tier]}`}
      >
        {formatEstimatedDays(risk.estimatedDaysRemaining)}
      </td>
      <td className="px-3 py-2.5 font-mono tabular-nums text-[12px] text-gray-300">
        {risk.decayRateKmPerDay.toFixed(2)}
        <span className="text-gray-500 text-[10px] ml-0.5">km/d</span>
      </td>
      <td className="px-3 py-2.5 font-mono tabular-nums text-[12px] text-cyan-300">
        {Math.round(risk.perigeeKm)}
        <span className="text-gray-500 text-[10px] ml-0.5">km</span>
      </td>
      <td className="px-3 py-2.5">
        <span
          className={cn(
            'text-[11px] capitalize',
            risk.confidence === 'high'
              ? 'text-cyan-300'
              : risk.confidence === 'medium'
                ? 'text-gray-300'
                : 'text-gray-500'
          )}
        >
          {risk.confidence}
        </span>
      </td>
      <td className="px-3 py-2.5">
        <span
          className={cn(
            'text-[10px] uppercase tracking-wider',
            risk.source === 'multi_epoch' ? 'text-cyan-400' : 'text-gray-500'
          )}
        >
          {risk.source === 'multi_epoch' ? 'trend' : 'single'}
        </span>
      </td>
      <td className="px-3 py-2.5">
        <span
          className={cn(
            'text-[11px]',
            risk.signalsAgree ? 'text-emerald-400' : 'text-gray-500'
          )}
        >
          {risk.signalsAgree ? 'agrees' : '—'}
        </span>
      </td>
      <td className="px-3 py-2.5 font-mono text-[11px] text-gray-500 tabular-nums">
        {risk.bstar.toExponential(1)}
      </td>
    </tr>
  );
});
