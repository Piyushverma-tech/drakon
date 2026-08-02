'use client';

import Link from 'next/link';
import { useCallback, useMemo } from 'react';
import {
  ArrowRight,
  Dot,
  Flag,
  History,
  RefreshCw,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { useTleEntriesQuery } from '@/hooks/useTleEntriesQuery';
import { useObjectTrendsQuery } from '@/hooks/useObjectTrendsQuery';
import { useObjectHistoryQuery } from '@/hooks/useObjectHistoryQuery';
import { useObjectSnapshotsQuery } from '@/hooks/useObjectSnapshotsQuery';
import { useMetadataForSatellite } from '@/hooks/useSatelliteMetadata';
import { useOrbitalFrame } from '@/hooks/useOrbitalFrame';
import { formatFlightPathAngleDeg } from '@/lib/orbitalFrame';
import { resolveReentryRisk } from '@/lib/objectTrendRisk';
import { DEFAULT_SOLAR_FLUX_MULTIPLIER } from '@/lib/solarFlux';
import { useAppDispatch } from '@/lib/store';
import {
  selectSingleSatellite,
  setShowReentry,
} from '@/lib/visualization-slice';
import { getOrbitType } from '@/lib/satelliteHelpers';
import { DecisionTrace, TraceStep } from '@/components/DecisionTrace';
import type { TraceStepEmphasis } from '@/components/DecisionTrace';
import { EChart } from '@/components/Charts/Echart';
import { FlightDynamicsCanvas } from '@/components/FlightDynamics';
import { formatAbsoluteUtc, formatRelativeTime } from '../lib/formatTimestamp';
import { buildReentryTrace } from '../lib/buildReentryTrace';
import {
  buildAltitudeChartOption,
  buildBstarChartOption,
} from '../lib/buildReentryChartOptions';
import {
  buildChangeTimeline,
  type ChangeDirection,
} from '../lib/buildChangeTimeline';

const TIER_BADGE: Record<string, string> = {
  critical: 'border-red-500/40 bg-red-500/10 text-red-400',
  warning: 'border-amber-500/40 bg-amber-500/10 text-amber-400',
  nominal: 'border-yellow-500/40 bg-yellow-500/10 text-yellow-300',
  stable: 'border-gray-500/40 bg-gray-500/10 text-gray-400',
};

const TIER_EMPHASIS: Record<string, TraceStepEmphasis> = {
  critical: 'critical',
  warning: 'warning',
};

const DIRECTION_ICON: Record<ChangeDirection, typeof TrendingUp> = {
  escalated: TrendingUp,
  improved: TrendingDown,
  lateral: RefreshCw,
  first: Flag,
};

const DIRECTION_COLOR: Record<ChangeDirection, string> = {
  escalated: 'text-red-400',
  improved: 'text-emerald-400',
  lateral: 'text-gray-500',
  first: 'text-cyan-400',
};

type MetadataRow = {
  label: string;
  value: string | null | undefined;
};

function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—';
  }
  return value.toFixed(digits);
}

function formatKm(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? '—'
    : `${Math.round(value).toLocaleString()} km`;
}

function formatOptionalDate(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.includes('T')) return formatAbsoluteUtc(value);
  return value;
}

export function ReentryAnalysisPage({ noradId }: { noradId: number }) {
  const dispatch = useAppDispatch();
  const {
    data: tleData,
    isLoading: tleLoading,
    isError: tleError,
    error: tleErrorObj,
  } = useTleEntriesQuery();
  const { data: objectTrendsById, isFetching: trendsFetching } =
    useObjectTrendsQuery(true);
  const historyQuery = useObjectHistoryQuery(noradId, 30);
  const snapshotsQuery = useObjectSnapshotsQuery(noradId);
  const metadata = useMetadataForSatellite(noradId);

  const entry = useMemo(
    () => tleData?.entries.find((candidate) => candidate.id === noradId),
    [tleData?.entries, noradId]
  );
  const trend = objectTrendsById?.get(noradId);
  const solarFluxMultiplier =
    tleData?.solarFluxMultiplier ?? DEFAULT_SOLAR_FLUX_MULTIPLIER;

  // Hooks must run unconditionally, before the loading/error early
  // returns below -- entry may still be undefined here, which
  // useOrbitalFrame already treats as "nothing to propagate yet".
  const { orbitalFrame } = useOrbitalFrame({ l1: entry?.l1, l2: entry?.l2 });

  const risk = useMemo(
    () =>
      entry ? resolveReentryRisk(entry, trend, solarFluxMultiplier) : null,
    [entry, trend, solarFluxMultiplier]
  );

  const trace = useMemo(
    () => (risk ? buildReentryTrace({ risk, trend }) : null),
    [risk, trend]
  );

  const altitudeOption = useMemo(
    () => buildAltitudeChartOption(historyQuery.data?.entries ?? []),
    [historyQuery.data]
  );
  const bstarOption = useMemo(
    () => buildBstarChartOption(historyQuery.data?.entries ?? []),
    [historyQuery.data]
  );

  const timeline = useMemo(
    () => buildChangeTimeline(snapshotsQuery.data?.snapshots ?? []),
    [snapshotsQuery.data]
  );

  const handleTrackObject = useCallback(() => {
    dispatch(selectSingleSatellite(noradId));
    dispatch(setShowReentry(true));
  }, [dispatch, noradId]);

  if (tleLoading || trendsFetching) {
    return (
      <div className="max-w-6xl mx-auto p-6 text-sm text-center text-gray-400">
        Loading decision trace…
      </div>
    );
  }

  if (tleError) {
    return (
      <div className="max-w-6xl mx-auto p-6 text-sm text-red-400">
        {tleErrorObj instanceof Error
          ? tleErrorObj.message
          : 'Unable to load satellite data right now.'}
      </div>
    );
  }

  if (!entry || !risk || !trace) {
    return (
      <div className="max-w-3xl mx-auto p-6 text-sm text-gray-400">
        Norad {noradId} is not in the currently tracked catalog.
      </div>
    );
  }

  const badgeClass = TIER_BADGE[trace.verdict.tier] ?? TIER_BADGE.stable;
  const tierEmphasis = TIER_EMPHASIS[trace.verdict.tier] ?? null;
  const displayName =
    entry.name || metadata?.name || metadata?.objectName || `NORAD ${noradId}`;

  const objectType =
    metadata?.objectType ??
    trend?.objectType?.replace('_', ' ').toUpperCase() ??
    (entry.isDebris
      ? 'DEBRIS'
      : getOrbitType(entry.meanMotion, entry.isDebris));

  const periodMinutes =
    metadata?.periodMinutes ??
    (entry.meanMotion > 0 ? 1440 / entry.meanMotion : null);

  const ObjectMetaData: MetadataRow[] = [
    { label: 'Type', value: objectType },
    { label: 'Operator', value: metadata?.operator || entry.operator },
    { label: 'Country', value: metadata?.country ?? metadata?.countryCode },
    { label: 'Perigee', value: formatKm(entry.perigeeKm) },
    { label: 'Period', value: `${formatNumber(periodMinutes, 1)} min` },
    { label: 'Epoch', value: formatOptionalDate(entry.tleEpoch) },
    {
      label: 'Decay rate',
      value: risk.decayRateKmPerDay.toFixed(2) + ' km/day',
    },
  ].filter((row) => row.value && row.value !== '—');

  return (
    <div className="max-w-6xl mx-auto p-6">
      <DecisionTrace
        badge={
          <div className="flex flex-wrap items-center justify-between gap-3 w-full">
            <div className="flex flex-wrap items-center gap-2.5 min-w-0">
              <span
                className={`text-xs font-medium px-2.5 py-0.5 rounded-full border uppercase tracking-wide ${badgeClass}`}
              >
                {trace.verdict.tier}
              </span>
              <span className="text-[13px] font-semibold text-gray-300">
                Norad {noradId}
              </span>
            </div>
            <Link
              href="/globe"
              onClick={handleTrackObject}
              className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-cyan-300 hover:text-cyan-200 border border-cyan-400/30 px-2.5 py-1"
            >
              Track object
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>
        }
        headline={displayName}
        subline={
          <div className="flex flex-col gap-4">
            <div className="text-[14px] text-gray-400 gap-2 flex flex-wrap items-center">
              <div>{trace.verdict.headline}</div>
              <Dot className=" text-gray-400 shrink-0" aria-hidden="true" />
              <div>{trace.verdict.confidenceLine}</div>

              {trace.computedAt && (
                <>
                  <Dot className=" text-gray-400 shrink-0" aria-hidden="true" />
                  <div>
                    {'Trend computed '}
                    {formatRelativeTime(trace.computedAt)}
                  </div>
                </>
              )}

              {trace.computedAt && (
                <>
                  <Dot className=" text-gray-400 shrink-0" aria-hidden="true" />
                  <div>
                    {'Version '}
                    {objectTrendsById?.get(noradId)?.trendVersion}
                  </div>
                </>
              )}
              {!trace.isCurrentModelVersion && (
                <span className="text-amber-400">
                  {' '}
                  · recomputing under a newer model
                </span>
              )}
            </div>
            <span className="flex flex-wrap gap-6 py-4 text-[12px] text-gray-400 border-t border-white/15">
              {ObjectMetaData.map((field) => (
                <span key={field.label} className="whitespace-nowrap space-x-1">
                  <span className="uppercase tracking-wider text-gray-400">
                    {field.label}
                  </span>{' '}
                  <span className="text-gray-300 font-bold tabular-nums">
                    {field.value}
                  </span>
                </span>
              ))}
            </span>
          </div>
        }
        summary={trace.verdict.summary}
        evidence={
          <>
            <div className="flex-1 min-w-[280px]">
              <p className="text-xs text-gray-500 mb-2">Altitude decay</p>
              <EChart
                option={altitudeOption}
                height={240}
                loading={historyQuery.isLoading}
              />
            </div>
            <div className="flex flex-wrap my-6 gap-6">
              <div className="flex-1 min-w-[280px]">
                <p className="text-xs text-gray-500 mb-2">Flight dynamics</p>
                <FlightDynamicsCanvas
                  orbitalFrame={orbitalFrame}
                  heightPx={240}
                />
                <p className="text-[11px] text-gray-500 mt-2">
                  Flight-path angle{' '}
                  <span className="text-gray-300 font-medium tabular-nums">
                    {formatFlightPathAngleDeg(orbitalFrame)}
                  </span>
                </p>
              </div>

              <div className="flex-1 min-w-[280px]">
                <p className="text-xs text-gray-500 mb-2">Bstar trend</p>
                <EChart
                  option={bstarOption}
                  height={240}
                  loading={historyQuery.isLoading}
                />
              </div>
            </div>

            <div className="mt-8 border-t border-white/10 pt-6">
              <p className="text-sm text-gray-500 mb-3 flex items-center gap-1.5">
                <History className="h-3.5 w-3.5" aria-hidden="true" />
                Change logs
              </p>
              {snapshotsQuery.isLoading ? (
                <p className="text-[12px] text-gray-500">Loading…</p>
              ) : timeline.length === 0 ? (
                <p className="text-[12px] text-gray-500">
                  No classification changes recorded yet — this object&apos;s
                  tier and signal have held steady since tracking began.
                </p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {timeline.map((event) => {
                    const Icon = DIRECTION_ICON[event.direction];
                    return (
                      <li key={event.id} className="flex items-start gap-2.5">
                        <Icon
                          className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${DIRECTION_COLOR[event.direction]}`}
                          aria-hidden="true"
                        />
                        <div className="min-w-0">
                          <p className="text-[12px] text-gray-300">
                            {event.headline}
                            <span className="text-gray-500">
                              {' — '}
                              {event.detail}
                            </span>
                          </p>
                          <p className="text-[11px] text-gray-600">
                            {formatRelativeTime(event.capturedAt)}
                            {' · '}
                            {formatAbsoluteUtc(event.capturedAt)}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <p className="text-xs text-center text-gray-500 border-t border-white/10 mt-10 pt-4">
              {trend?.epochsAvailable ?? '—'} epochs
              {' · '}
              {trend?.historyDaysAvailable.toFixed(1) ?? '—'} days history
              {trace.computedAt && (
                <> · trend computed at {formatAbsoluteUtc(trace.computedAt)}</>
              )}
            </p>
          </>
        }
      >
        {trace.steps.map((step, index) => (
          <TraceStep
            key={step.id}
            stage={step.stage}
            icon={step.icon}
            status={step.status}
            claim={step.claim}
            detail={step.detail}
            emphasis={step.id === 'tier' ? tierEmphasis : null}
            isLast={index === trace.steps.length - 1}
          />
        ))}
      </DecisionTrace>
    </div>
  );
}
