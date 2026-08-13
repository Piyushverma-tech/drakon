'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { useMetadataForSatellite } from '@/hooks/useSatelliteMetadata';
import { CornerAccents } from '@/components/MiniGlobe';
import { cn } from '@/lib/utils';
import { classifyOrbit, getOrbitType } from '@/lib/satelliteHelpers';
import { classifyTipFreshness } from '@/lib/tip/tipFreshness';
import type { ReentryRisk, TleEntry } from '@/lib/types';
import { TIER_BADGE } from '../lib/constants';
import { formatConfidence, formatEstimatedDays } from '../lib/formatters';
import { ReentryCountdown } from './ReentryCountdown';

function DetailRow({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 border-b border-white/5 last:border-0">
      <span className="text-[10px] uppercase tracking-widest text-gray-400 shrink-0">
        {label}
      </span>
      <span
        className={`text-[12px] text-right tabular-nums ${
          accent ? 'text-cyan-300' : 'text-gray-200'
        }`}
      >
        {value}
      </span>
    </div>
  );
}

type Props = {
  entry: TleEntry | null;
  risk: ReentryRisk | null;
  tipRefreshedAt?: string | null;
  className?: string;
};

export function ReentryDetailPanel({
  entry,
  risk,
  tipRefreshedAt = null,
  className,
}: Props) {
  const metadata = useMetadataForSatellite(entry?.id ?? null);

  if (!entry || !risk) {
    return (
      <div
        className={cn(
          'relative bg-black/60 border border-white/10 p-4 flex items-center justify-center',
          className
        )}
      >
        <CornerAccents />
        <p className="text-[11px] text-gray-500 uppercase tracking-wider text-center max-w-[220px]">
          Object metadata and re-entry estimate appear here
        </p>
      </div>
    );
  }

  const tier = risk.tier;
  const displayName = entry.name ?? metadata?.name ?? metadata?.objectName;
  const objectType =
    metadata?.objectType ??
    (entry.isDebris
      ? 'DEBRIS'
      : getOrbitType(entry.meanMotion, entry.isDebris));
  const showTrendCountdown =
    risk.source === 'multi_epoch' && Boolean(risk.estimatedReentryAt);
  const showTipCountdown = !showTrendCountdown && Boolean(risk.tip);

  return (
    <div
      className={cn(
        'relative  bg-black/60 border border-gray-400/10 overflow-hidden flex flex-col',
        className
      )}
    >
      <CornerAccents />
      <div className="px-4 pt-4 pb-2 border-b border-white/10 shrink-0 ">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-medium text-gray-100 truncate tracking-widest">
              {displayName}
            </h2>
            <div className="text-[11px] text-gray-500 font-mono tracking-wider mt-0.5">
              NORAD {entry.id}
            </div>
          </div>
          <span
            className={`shrink-0 border px-2 py-0.5 text-[10px] uppercase tracking-wider font-semibold ${TIER_BADGE[tier]}`}
          >
            {tier}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-2 no-scrollbar min-h-0">
        <DetailRow
          label="DRAKON est. re-entry"
          value={formatEstimatedDays(risk.estimatedDaysRemaining)}
          accent={tier === 'critical'}
        />
        {risk.tip && (
          <>
            <DetailRow
              label="TIP est. re-entry"
              value={`${new Date(risk.tip.decayEpoch).toUTCString()} ± ${risk.tip.windowMinutes}min`}
            />
            {classifyTipFreshness(tipRefreshedAt) === 'stale' &&
              tipRefreshedAt && (
                <DetailRow
                  label="TIP data"
                  value={`Stale — last refreshed ${new Date(tipRefreshedAt).toUTCString()}`}
                />
              )}
            <DetailRow
              label="TIP vs DRAKON"
              value={
                risk.tipDeltaDays == null
                  ? 'No comparable estimate'
                  : `${Math.abs(risk.tipDeltaDays)}d ${risk.tipDeltaDays > 0 ? 'later' : 'earlier'} than TIP`
              }
              accent={risk.tipAgreement === 'diverges'}
            />
            {risk.tip.highInterest && (
              <DetailRow label="TIP flag" value="High interest" accent />
            )}
          </>
        )}
        <DetailRow
          label="Decay rate"
          value={`${risk.decayRateKmPerDay.toFixed(2)} km/day`}
        />
        <DetailRow
          label="Perigee"
          value={`${Math.round(risk.perigeeKm)} km`}
          accent
        />
        <DetailRow label="Apogee" value={`${Math.round(entry.apogeeKm)} km`} />
        <DetailRow
          label="Inclination"
          value={`${entry.inclination.toFixed(2)}°`}
        />
        <DetailRow label="Orbit" value={classifyOrbit(entry.inclination)} />
        <DetailRow label="Type" value={objectType} />
        <DetailRow
          label="Confidence"
          value={formatConfidence(risk.confidence)}
        />
        <DetailRow
          label="Source"
          value={
            risk.source === 'multi_epoch' ? 'Multi-epoch trend' : 'Single-epoch'
          }
        />
        <DetailRow
          label="N-dot signal"
          value={risk.signalsAgree ? 'Agrees' : 'No agreement'}
        />
        <DetailRow label="BSTAR" value={risk.bstar.toExponential(2)} />
        <DetailRow
          label="Mean motion Ṅ"
          value={risk.meanMotionDot.toExponential(2)}
        />
        {metadata?.operator && (
          <DetailRow label="Operator" value={metadata.operator} />
        )}
        {metadata?.country && (
          <DetailRow label="Country" value={metadata.country} />
        )}
        {metadata?.launchDate && (
          <DetailRow label="Launch" value={metadata.launchDate} />
        )}
        {metadata?.decayDate && (
          <DetailRow label="Decay date" value={metadata.decayDate} />
        )}
        {risk.estimatedReentryAt && !showTrendCountdown && (
          <DetailRow
            label="Est. at"
            value={new Date(risk.estimatedReentryAt).toUTCString()}
          />
        )}
      </div>

      <div className="px-4 py-3 border-t border-white/10 flex items-center justify-between gap-2 shrink-0">
        {showTrendCountdown && risk.estimatedReentryAt ? (
          <ReentryCountdown targetIso={risk.estimatedReentryAt} />
        ) : showTipCountdown && risk.tip ? (
          <ReentryCountdown
            targetIso={risk.tip.decayEpoch}
            label="TIP predicted re-entry in"
            accentClassName="text-red-400/70"
          />
        ) : (
          <span className="text-[11px] text-gray-500">
            Single-epoch estimate
          </span>
        )}

        <Link
          href={`/dashboard/reentry/${entry.id}`}
          className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wider text-cyan-300/90 hover:text-cyan-300 shrink-0"
        >
          Full analysis
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}
