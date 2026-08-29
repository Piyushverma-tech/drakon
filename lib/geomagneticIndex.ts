/**
 * Geomagnetic environmental signal — NOAA Kp ingestion, canonical Kp-class
 * normalization, the published Kp -> ap conversion, the lagged activity
 * feature, and the (uncalibrated) empirical multiplier.
 *
 * The live planetary_k_index_1m.json schema (plan §6.1) has been confirmed
 * against a real response — see the schema note above extractRawKp().
 *
 * SCOPE (Stage 2 — shadow mode, GEOMAGNETIC_STORM_REENTRY_PLAN.md §21):
 * this module now also computes the activity feature and a proposed
 * multiplier, and persists rolling Kp/ap history to Redis. The multiplier
 * this module exposes is deliberately UNCALIBRATED (see the constants
 * below) — Stage 2 exists to calculate and record what the correction
 * would do, not to apply it. lib/geomagneticShadow.ts is the module that
 * performs that shadow comparison; nothing in the production risk path
 * (satelliteHelpers.ts, objectTrendRisk.ts, the dashboard, or /api/tle)
 * has been changed to consume this module's multiplier.
 *
 * Deliberately NOT implemented yet (do not add until the rollout plan
 * advances past Stage 2):
 *   - calibrated multiplier parameters fitted against storm/control
 *     history (plan §17, Stage 3)
 *   - wiring the combined multiplier into getReentryRisk() /
 *     altitudeBasedReentryEstimate() / resolveReentryRisk() call sites
 *     used by the live app (plan §13, Stage 4)
 *   - Decision Trace / dashboard / `/api/tle` header surfacing (plan §14)
 *
 * NOAA-specific parsing, Kp normalization, the Kp -> ap conversion, the
 * activity feature, and the multiplier must stay isolated in this file
 * and must not leak into satelliteHelpers.ts or objectTrendRisk.ts (plan
 * §7, §24, engineering invariant #11). This module must not own
 * ReentryRisk resolution (plan §7) — see geomagneticShadow.ts for the one
 * place that is allowed to know about both.
 */

import redis from './redis';

// ---------------------------------------------------------------------------
// 1. Published Kp -> ap lookup (Bartels/IAGA, 28 classes)
//
// Source: NOAA NCEI Magnetic Activity Indices
// (https://www.ngdc.noaa.gov/geomag/indices/kp_ap.html), reproduced by NASA
// NTRS (https://ntrs.nasa.gov/citations/19700022692). This is a standards
// conversion, not a DRAKON calibration parameter (plan §5.3) — changing
// this table requires a deliberate scientific-review decision, not
// ordinary model tuning. Do not fit, interpolate, or "improve" it.
// ---------------------------------------------------------------------------

export const KP_CLASSES = [
  '0o', '0+',
  '1-', '1o', '1+',
  '2-', '2o', '2+',
  '3-', '3o', '3+',
  '4-', '4o', '4+',
  '5-', '5o', '5+',
  '6-', '6o', '6+',
  '7-', '7o', '7+',
  '8-', '8o', '8+',
  '9-', '9o',
] as const;

export type KpClass = (typeof KP_CLASSES)[number];

export const KP_TO_AP_TABLE: Readonly<Record<KpClass, number>> = Object.freeze({
  '0o': 0, '0+': 2,
  '1-': 3, '1o': 4, '1+': 5,
  '2-': 6, '2o': 7, '2+': 9,
  '3-': 12, '3o': 15, '3+': 18,
  '4-': 22, '4o': 27, '4+': 32,
  '5-': 39, '5o': 48, '5+': 56,
  '6-': 67, '6o': 80, '6+': 94,
  '7-': 111, '7o': 132, '7+': 154,
  '8-': 179, '8o': 207, '8+': 236,
  '9-': 300, '9o': 400,
});

/**
 * Canonical one-third-step numeric encoding for each class
 * (0o=0.00, 0+=0.33, 1-=0.67, 1o=1.00, ... 9o=9.00). Used to normalize a
 * raw numeric Kp value (plan §5.2, "the one-third-step convention").
 */
const KP_NUMERIC_STEP = 1 / 3;

const KP_CLASS_TO_NUMERIC: Readonly<Record<KpClass, number>> = Object.freeze(
  Object.fromEntries(
    KP_CLASSES.map((cls, i) => [cls, i * KP_NUMERIC_STEP])
  ) as Record<KpClass, number>
);

/** Match tolerance for a raw numeric Kp value against the 1/3-step grid. */
const KP_NUMERIC_TOLERANCE = 0.05;

/**
 * Some historical NOAA text products encode the third-step suffix with
 * letters rather than symbols (Z = "o"/zero, P = "+", M = "-").
 * Ref: https://community.spaceweatherlive.com/topic/1095-swpc-1-minute-kp-index/
 * ("3Z means 3-zero or 3.0, 3P means 3+ or 3.33, 3M means 3- or 2.66").
 * Included so a provider payload using this convention normalizes cleanly
 * instead of being silently rejected — see the verification note on
 * NoaaKpEntry below regarding what the *current* JSON feed actually sends.
 */
const LEGACY_LETTER_SUFFIX: Readonly<Record<string, string>> = Object.freeze({
  Z: 'o',
  P: '+',
  M: '-',
});

/**
 * Normalize a raw provider Kp value (numeric one-third-step encoding,
 * canonical "4+"/"4o"/"4-" string, or legacy "4Z"/"4P"/"4M" string) into
 * one of the 28 canonical Bartels/IAGA classes.
 *
 * Returns null if the value cannot be unambiguously normalized — per plan
 * §5.2, an ambiguous or out-of-range sample must be rejected, never
 * approximated (e.g. rounded to the nearest integer Kp).
 */
export function normalizeKpClass(raw: unknown): KpClass | null {
  if (raw === null || raw === undefined) return null;

  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return null;

    const canonical = trimmed.match(/^([0-9])([oO+-])$/);
    if (canonical) {
      const [, digit, suffixRaw] = canonical;
      const suffix = suffixRaw.toLowerCase() === 'o' ? 'o' : suffixRaw;
      const candidate = `${digit}${suffix}` as KpClass;
      return (KP_CLASSES as readonly string[]).includes(candidate)
        ? candidate
        : null;
    }

    const legacy = trimmed.match(/^([0-9])([ZPMzpm])$/);
    if (legacy) {
      const [, digit, suffixRaw] = legacy;
      const suffix = LEGACY_LETTER_SUFFIX[suffixRaw.toUpperCase()];
      const candidate = `${digit}${suffix}` as KpClass;
      return (KP_CLASSES as readonly string[]).includes(candidate)
        ? candidate
        : null;
    }

    const numeric = Number(trimmed);
    return Number.isFinite(numeric) ? normalizeKpClass(numeric) : null;
  }

  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw < 0 || raw > 9) return null;

    let closest: KpClass | null = null;
    let closestDelta = Infinity;
    for (const cls of KP_CLASSES) {
      const delta = Math.abs(KP_CLASS_TO_NUMERIC[cls] - raw);
      if (delta < closestDelta) {
        closestDelta = delta;
        closest = cls;
      }
    }
    return closestDelta <= KP_NUMERIC_TOLERANCE ? closest : null;
  }

  return null;
}

/**
 * Pure Kp -> ap lookup, as specified in plan §5.1.
 *
 * Accepts a raw Kp value (numeric or string, any of the encodings handled
 * by normalizeKpClass) and returns the published three-hour ap equivalent.
 * Throws if the value cannot be unambiguously normalized to one of the 28
 * published classes — this function does not approximate. Callers reading
 * untrusted provider data should treat a thrown error the same as any
 * other malformed-sample condition (fail-soft table, plan §16): reject
 * the sample, do not let the error propagate into risk resolution.
 */
export function kpToAp(kp: number | string): number {
  const kpClass = normalizeKpClass(kp);
  if (kpClass === null) {
    throw new Error(
      `kpToAp: unable to normalize Kp value "${String(kp)}" to a canonical Bartels/IAGA class`
    );
  }
  return KP_TO_AP_TABLE[kpClass];
}

// ---------------------------------------------------------------------------
// 2. Three-hour interval semantics (plan §6.2-6.3)
// ---------------------------------------------------------------------------

export type NoaaKpSample = {
  /** ISO 8601 UTC timestamp of this individual (minute-cadence) sample. */
  observedAt: string;
  kpClass: KpClass;
  /**
   * ap looked up from kpClass via the published Bartels/IAGA table. Named
   * "estimated" because kpClass itself comes from NOAA's real-time
   * *estimated* Kp (the live planetary_k_index_1m.json feed), not the
   * later-adjudicated definitive Kp/ap that GFZ Potsdam publishes for the
   * same interval. Do not present this as the official ap value.
   */
  estimatedAp: number;
};

export type ThreeHourApObservation = {
  /** Start of the three-hour UTC interval (00, 03, ..., 21), ISO 8601. */
  intervalStart: string;
  kpClass: KpClass;
  /** See NoaaKpSample.estimatedAp — same caveat applies here. */
  estimatedAp: number;
  /** Timestamp of the specific sample chosen to represent this interval. */
  observedAt: string;
};

/** Floor an ISO timestamp to the start of its three-hour UTC interval. */
export function threeHourIntervalStart(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) {
    throw new Error(
      `threeHourIntervalStart: invalid timestamp "${isoTimestamp}"`
    );
  }
  const flooredHour = Math.floor(date.getUTCHours() / 3) * 3;
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      flooredHour,
      0,
      0,
      0
    )
  ).toISOString();
}

/**
 * Reduce raw per-minute NOAA Kp samples into one effective ap observation
 * per three-hour interval (plan §6.3). For each interval this prefers the
 * latest valid sample rather than numerically averaging Kp, because Kp is
 * quasi-logarithmic and averaging the class values directly is not a valid
 * linear operation (plan §4, "Why ap is an intermediate representation").
 * Also serves as the timestamp-deduplication step from plan §6.2 point 5.
 */
export function reduceToThreeHourApObservations(
  samples: NoaaKpSample[]
): ThreeHourApObservation[] {
  const byInterval = new Map<string, NoaaKpSample>();

  for (const sample of samples) {
    let intervalStart: string;
    try {
      intervalStart = threeHourIntervalStart(sample.observedAt);
    } catch {
      continue; // malformed timestamp -> reject sample
    }

    const existing = byInterval.get(intervalStart);
    if (
      !existing ||
      new Date(sample.observedAt).getTime() >
        new Date(existing.observedAt).getTime()
    ) {
      byInterval.set(intervalStart, sample);
    }
  }

  return Array.from(byInterval.entries())
    .map(([intervalStart, sample]) => ({
      intervalStart,
      kpClass: sample.kpClass,
      estimatedAp: sample.estimatedAp,
      observedAt: sample.observedAt,
    }))
    .sort((a, b) => a.intervalStart.localeCompare(b.intervalStart));
}

// ---------------------------------------------------------------------------
// 3. NOAA ingestion (plan §6.1)
// ---------------------------------------------------------------------------

export const NOAA_PLANETARY_KP_URL =
  'https://services.swpc.noaa.gov/json/planetary_k_index_1m.json';

/**
 * Confirmed live schema (sampled 2026-08-23) — one entry per minute:
 *
 * ```json
 * {
 *   "time_tag": "2026-08-23T12:59:00",
 *   "kp_index": 1,
 *   "estimated_kp": 0.67,
 *   "kp": "1M"
 * }
 * ```
 *
 * `time_tag` is a *naive* UTC timestamp — no "Z", no offset. See toIsoUtc()
 * below; parsing it directly would be read as local time and silently
 * corrupt three-hour interval bucketing.
 *
 * Three redundant representations of the same Kp value are present, and
 * they are not interchangeable:
 *   - `kp` ("1M") is NOAA's own canonical class, letter-coded (Z/P/M for
 *     o/+/-). This confirms the legacy letter convention documented above
 *     is real, not just a historical curiosity. Most authoritative — no
 *     computation needed to reach a canonical class.
 *   - `estimated_kp` (0.67) is the precise one-third-step numeric value.
 *     Good cross-check against `kp`.
 *   - `kp_index` (1) is a *rounded integer* — NOAA collapses 1-/1o/1+ to
 *     "1" for this field. It must NOT be used as a value source: doing so
 *     silently rounds every subdivided class to its nearest whole-number
 *     class, exactly the failure mode plan §5.2 forbids ("must not
 *     silently round arbitrary Kp to the nearest integer"). It is ignored
 *     here entirely.
 */
type NoaaKpEntry = Record<string, unknown>;

/**
 * NOAA's time_tag has no zone suffix but is UTC. Mirrors the equivalent
 * fix in lib/tip/spacetrackTip.ts (toIsoUtc) for Space-Track's naive
 * timestamps. Accepts an already-zoned string unchanged, in case the live
 * format ever adds one.
 */
function toIsoUtc(timeTag: string): Date {
  const hasZone = /Z$|[+-]\d{2}:?\d{2}$/.test(timeTag);
  return new Date(hasZone ? timeTag : `${timeTag}Z`);
}

function extractRawKp(
  entry: unknown
): { observedAt: unknown; kp: unknown; estimatedKp: unknown } | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const record = entry as NoaaKpEntry;

  const observedAt = record.time_tag;
  if (observedAt === undefined) return null;

  // kp_index deliberately excluded — see the schema note above.
  return { observedAt, kp: record.kp, estimatedKp: record.estimated_kp };
}

/**
 * Parse one raw NOAA feed entry into a normalized sample, or null to
 * reject it (malformed payload / unrecognized Kp class / non-finite ap —
 * plan §16 fail-soft table). Rejection is per-entry: one bad row does not
 * invalidate the rest of the batch.
 *
 * When both `kp` and `estimated_kp` are present, they must normalize to
 * the same canonical class; a disagreement is treated as a malformed
 * sample and rejected rather than guessed at (plan §1's "scientifically
 * conservative" mandate, §5.2's "reject rather than approximate").
 */
export function parseNoaaKpEntry(entry: unknown): NoaaKpSample | null {
  const extracted = extractRawKp(entry);
  if (!extracted) return null;

  const { observedAt, kp, estimatedKp } = extracted;
  if (typeof observedAt !== 'string') return null;

  const date = toIsoUtc(observedAt);
  if (Number.isNaN(date.getTime())) return null;

  const kpClassFromLetter =
    typeof kp === 'string' || typeof kp === 'number'
      ? normalizeKpClass(kp)
      : null;
  const kpClassFromNumeric =
    typeof estimatedKp === 'string' || typeof estimatedKp === 'number'
      ? normalizeKpClass(estimatedKp)
      : null;

  let kpClass: KpClass | null;
  if (kpClassFromLetter !== null && kpClassFromNumeric !== null) {
    if (kpClassFromLetter !== kpClassFromNumeric) return null; // disagreement -> reject
    kpClass = kpClassFromLetter;
  } else {
    kpClass = kpClassFromLetter ?? kpClassFromNumeric;
  }
  if (kpClass === null) return null;

  let ap: number;
  try {
    ap = kpToAp(kpClass);
  } catch {
    return null;
  }
  if (!Number.isFinite(ap) || ap < 0) return null;

  return { observedAt: date.toISOString(), kpClass, estimatedAp: ap };
}

/** Parse the full raw planetary_k_index_1m.json payload into samples. */
export function parseNoaaKpPayload(payload: unknown): NoaaKpSample[] {
  if (!Array.isArray(payload)) return [];

  const samples: NoaaKpSample[] = [];
  for (const rawEntry of payload) {
    const sample = parseNoaaKpEntry(rawEntry);
    if (sample) samples.push(sample);
  }
  return samples;
}

/**
 * Fetch and parse the live NOAA planetary Kp feed, reduced to one ap
 * observation per completed three-hour interval.
 *
 * Stage 1 scope only (plan §21): no multiplier, no Redis persistence, no
 * activity feature, no application integration. Returns an empty array on
 * any fetch/parse failure — callers must treat an empty result as "no
 * data available," never as "quiet conditions" (ap = 0 is itself a valid
 * observation and must not be confused with an absent one).
 */
export async function fetchNoaaThreeHourApObservations(): Promise<
  ThreeHourApObservation[]
> {
  let res: Response;
  try {
    res = await fetch(NOAA_PLANETARY_KP_URL, { cache: 'no-store' });
  } catch {
    return [];
  }
  if (!res.ok) return [];

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    return [];
  }

  return reduceToThreeHourApObservations(parseNoaaKpPayload(payload));
}

// ---------------------------------------------------------------------------
// 4. Independent-reference comparison (plan §6.4, §21 Stage 1)
//
// Development/validation utility only — not a runtime dependency. Lets
// DRAKON's generated three-hour ap series be diffed against an independent
// source (GFZ Kp/ap nowcast, CelesTrak space-weather data) before Stage 2
// proceeds.
// ---------------------------------------------------------------------------

export type ApSeriesComparisonRow = {
  intervalStart: string;
  /** DRAKON's own estimated ap for this interval — see ThreeHourApObservation.estimatedAp. */
  generatedAp: number | null;
  /** The independent source's ap value for this interval (treated as ground truth for this comparison). */
  referenceAp: number | null;
  /** Absolute difference, or null if either side is missing for this interval. */
  delta: number | null;
  matches: boolean;
};

export function compareApSeries(
  generated: ThreeHourApObservation[],
  reference: Array<{ intervalStart: string; ap: number }>
): ApSeriesComparisonRow[] {
  const generatedByInterval = new Map(
    generated.map((o) => [o.intervalStart, o.estimatedAp])
  );
  const referenceByInterval = new Map(
    reference.map((o) => [o.intervalStart, o.ap])
  );

  const allIntervals = new Set([
    ...generatedByInterval.keys(),
    ...referenceByInterval.keys(),
  ]);

  return Array.from(allIntervals)
    .sort()
    .map((intervalStart) => {
      const generatedAp = generatedByInterval.get(intervalStart) ?? null;
      const referenceAp = referenceByInterval.get(intervalStart) ?? null;
      const delta =
        generatedAp !== null && referenceAp !== null
          ? Math.abs(generatedAp - referenceAp)
          : null;

      return {
        intervalStart,
        generatedAp,
        referenceAp,
        delta,
        matches: delta !== null && delta === 0,
      };
    });
}

export type ApSeriesComparisonMetrics = {
  /** Intervals present on both the generated and reference series. */
  intervalsCompared: number;
  /** Intervals DRAKON produced an estimate for but the reference has no value for. */
  intervalsGeneratedOnly: number;
  /** Intervals the reference has a value for but DRAKON produced no estimate. */
  intervalsReferenceOnly: number;
  exactMatches: number;
  /** exactMatches / intervalsCompared. 0 if nothing was compared. */
  exactMatchRate: number;
  meanAbsoluteError: number | null;
  maxAbsoluteError: number | null;
  rootMeanSquareError: number | null;
};

/**
 * Reduce a compareApSeries() result to summary metrics (plan §6.4, §21
 * Stage 1's "compare the generated ap series against independent
 * references"). Coverage gaps (an interval present on only one side) are
 * counted separately and excluded from the error metrics rather than
 * silently treated as a zero-error match or a large error against an
 * assumed zero.
 */
export function computeApSeriesComparisonMetrics(
  rows: ApSeriesComparisonRow[]
): ApSeriesComparisonMetrics {
  let intervalsCompared = 0;
  let intervalsGeneratedOnly = 0;
  let intervalsReferenceOnly = 0;
  let exactMatches = 0;
  let sumAbsError = 0;
  let sumSquaredError = 0;
  let maxAbsError = 0;

  for (const row of rows) {
    if (row.generatedAp !== null && row.referenceAp !== null) {
      intervalsCompared++;
      const absError = Math.abs(row.generatedAp - row.referenceAp);
      sumAbsError += absError;
      sumSquaredError += absError * absError;
      maxAbsError = Math.max(maxAbsError, absError);
      if (row.matches) exactMatches++;
    } else if (row.generatedAp !== null) {
      intervalsGeneratedOnly++;
    } else if (row.referenceAp !== null) {
      intervalsReferenceOnly++;
    }
  }

  return {
    intervalsCompared,
    intervalsGeneratedOnly,
    intervalsReferenceOnly,
    exactMatches,
    exactMatchRate: intervalsCompared > 0 ? exactMatches / intervalsCompared : 0,
    meanAbsoluteError: intervalsCompared > 0 ? sumAbsError / intervalsCompared : null,
    maxAbsoluteError: intervalsCompared > 0 ? maxAbsError : null,
    rootMeanSquareError:
      intervalsCompared > 0 ? Math.sqrt(sumSquaredError / intervalsCompared) : null,
  };
}

// ---------------------------------------------------------------------------
// 5. Calibration parameters (plan §10.1)
//
// *** ALL VALUES BELOW ARE UNCALIBRATED PLACEHOLDERS ***
//
// They exist so Stage 2 shadow mode has a concrete multiplier to compute
// and record. None of them have been fitted against storm/control history
// (plan §17). GEOMAG_MODEL_VERSION = 0 marks this pre-calibration state —
// Stage 3 must replace these with evidence-based values and bump the
// version before Stage 4 production integration is considered. Do not
// treat any output of this module as a validated correction until then.
// ---------------------------------------------------------------------------

/** 0 = uncalibrated Stage 2 shadow placeholder. Bump once Stage 3 fits real parameters. */
export const GEOMAG_MODEL_VERSION = 0;

/** ap; quiet-activity floor below which the multiplier is exactly 1.0. PLACEHOLDER. */
export const GEOMAG_ACTIVITY_THRESHOLD = 9;

/** ap; denominator of the power-law input. PLACEHOLDER. */
export const GEOMAG_SCALE = 100;

/** Exponent p in `1 + A*(x/scale)^p`; must stay in (0, 1) per plan §10. PLACEHOLDER. */
export const GEOMAG_POWER = 0.5;

/** Amplitude A in `1 + A*(x/scale)^p`. PLACEHOLDER. */
export const GEOMAG_AMPLITUDE = 0.5;

/** Hard safety ceiling (plan §11) — biased toward under-correction. PLACEHOLDER. */
export const MAX_GEOMAG_MULTIPLIER = 1.4;

/** Rolling history retention window. Covers the 24h analytical window plus calibration headroom (plan §8). */
export const GEOMAG_HISTORY_HOURS = 48;

/** τ in the recency weighting `exp(-age/τ)` (plan §9.1). PLACEHOLDER. */
export const GEOMAG_DECAY_CONSTANT_HOURS = 12;

// ---------------------------------------------------------------------------
// 6. Activity feature construction (plan §9)
// ---------------------------------------------------------------------------

export type StormPhase = 'quiet' | 'rising' | 'sustained' | 'recovering';

/**
 * Recency-weighted activity feature (plan §9.1):
 * `activity = Σ(estimatedAp_i × w_i) / Σ(w_i)`, `w_i = exp(-age_i / τ)`.
 * Age is measured from each sample's actual observedAt, not its
 * intervalStart bucket boundary — a sample observed near the end of its
 * three-hour interval is materially fresher information than the bucket
 * start would suggest, and understating its freshness would make the
 * decay weighting lag real conditions by up to ~3 hours.
 * Returns null when there is no usable history — callers must treat that
 * as "no signal," not as "zero activity."
 */
export function computeRecencyWeightedActivity(
  history: ThreeHourApObservation[],
  nowMs: number = Date.now(),
  tauHours: number = GEOMAG_DECAY_CONSTANT_HOURS
): number | null {
  if (history.length === 0) return null;

  let weightedSum = 0;
  let weightSum = 0;
  for (const obs of history) {
    const ageHours = (nowMs - new Date(obs.observedAt).getTime()) / 3_600_000;
    if (!Number.isFinite(ageHours) || ageHours < 0) continue;

    const weight = Math.exp(-ageHours / tauHours);
    weightedSum += obs.estimatedAp * weight;
    weightSum += weight;
  }

  if (weightSum <= 0) return null;
  const activity = weightedSum / weightSum;
  return Number.isFinite(activity) ? activity : null;
}

/**
 * Persistence descriptor (plan §9.2): fraction of recent intervals above
 * the quiet threshold. Windowed by each sample's observedAt for the same
 * freshness reason as computeRecencyWeightedActivity above. Diagnostic
 * only in the first implementation — not fed into the multiplier (plan
 * §9.2, "may use persistence only as a diagnostic feature rather than
 * introducing another fitted coefficient").
 */
export function computePersistence(
  history: ThreeHourApObservation[],
  nowMs: number = Date.now(),
  quietThresholdAp: number = GEOMAG_ACTIVITY_THRESHOLD,
  windowHours: number = GEOMAG_HISTORY_HOURS
): number | null {
  const cutoffMs = nowMs - windowHours * 3_600_000;
  const recent = history.filter(
    (obs) => new Date(obs.observedAt).getTime() >= cutoffMs
  );
  if (recent.length === 0) return null;

  const activeCount = recent.filter(
    (obs) => obs.estimatedAp > quietThresholdAp
  ).length;
  return activeCount / recent.length;
}

/**
 * Coarse storm-phase classification (plan §9.3) over the trailing ~12
 * hours (windowed by observedAt, same freshness reasoning as above; the
 * earlier/later split is still ordered by intervalStart so the bucket
 * sequence — not raw observation time — determines rising vs falling).
 * Diagnostic/calibration input only — the production multiplier depends
 * on the smoothed activity level, not this derivative-like signal (plan
 * §9.3: "should not be allowed to dominate the production multiplier
 * until historical validation demonstrates a stable benefit").
 */
export function classifyStormPhase(
  history: ThreeHourApObservation[],
  nowMs: number = Date.now(),
  quietThresholdAp: number = GEOMAG_ACTIVITY_THRESHOLD
): StormPhase {
  const recent = history
    .filter((obs) => nowMs - new Date(obs.observedAt).getTime() <= 12 * 3_600_000)
    .sort((a, b) => a.intervalStart.localeCompare(b.intervalStart));

  if (recent.length === 0) return 'quiet';

  const maxAp = Math.max(...recent.map((o) => o.estimatedAp));
  if (maxAp <= quietThresholdAp) return 'quiet';

  const midpoint = Math.ceil(recent.length / 2);
  const earlier = recent.slice(0, midpoint);
  const later = recent.slice(midpoint);
  if (later.length === 0) return 'rising'; // not enough history yet to compare

  const earlierMean =
    earlier.reduce((sum, o) => sum + o.estimatedAp, 0) / earlier.length;
  const laterMean =
    later.reduce((sum, o) => sum + o.estimatedAp, 0) / later.length;

  if (laterMean > earlierMean * 1.15) return 'rising';
  if (laterMean < earlierMean * 0.85) return 'recovering';
  return 'sustained';
}

// ---------------------------------------------------------------------------
// 7. Empirical multiplier + composition (plan §10-12)
// ---------------------------------------------------------------------------

/**
 * Sub-linear power-law multiplier (plan §10): `1` at/below the quiet
 * threshold, `1 + A*((activity - threshold) / scale)^p` above it, clamped
 * to `[1, MAX_GEOMAG_MULTIPLIER]`. Falls back to exactly `1.0` on missing
 * or non-finite input (plan §16: "Invalid activity calculation ->
 * Multiplier = 1.0"). Every parameter here is a Stage-2 placeholder — see
 * the calibration-parameters block above.
 */
export function geomagneticMultiplierFromActivity(
  activity: number | null
): number {
  if (activity === null || !Number.isFinite(activity)) return 1.0;
  if (activity <= GEOMAG_ACTIVITY_THRESHOLD) return 1.0;

  const x = (activity - GEOMAG_ACTIVITY_THRESHOLD) / GEOMAG_SCALE;
  const raw = 1 + GEOMAG_AMPLITUDE * Math.pow(x, GEOMAG_POWER);

  if (!Number.isFinite(raw)) return 1.0;
  return Math.min(Math.max(raw, 1.0), MAX_GEOMAG_MULTIPLIER);
}

/**
 * Single centralized composition point (plan §12, engineering invariant
 * #12): `combinedMultiplier = solarFluxMultiplier * geomagneticMultiplier`.
 * Degrades to solar-only (never to 1.0, never throws) if the geomagnetic
 * side is missing or invalid — a broken environmental signal should not
 * be able to make the atmospheric correction worse than "no correction."
 */
export function combineAtmosphericMultipliers(
  solarFluxMultiplier: number,
  geomagneticMultiplier: number
): number {
  if (!Number.isFinite(solarFluxMultiplier) || solarFluxMultiplier <= 0) {
    return Number.isFinite(geomagneticMultiplier) && geomagneticMultiplier >= 1
      ? geomagneticMultiplier
      : 1.0;
  }
  if (!Number.isFinite(geomagneticMultiplier) || geomagneticMultiplier < 1.0) {
    return solarFluxMultiplier;
  }

  const combined = solarFluxMultiplier * geomagneticMultiplier;
  return Number.isFinite(combined) ? combined : solarFluxMultiplier;
}

// ---------------------------------------------------------------------------
// 8. Redis storage and freshness (plan §8)
// ---------------------------------------------------------------------------

export const GEOMAGNETIC_LATEST_REDIS_KEY = 'geomagnetic:latest';
export const GEOMAGNETIC_HISTORY_REDIS_KEY = 'geomagnetic:history';

/** Live sample window — plan §8 suggests "on the order of 1-3 hours". */
export const GEOMAGNETIC_LATEST_TTL_SECONDS = 2 * 3_600;

/** Protective lifetime — long enough to survive a temporary NOAA/Redis outage without erasing the last usable storm state (plan §8). */
export const GEOMAGNETIC_HISTORY_TTL_SECONDS = GEOMAG_HISTORY_HOURS * 3_600;

const LIVE_FRESHNESS_THRESHOLD_MINUTES = GEOMAGNETIC_LATEST_TTL_SECONDS / 60;

export type GeomagneticFreshness = 'live' | 'stale' | 'default';

/** Suggested state contract from plan §7, extended with the diagnostic fields from §9. */
export type GeomagneticState = {
  kp: number | null;
  kpClass: KpClass | null;
  /** See NoaaKpSample.estimatedAp — this is DRAKON's real-time estimate, not the official adjudicated ap. */
  estimatedAp: number | null;
  observedAt: string | null;
  ageMinutes: number | null;
  history: ThreeHourApObservation[];
  activity: number | null;
  persistence: number | null;
  stormPhase: StormPhase;
  multiplier: number;
  source: 'noaa-swpc';
  freshness: GeomagneticFreshness;
  modelVersion: number;
};

function defaultGeomagneticState(): GeomagneticState {
  return {
    kp: null,
    kpClass: null,
    estimatedAp: null,
    observedAt: null,
    ageMinutes: null,
    history: [],
    activity: null,
    persistence: null,
    stormPhase: 'quiet',
    multiplier: 1.0,
    source: 'noaa-swpc',
    freshness: 'default',
    modelVersion: GEOMAG_MODEL_VERSION,
  };
}

/**
 * Merge freshly fetched three-hour ap observations into existing rolling
 * history. Incoming wins on a same-interval conflict (NOAA revises the
 * current, not-yet-complete interval as new minute samples arrive), and
 * the result is trimmed to GEOMAG_HISTORY_HOURS.
 */
export function mergeApHistory(
  existing: ThreeHourApObservation[],
  incoming: ThreeHourApObservation[],
  nowMs: number = Date.now()
): ThreeHourApObservation[] {
  const byInterval = new Map<string, ThreeHourApObservation>();
  for (const obs of existing) byInterval.set(obs.intervalStart, obs);
  for (const obs of incoming) byInterval.set(obs.intervalStart, obs);

  const cutoffMs = nowMs - GEOMAG_HISTORY_HOURS * 3_600_000;
  return Array.from(byInterval.values())
    .filter((obs) => new Date(obs.intervalStart).getTime() >= cutoffMs)
    .sort((a, b) => a.intervalStart.localeCompare(b.intervalStart));
}

/**
 * Fetch NOAA, merge into the rolling Redis history, and refresh the
 * live-sample key. Idempotent; safe to call on a schedule (plan §15
 * recommends hourly). A fetch/parse failure leaves the last validated
 * Redis state completely untouched (plan §15, §16) — this function
 * returns null rather than writing anything in that case.
 */
export async function refreshGeomagneticIndexInRedis(): Promise<{
  latest: ThreeHourApObservation;
  historyLength: number;
} | null> {
  const observations = await fetchNoaaThreeHourApObservations();
  if (observations.length === 0) return null;

  let existingHistory: ThreeHourApObservation[] = [];
  try {
    existingHistory =
      (await redis.get<ThreeHourApObservation[]>(
        GEOMAGNETIC_HISTORY_REDIS_KEY
      )) ?? [];
  } catch {
    existingHistory = [];
  }

  const merged = mergeApHistory(existingHistory, observations);
  const latest = merged[merged.length - 1];
  if (!latest) return null;

  await Promise.all([
    redis.set(GEOMAGNETIC_LATEST_REDIS_KEY, latest, {
      ex: GEOMAGNETIC_LATEST_TTL_SECONDS,
    }),
    redis.set(GEOMAGNETIC_HISTORY_REDIS_KEY, merged, {
      ex: GEOMAGNETIC_HISTORY_TTL_SECONDS,
    }),
  ]);

  return { latest, historyLength: merged.length };
}

/**
 * Read the current geomagnetic state: live/stale/default freshness,
 * rolling history, activity feature, and the (uncalibrated) multiplier.
 * Fail-soft throughout (plan §16) — any Redis error or absent state
 * degrades to the default state with multiplier exactly 1.0, never throws.
 */
/**
 * Pure core of GeomagneticState construction: given a chosen "latest"
 * sample, the history to derive activity/persistence/storm-phase from,
 * the freshness the caller has already determined, and the instant to
 * evaluate as-of, compute every derived field. getGeomagneticState()
 * (live, Redis-backed) and buildReplayGeomagneticState() (historical
 * replay) both delegate here so there is exactly one implementation of
 * "history -> derived state" — not two that could quietly drift apart.
 */
function deriveGeomagneticState(
  effectiveLatest: ThreeHourApObservation,
  history: ThreeHourApObservation[],
  freshness: GeomagneticFreshness,
  nowMs: number
): GeomagneticState {
  const observedAtMs = new Date(effectiveLatest.observedAt).getTime();
  const ageMinutes = Number.isFinite(observedAtMs)
    ? (nowMs - observedAtMs) / 60_000
    : null;

  const activity = computeRecencyWeightedActivity(history, nowMs);
  const persistence = computePersistence(history, nowMs);
  const stormPhase = classifyStormPhase(history, nowMs);
  const multiplier = geomagneticMultiplierFromActivity(activity);

  return {
    kp: KP_CLASS_TO_NUMERIC[effectiveLatest.kpClass] ?? null,
    kpClass: effectiveLatest.kpClass,
    estimatedAp: effectiveLatest.estimatedAp,
    observedAt: effectiveLatest.observedAt,
    ageMinutes,
    history,
    activity,
    persistence,
    stormPhase,
    multiplier,
    source: 'noaa-swpc',
    freshness,
    modelVersion: GEOMAG_MODEL_VERSION,
  };
}

/**
 * Build a GeomagneticState for a historical replay — no Redis involved.
 * Treats the supplied history as fully trusted (freshness fixed to
 * 'live') since a replay isn't about real-time staleness; the run's
 * source/replayLabel in geomagneticShadowStore.ts is what marks this as
 * historical, not the freshness field.
 *
 * `asOfMs` is the instant to replay as-of. Only observations with
 * observedAt <= asOfMs are used — this is deliberate: a replay must not
 * let information from after the replay instant leak into the activity
 * weighting or storm-phase classification (look-ahead bias), even though
 * the full history array the caller has on hand may contain later samples.
 */
export function buildReplayGeomagneticState(
  history: ThreeHourApObservation[],
  asOfMs: number
): GeomagneticState {
  const eligible = history.filter(
    (obs) => new Date(obs.observedAt).getTime() <= asOfMs
  );
  if (eligible.length === 0) return defaultGeomagneticState();

  const effectiveLatest = eligible.reduce((latest, obs) =>
    new Date(obs.observedAt).getTime() > new Date(latest.observedAt).getTime()
      ? obs
      : latest
  );

  return deriveGeomagneticState(effectiveLatest, eligible, 'live', asOfMs);
}

/**
 * Read the current geomagnetic state: live/stale/default freshness,
 * rolling history, activity feature, and the (uncalibrated) multiplier.
 * Fail-soft throughout (plan §16) — any Redis error or absent state
 * degrades to the default state with multiplier exactly 1.0, never throws.
 */
export async function getGeomagneticState(
  nowMs: number = Date.now()
): Promise<GeomagneticState> {
  let latest: ThreeHourApObservation | null = null;
  let history: ThreeHourApObservation[] = [];

  try {
    latest = await redis.get<ThreeHourApObservation>(
      GEOMAGNETIC_LATEST_REDIS_KEY
    );
  } catch {
    latest = null;
  }

  try {
    history =
      (await redis.get<ThreeHourApObservation[]>(
        GEOMAGNETIC_HISTORY_REDIS_KEY
      )) ?? [];
  } catch {
    history = [];
  }

  // Stale fallback: the short-TTL "latest" key expired but the
  // longer-lived history is still usable (plan §8: "A stale state may
  // continue to use the last validated history-derived multiplier").
  const effectiveLatest = latest ?? history[history.length - 1] ?? null;
  if (!effectiveLatest) return defaultGeomagneticState();

  const observedAtMs = new Date(effectiveLatest.observedAt).getTime();
  const ageMinutes = Number.isFinite(observedAtMs)
    ? (nowMs - observedAtMs) / 60_000
    : null;

  const freshness: GeomagneticFreshness =
    latest !== null &&
    ageMinutes !== null &&
    ageMinutes <= LIVE_FRESHNESS_THRESHOLD_MINUTES
      ? 'live'
      : 'stale';

  return deriveGeomagneticState(effectiveLatest, history, freshness, nowMs);
}
