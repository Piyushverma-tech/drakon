/**
 * Golden fixture generator for the re-entry model.
 *
 * This is Phase 1 of docs/DRAKON_COMPUTE_ENGINE_EXTRACTION_PLAN.md §17:
 * "Before moving code, freeze the behavior of the existing TypeScript
 * implementation as the reference implementation."
 *
 * This script does NOT hand-compute expected outputs. It imports the real
 * production functions and records whatever they actually return for each
 * input. That output becomes the frozen reference: the Python port (Phases
 * 2-4) and the TS/Python parity tests (Phase 5) both have to reproduce it
 * exactly. If a bug is found later, fix the source and regenerate this file
 * deliberately -- never hand-edit the JSON.
 *
 * Run with: npx tsx scripts/generate-reentry-golden-fixtures.ts
 * Output:   fixtures/reentry-model/golden_cases.json
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  altitudeBasedReentryEstimate,
  applyConfidenceCeiling,
  assignReentryTier,
  getReentryRisk,
  getReentryTierThresholds,
  ndotIndicatesDecay,
  parseBSTAR,
} from '../lib/satelliteHelpers';
import {
  explainReentryTrend,
  type ObjectType,
  type RegressionResult,
} from '../lib/explainReentryTrend';
import { resolveReentryRisk } from '../lib/objectTrendRisk';
import type { ObjectTrend, TleEntry } from '../lib/types';

const OUTPUT_PATH = path.join(
  process.cwd(),
  'fixtures',
  'reentry-model',
  'golden_cases.json'
);

// A commit hash, filled in by the caller of this script (kept out of the
// generator itself so re-running it doesn't silently drift the baseline
// pointer). See fixtures/reentry-model/README.md.
const BASELINE_COMMIT = 'bf12871c7e712ac5a555bd354c879044406d8336';

// ---------------------------------------------------------------------------
// Builders — mirror the helpers already used in lib/objectTrendRisk.test.ts
// ---------------------------------------------------------------------------

function makeEntry(overrides: Partial<TleEntry> = {}): TleEntry {
  return {
    id: 25544,
    name: 'TEST PAYLOAD',
    operator: 'TEST',
    l1: ' '.repeat(53) + '50000-6' + ' '.repeat(8),
    l2: '2 25544  51.6000 000.0000 0000000 000.0000 000.0000 16.00000000',
    inclination: 51.6,
    raan: 0,
    argPerigee: 0,
    meanAnomaly: 0,
    meanMotion: 16,
    meanMotionDot: 0.00002182,
    ecc: 0,
    perigeeKm: 180,
    apogeeKm: 195,
    semiMajorAxisKm: 6565,
    tleEpoch: '2026-01-01T00:00:00.000Z',
    isDebris: false,
    ...overrides,
  };
}

function makeTrend(overrides: Partial<ObjectTrend> = {}): ObjectTrend {
  return {
    noradId: 25544,
    updatedAt: '2026-01-01T00:00:00.000Z',
    trendVersion: 4,
    epochsAvailable: 10,
    historyDaysAvailable: 12,
    bstarLatest: 5e-7,
    bstarSlope7d: null,
    bstarSlope14d: null,
    bstarSlope30d: null,
    bstarMean14d: null,
    bstarStddev14d: null,
    bstarRsq14d: null,
    bstarSignalStrength: null,
    perigeeLatest: 180,
    perigeeSlope7d: null,
    perigeeSlope14d: null,
    perigeeSlope30d: null,
    apogeeLatest: null,
    apogeeSlope14d: null,
    smaLatest: null,
    smaSlope7d: null,
    smaSlope14d: null,
    meanMotionDotLatest: null,
    meanMotionDotMean14d: null,
    ndotSignalStrength: null,
    altitudeSignalStrength: null,
    consensusRequired: null,
    consensusMet: null,
    decaySignal: 'decaying',
    maneuverLikelihood: 0,
    decayConfidence: 0.5,
    estimatedDaysRemaining: 30,
    estimatedReentryAt: null,
    reentryTier: 'warning',
    objectType: 'payload',
    isDebris: false,
    ...overrides,
  };
}

const MU_KM3_S2 = 398600.4418;
const EARTH_RADIUS_KM = 6378.137;

/**
 * meanMotion (rev/day) for a circular orbit at the given altitude.
 *
 * getReentryRisk() derives its own decay altitude from entry.meanMotion
 * (estimateAltitudeFromMeanMotion) whenever no explicit currentAltKm is
 * passed -- it does NOT read entry.perigeeKm for that. Any fixture that
 * overrides perigeeKm and cares about the meanMotion-derived decay math
 * must set a matching meanMotion via this helper, or the two numbers will
 * silently disagree (perigeeKm only gates/labels; meanMotion drives the
 * actual decay-rate computation).
 */
function meanMotionForCircularAltitudeKm(altKm: number): number {
  const a = altKm + EARTH_RADIUS_KM;
  const nRadPerSec = Math.sqrt(MU_KM3_S2 / a ** 3);
  return (nRadPerSec * 86400) / (2 * Math.PI);
}

function bstarLine1(raw: string): string {
  // BSTAR sits at columns 53-61 of TLE line 1 -- see parseBSTAR().
  return ' '.repeat(53) + raw.padEnd(8, ' ');
}

function reg(overrides: Partial<NonNullable<RegressionResult>>): RegressionResult {
  return {
    slope: 0,
    rSquared: 0,
    mean: 0,
    stddev: 0,
    n: 10,
    ...overrides,
  };
}

type Case<TInput, TOutput> = {
  id: string;
  description: string;
  input: TInput;
  output: TOutput;
};

function makeCase<TInput, TOutput>(
  id: string,
  description: string,
  input: TInput,
  compute: (input: TInput) => TOutput
): Case<TInput, TOutput> {
  return { id, description, input, output: compute(input) };
}

// ---------------------------------------------------------------------------
// Section 1 — pure numerical primitives (satelliteHelpers.ts)
// Plan §17 Phase 2: "Extract pure mathematical functions first."
// ---------------------------------------------------------------------------

const primitives = {
  parseBSTAR: [
    makeCase(
      'positive_mantissa_positive_exp',
      'Typical positive BSTAR, e.g. 50000-6 -> 0.5 * 10^-6',
      { l1: bstarLine1('50000-6') },
      ({ l1 }) => parseBSTAR(l1)
    ),
    makeCase(
      'negative_mantissa',
      'Negative BSTAR (raising-orbit signal)',
      { l1: bstarLine1('-11606-4') },
      ({ l1 }) => parseBSTAR(l1)
    ),
    makeCase(
      'zero_positive_form',
      'Explicit zero, positive-sign form',
      { l1: bstarLine1('00000-0') },
      ({ l1 }) => parseBSTAR(l1)
    ),
    makeCase(
      'zero_negative_form',
      'Explicit zero, "+0" exponent form',
      { l1: bstarLine1('00000+0') },
      ({ l1 }) => parseBSTAR(l1)
    ),
    makeCase(
      'blank_field',
      'Blank BSTAR field (malformed/short line)',
      { l1: bstarLine1('') },
      ({ l1 }) => parseBSTAR(l1)
    ),
  ],

  ndotIndicatesDecay: [
    makeCase(
      'low_alt_small_positive',
      'Below 400km: small positive Ndot should not indicate decay yet',
      { nDot: 5e-6, decayAltKm: 250 },
      ({ nDot, decayAltKm }) => ndotIndicatesDecay(nDot, decayAltKm)
    ),
    makeCase(
      'low_alt_above_threshold',
      'Below 400km: Ndot above the 1e-5 threshold indicates decay',
      { nDot: 2e-5, decayAltKm: 250 },
      ({ nDot, decayAltKm }) => ndotIndicatesDecay(nDot, decayAltKm)
    ),
    makeCase(
      'mid_alt_band',
      '400-500km band uses the 2e-5 threshold',
      { nDot: 3e-5, decayAltKm: 450 },
      ({ nDot, decayAltKm }) => ndotIndicatesDecay(nDot, decayAltKm)
    ),
    makeCase(
      'high_alt_band',
      'Above 500km uses the loosest 5e-5 threshold (TLE fit noise dominates)',
      { nDot: 6e-5, decayAltKm: 700 },
      ({ nDot, decayAltKm }) => ndotIndicatesDecay(nDot, decayAltKm)
    ),
    makeCase(
      'negative_ndot',
      'Negative Ndot never indicates decay regardless of altitude',
      { nDot: -1e-4, decayAltKm: 250 },
      ({ nDot, decayAltKm }) => ndotIndicatesDecay(nDot, decayAltKm)
    ),
  ],

  getReentryTierThresholds: [
    makeCase('band_le_300', 'Lowest band, flat thresholds', { altKm: 250 }, ({ altKm }) =>
      getReentryTierThresholds(altKm)
    ),
    makeCase(
      'band_300_500_midpoint',
      'Interpolated 300-500km band',
      { altKm: 400 },
      ({ altKm }) => getReentryTierThresholds(altKm)
    ),
    makeCase(
      'band_500_800_midpoint',
      'Interpolated 500-800km band',
      { altKm: 650 },
      ({ altKm }) => getReentryTierThresholds(altKm)
    ),
    makeCase(
      'band_800_1000_midpoint',
      'Interpolated 800-1000km band',
      { altKm: 900 },
      ({ altKm }) => getReentryTierThresholds(altKm)
    ),
    makeCase(
      'band_gt_1000_clamped',
      'Above 1000km, clamped at the 2000km interpolation ceiling',
      { altKm: 2500 },
      ({ altKm }) => getReentryTierThresholds(altKm)
    ),
  ],

  assignReentryTier: [
    makeCase('critical', '10 days at 250km', { days: 10, altKm: 250 }, ({ days, altKm }) =>
      assignReentryTier(days, altKm)
    ),
    makeCase('warning', '60 days at 250km', { days: 60, altKm: 250 }, ({ days, altKm }) =>
      assignReentryTier(days, altKm)
    ),
    makeCase('nominal', '200 days at 250km', { days: 200, altKm: 250 }, ({ days, altKm }) =>
      assignReentryTier(days, altKm)
    ),
    makeCase('stable', '999 days at 250km', { days: 999, altKm: 250 }, ({ days, altKm }) =>
      assignReentryTier(days, altKm)
    ),
  ],

  applyConfidenceCeiling: [
    makeCase(
      'low_confidence_downgrades_critical',
      'confidence < 0.75 downgrades critical to nominal',
      { tier: 'critical' as const, confidence: 0.5 },
      ({ tier, confidence }) => applyConfidenceCeiling(tier, confidence)
    ),
    makeCase(
      'mid_confidence_downgrades_critical_to_warning',
      '0.75 <= confidence < 0.85 downgrades critical to warning only',
      { tier: 'critical' as const, confidence: 0.8 },
      ({ tier, confidence }) => applyConfidenceCeiling(tier, confidence)
    ),
    makeCase(
      'high_confidence_no_change',
      'confidence >= 0.85 leaves tier unchanged',
      { tier: 'critical' as const, confidence: 0.9 },
      ({ tier, confidence }) => applyConfidenceCeiling(tier, confidence)
    ),
    makeCase(
      'stable_always_stable',
      'stable tier is never upgraded regardless of confidence',
      { tier: 'stable' as const, confidence: 0.99 },
      ({ tier, confidence }) => applyConfidenceCeiling(tier, confidence)
    ),
    makeCase(
      'percent_scale_input',
      'confidence passed on a 0-100 scale is normalized',
      { tier: 'critical' as const, confidence: 50 },
      ({ tier, confidence }) => applyConfidenceCeiling(tier, confidence)
    ),
  ],

  altitudeBasedReentryEstimate: [
    makeCase(
      'very_low_altitude_solar_baseline',
      '150km perigee, solar-flux multiplier 1.0',
      { perigeeKm: 150, solarFluxMultiplier: 1.0 },
      ({ perigeeKm, solarFluxMultiplier }) =>
        altitudeBasedReentryEstimate(perigeeKm, solarFluxMultiplier)
    ),
    makeCase(
      'boundary_220km',
      '220km perigee -- acceleration-factor boundary (0.5 vs 2/3)',
      { perigeeKm: 220, solarFluxMultiplier: 1.0 },
      ({ perigeeKm, solarFluxMultiplier }) =>
        altitudeBasedReentryEstimate(perigeeKm, solarFluxMultiplier)
    ),
    makeCase(
      'near_stable_280km',
      '280km perigee, near the point where decay rate goes to ~0',
      { perigeeKm: 280, solarFluxMultiplier: 1.0 },
      ({ perigeeKm, solarFluxMultiplier }) =>
        altitudeBasedReentryEstimate(perigeeKm, solarFluxMultiplier)
    ),
    makeCase(
      'solar_minimum',
      '200km perigee at solar minimum (weak multiplier)',
      { perigeeKm: 200, solarFluxMultiplier: 0.7 },
      ({ perigeeKm, solarFluxMultiplier }) =>
        altitudeBasedReentryEstimate(perigeeKm, solarFluxMultiplier)
    ),
    makeCase(
      'strong_solar_flux',
      '200km perigee at strong solar-max conditions',
      { perigeeKm: 200, solarFluxMultiplier: 2.5 },
      ({ perigeeKm, solarFluxMultiplier }) =>
        altitudeBasedReentryEstimate(perigeeKm, solarFluxMultiplier)
    ),
    makeCase(
      'composed_environmental_multiplier',
      // Current TS resolveReentryRisk()/getReentryRisk()/altitudeBasedReentryEstimate()
      // take ONE atmospheric multiplier; solar-flux and geomagnetic corrections
      // are pre-composed upstream (lib/geomagneticShadow.ts) before this boundary
      // -- see plan §8.3. This case uses the doc's own worked example:
      // solar 1.18 x geomagnetic 0.92.
      '200km perigee with a pre-composed solar x geomagnetic multiplier (1.18 x 0.92)',
      { perigeeKm: 200, solarFluxMultiplier: 1.18 * 0.92 },
      ({ perigeeKm, solarFluxMultiplier }) =>
        altitudeBasedReentryEstimate(perigeeKm, solarFluxMultiplier)
    ),
  ],

  getReentryRisk: [
    makeCase(
      'debris_decaying_positive_bstar',
      'Debris object, meaningfully large positive BSTAR, low altitude -> decaying',
      {
        entry: makeEntry({
          isDebris: true,
          name: 'DEBRIS TEST',
          l1: bstarLine1('50000-4'),
          perigeeKm: 220,
          apogeeKm: 230,
          meanMotion: meanMotionForCircularAltitudeKm(220),
        }),
        solarFluxMultiplier: 1,
      },
      ({ entry, solarFluxMultiplier }) =>
        getReentryRisk(entry, undefined, solarFluxMultiplier)
    ),
    makeCase(
      'debris_raising_orbit_negative_bstar',
      'Debris object with negative BSTAR and negative Ndot -> stable',
      {
        entry: makeEntry({
          isDebris: true,
          name: 'DEBRIS TEST',
          l1: bstarLine1('-11606-4'),
          meanMotionDot: -2e-6,
          perigeeKm: 220,
          apogeeKm: 230,
          meanMotion: meanMotionForCircularAltitudeKm(220),
        }),
        solarFluxMultiplier: 1,
      },
      ({ entry, solarFluxMultiplier }) =>
        getReentryRisk(entry, undefined, solarFluxMultiplier)
    ),
    makeCase(
      'non_debris_always_stable',
      'getReentryRisk() only screens debris -- payloads always come back stable',
      {
        entry: makeEntry({
          isDebris: false,
          name: 'TEST PAYLOAD',
          perigeeKm: 220,
          apogeeKm: 230,
          meanMotion: meanMotionForCircularAltitudeKm(220),
        }),
        solarFluxMultiplier: 1,
      },
      ({ entry, solarFluxMultiplier }) =>
        getReentryRisk(entry, undefined, solarFluxMultiplier)
    ),
    makeCase(
      'high_perigee_sanity_gate',
      'Perigee > 2000km is gated to stable regardless of BSTAR (gate trips on the perigeeKm field itself, before meanMotion-derived altitude is ever computed)',
      {
        entry: makeEntry({
          isDebris: true,
          name: 'DEBRIS TEST',
          perigeeKm: 2200,
          apogeeKm: 2300,
          meanMotion: meanMotionForCircularAltitudeKm(2200),
        }),
        solarFluxMultiplier: 1,
      },
      ({ entry, solarFluxMultiplier }) =>
        getReentryRisk(entry, undefined, solarFluxMultiplier)
    ),
    makeCase(
      'strong_solar_flux_debris',
      'Debris object under a strong solar-flux multiplier -- large enough BSTAR that the multiplier visibly changes the tier',
      {
        entry: makeEntry({
          isDebris: true,
          name: 'DEBRIS TEST',
          l1: bstarLine1('50000-4'),
          perigeeKm: 350,
          apogeeKm: 360,
          meanMotion: meanMotionForCircularAltitudeKm(350),
        }),
        solarFluxMultiplier: 2.5,
      },
      ({ entry, solarFluxMultiplier }) =>
        getReentryRisk(entry, undefined, solarFluxMultiplier)
    ),
  ],
};

// ---------------------------------------------------------------------------
// Section 2 — signal/model functions (explainReentryTrend.ts)
// Plan §17 Phase 3.
// ---------------------------------------------------------------------------

const explainReentryTrendCases = [
  makeCase(
    'clear_decay_full_agreement',
    'BSTAR, Ndot, and altitude all agree on decay -- unambiguous decaying case',
    {
      bstarReg: reg({ slope: 5e-7, rSquared: 0.8, mean: 3e-6, stddev: 1e-7 }),
      ndotReg: reg({ slope: 3e-5, rSquared: 0.7, mean: 2e-5, stddev: 5e-6 }),
      perigeeReg: reg({ slope: -0.5, rSquared: 0.9 }),
      perigeeReg7d: reg({ slope: -0.8, rSquared: 0.85 }),
      smaReg: reg({ slope: -0.4, rSquared: 0.88 }),
      smaReg7d: reg({ slope: -0.7, rSquared: 0.8 }),
      ndotLatest: 3e-5,
      ndotMean14d: 2.5e-5,
      decayAltKm: 300,
      objectType: 'debris' as ObjectType,
      perigeeLatest: 280,
      nowMs: Date.parse('2026-01-01T00:00:00.000Z'),
    },
    (input) => explainReentryTrend(input)
  ),
  makeCase(
    'stable_low_noise',
    'Low, near-flat slopes with a well-populated BSTAR series -> stable',
    {
      bstarReg: reg({ slope: 1e-9, rSquared: 0.1, mean: 1e-7, stddev: 1e-8, n: 8 }),
      ndotReg: reg({ slope: 1e-8, rSquared: 0.05, n: 8 }),
      perigeeReg: reg({ slope: 0.001, rSquared: 0.05 }),
      perigeeReg7d: reg({ slope: 0.001, rSquared: 0.05 }),
      smaReg: reg({ slope: 0.001, rSquared: 0.05 }),
      smaReg7d: reg({ slope: 0.001, rSquared: 0.05 }),
      ndotLatest: 1e-8,
      ndotMean14d: 1e-8,
      decayAltKm: 700,
      objectType: 'payload' as ObjectType,
      perigeeLatest: 690,
      nowMs: Date.parse('2026-01-01T00:00:00.000Z'),
    },
    (input) => explainReentryTrend(input)
  ),
  makeCase(
    'maneuvering_high_bstar_variance',
    'High BSTAR coefficient of variation with weak altitude signal -> maneuvering',
    {
      bstarReg: reg({ slope: 2e-8, rSquared: 0.2, mean: 1e-7, stddev: 3e-7, n: 10 }),
      ndotReg: reg({ slope: 1e-7, rSquared: 0.1 }),
      perigeeReg: reg({ slope: -0.02, rSquared: 0.1 }),
      perigeeReg7d: reg({ slope: -0.02, rSquared: 0.1 }),
      smaReg: reg({ slope: -0.02, rSquared: 0.1 }),
      smaReg7d: reg({ slope: -0.02, rSquared: 0.1 }),
      ndotLatest: 1e-7,
      ndotMean14d: 1e-7,
      decayAltKm: 500,
      objectType: 'payload' as ObjectType,
      perigeeLatest: 480,
      nowMs: Date.parse('2026-01-01T00:00:00.000Z'),
    },
    (input) => explainReentryTrend(input)
  ),
  makeCase(
    'insufficient_data_short_series',
    'Short/weak series that satisfies neither the decaying nor stable threshold',
    {
      bstarReg: reg({ slope: 5e-8, rSquared: 0.2, mean: 1e-7, stddev: 5e-8, n: 3 }),
      ndotReg: null,
      perigeeReg: reg({ slope: -0.05, rSquared: 0.15 }),
      perigeeReg7d: null,
      smaReg: reg({ slope: -0.05, rSquared: 0.15 }),
      smaReg7d: null,
      ndotLatest: null,
      ndotMean14d: null,
      decayAltKm: 600,
      objectType: 'unknown' as ObjectType,
      perigeeLatest: 590,
      nowMs: Date.parse('2026-01-01T00:00:00.000Z'),
    },
    (input) => explainReentryTrend(input)
  ),
  makeCase(
    'contradictory_signals_payload_full_consensus_blocked',
    'Payload at 250-300km requires full consensus; altitude decays but BSTAR/Ndot do not agree',
    {
      bstarReg: reg({ slope: -1e-8, rSquared: 0.3, mean: 1e-7, stddev: 2e-8 }),
      ndotReg: reg({ slope: -1e-6, rSquared: 0.2 }),
      perigeeReg: reg({ slope: -0.3, rSquared: 0.7 }),
      perigeeReg7d: reg({ slope: -0.4, rSquared: 0.7 }),
      smaReg: reg({ slope: -0.3, rSquared: 0.7 }),
      smaReg7d: reg({ slope: -0.4, rSquared: 0.7 }),
      ndotLatest: -1e-6,
      ndotMean14d: -1e-6,
      decayAltKm: 260,
      objectType: 'payload' as ObjectType,
      perigeeLatest: 260,
      nowMs: Date.parse('2026-01-01T00:00:00.000Z'),
    },
    (input) => explainReentryTrend(input)
  ),
  makeCase(
    'below_220km_no_consensus_required',
    'Below 220km, altitude drop alone is sufficient -- no consensus required',
    {
      bstarReg: reg({ slope: -1e-8, rSquared: 0.3, mean: 1e-7, stddev: 2e-8 }),
      ndotReg: reg({ slope: -1e-6, rSquared: 0.2 }),
      perigeeReg: reg({ slope: -0.6, rSquared: 0.9 }),
      perigeeReg7d: reg({ slope: -0.9, rSquared: 0.9 }),
      smaReg: reg({ slope: -0.6, rSquared: 0.9 }),
      smaReg7d: reg({ slope: -0.9, rSquared: 0.9 }),
      ndotLatest: -1e-6,
      ndotMean14d: -1e-6,
      decayAltKm: 200,
      objectType: 'payload' as ObjectType,
      perigeeLatest: 200,
      nowMs: Date.parse('2026-01-01T00:00:00.000Z'),
    },
    (input) => explainReentryTrend(input)
  ),
];

// ---------------------------------------------------------------------------
// Section 3 — resolveReentryRisk() end-to-end (objectTrendRisk.ts)
// Plan §17 Phase 4. Categories per plan §17 Phase 1's required coverage list.
// ---------------------------------------------------------------------------

const resolveReentryRiskCases = [
  makeCase(
    'normal_decaying_debris',
    'Debris object with an actionable, agreeing decaying trend',
    {
      entry: makeEntry({
        id: 40001,
        name: 'DEBRIS TEST',
        isDebris: true,
        perigeeKm: 260,
        apogeeKm: 270,
      }),
      trend: makeTrend({
        noradId: 40001,
        decaySignal: 'decaying',
        reentryTier: 'warning',
        estimatedDaysRemaining: 45,
        decayConfidence: 0.8,
        perigeeLatest: 260,
        bstarSlope14d: 5e-7,
        perigeeSlope14d: -0.5,
        smaSlope14d: -0.4,
        meanMotionDotLatest: 3e-5,
        isDebris: true,
        objectType: 'debris',
      }),
      solarFluxMultiplier: 1,
    },
    ({ entry, trend, solarFluxMultiplier }) =>
      resolveReentryRisk(entry, trend, solarFluxMultiplier)
  ),
  makeCase(
    'stable_debris_no_actionable_signal',
    'Debris object whose trend is flat/stable',
    {
      entry: makeEntry({
        id: 40002,
        name: 'DEBRIS TEST',
        isDebris: true,
        perigeeKm: 500,
        apogeeKm: 520,
      }),
      trend: makeTrend({
        noradId: 40002,
        decaySignal: 'stable',
        reentryTier: 'stable',
        estimatedDaysRemaining: null,
        decayConfidence: 0.9,
        perigeeLatest: 500,
        isDebris: true,
        objectType: 'debris',
      }),
      solarFluxMultiplier: 1,
    },
    ({ entry, trend, solarFluxMultiplier }) =>
      resolveReentryRisk(entry, trend, solarFluxMultiplier)
  ),
  makeCase(
    'low_altitude_no_trend_single_epoch',
    'No trend row at all -- pure altitude-driven single-epoch fallback',
    {
      entry: makeEntry({ id: 40003, perigeeKm: 180, apogeeKm: 195 }),
      trend: undefined,
      solarFluxMultiplier: 1,
    },
    ({ entry, trend, solarFluxMultiplier }) =>
      resolveReentryRisk(entry, trend, solarFluxMultiplier)
  ),
  makeCase(
    'heo_object',
    'Highly eccentric orbit (apogee >> perigee) -- gated stable regardless of everything else',
    {
      entry: makeEntry({
        id: 40004,
        name: 'HEO TEST',
        perigeeKm: 500,
        apogeeKm: 35000,
        meanMotion: 2,
      }),
      trend: undefined,
      solarFluxMultiplier: 1,
    },
    ({ entry, trend, solarFluxMultiplier }) =>
      resolveReentryRisk(entry, trend, solarFluxMultiplier)
  ),
  makeCase(
    'raising_orbit_negative_ndot',
    'Negative Ndot below the -1e-6 raising-orbit threshold -> stable regardless of BSTAR',
    {
      entry: makeEntry({
        id: 40005,
        perigeeKm: 200,
        apogeeKm: 210,
        meanMotionDot: -2e-6,
      }),
      trend: undefined,
      solarFluxMultiplier: 1,
    },
    ({ entry, trend, solarFluxMultiplier }) =>
      resolveReentryRisk(entry, trend, solarFluxMultiplier)
  ),
  makeCase(
    'raising_orbit_negative_bstar_and_ndot',
    'Negative BSTAR combined with any negative Ndot -> stable',
    {
      entry: makeEntry({
        id: 40006,
        perigeeKm: 200,
        apogeeKm: 210,
        l1: bstarLine1('-11606-4'),
        meanMotionDot: -1e-7,
      }),
      trend: undefined,
      solarFluxMultiplier: 1,
    },
    ({ entry, trend, solarFluxMultiplier }) =>
      resolveReentryRisk(entry, trend, solarFluxMultiplier)
  ),
  makeCase(
    'maneuver_like_behavior_payload',
    'Payload with a "maneuvering" trend read at low altitude -- short-circuits before altitude fallback',
    {
      entry: makeEntry({ id: 40007, perigeeKm: 180, apogeeKm: 195 }),
      trend: makeTrend({
        noradId: 40007,
        decaySignal: 'maneuvering',
        maneuverLikelihood: 0.8,
        epochsAvailable: 6,
      }),
      solarFluxMultiplier: 1,
    },
    ({ entry, trend, solarFluxMultiplier }) =>
      resolveReentryRisk(entry, trend, solarFluxMultiplier)
  ),
  makeCase(
    'contradictory_trend_signals_above_threshold',
    'Perigee above the debris/payload threshold, actionable trend, but signals do not all agree',
    {
      entry: makeEntry({ id: 40008, perigeeKm: 400, apogeeKm: 420 }),
      trend: makeTrend({
        noradId: 40008,
        decaySignal: 'decaying',
        reentryTier: 'nominal',
        estimatedDaysRemaining: 120,
        decayConfidence: 0.4,
        perigeeLatest: 400,
        bstarSlope14d: -1e-8, // disagrees
        perigeeSlope14d: -0.3, // agrees
        smaSlope14d: -0.3, // agrees
        meanMotionDotLatest: -1e-6, // disagrees
        isDebris: false,
        objectType: 'payload',
      }),
      solarFluxMultiplier: 1,
    },
    ({ entry, trend, solarFluxMultiplier }) =>
      resolveReentryRisk(entry, trend, solarFluxMultiplier)
  ),
  makeCase(
    'trend_more_pessimistic_than_altitude',
    'Actionable trend estimate is sooner than the altitude fallback -- trend wins (source: multi_epoch)',
    {
      entry: makeEntry({ id: 40009 }),
      trend: makeTrend({
        noradId: 40009,
        decaySignal: 'decaying',
        epochsAvailable: 10,
        historyDaysAvailable: 12,
        reentryTier: 'critical',
        estimatedDaysRemaining: 1,
        decayConfidence: 0.9,
        perigeeLatest: 180,
      }),
      solarFluxMultiplier: 1,
    },
    ({ entry, trend, solarFluxMultiplier }) =>
      resolveReentryRisk(entry, trend, solarFluxMultiplier)
  ),
  makeCase(
    'altitude_overrides_too_calm_trend',
    'Thin/noisy low-confidence trend read is overridden by the altitude fallback (source: single_epoch)',
    {
      entry: makeEntry({ id: 40010 }),
      trend: makeTrend({
        noradId: 40010,
        decaySignal: 'decaying',
        epochsAvailable: 5,
        historyDaysAvailable: 4,
        reentryTier: 'nominal',
        estimatedDaysRemaining: 45,
        decayConfidence: 0.3,
        perigeeLatest: 180,
      }),
      solarFluxMultiplier: 1,
    },
    ({ entry, trend, solarFluxMultiplier }) =>
      resolveReentryRisk(entry, trend, solarFluxMultiplier)
  ),
  makeCase(
    'strong_solar_flux_debris_single_epoch',
    'Debris object above the actionable-trend path, resolved via getReentryRisk() under strong solar flux -- large enough BSTAR that the multiplier visibly changes the tier',
    {
      entry: makeEntry({
        id: 40011,
        name: 'DEBRIS TEST',
        isDebris: true,
        l1: bstarLine1('50000-4'),
        perigeeKm: 350,
        apogeeKm: 360,
        meanMotion: meanMotionForCircularAltitudeKm(350),
      }),
      trend: undefined,
      solarFluxMultiplier: 2.5,
    },
    ({ entry, trend, solarFluxMultiplier }) =>
      resolveReentryRisk(entry, trend, solarFluxMultiplier)
  ),
  makeCase(
    'composed_environmental_multiplier_debris',
    // See the note on 'composed_environmental_multiplier' in the primitives
    // section above: solar and geomagnetic corrections are pre-composed
    // upstream of this call in the current TS implementation.
    'Debris object with a pre-composed solar x geomagnetic multiplier (1.18 x 0.92), same BSTAR as strong_solar_flux_debris_single_epoch for a direct comparison',
    {
      entry: makeEntry({
        id: 40012,
        name: 'DEBRIS TEST',
        isDebris: true,
        l1: bstarLine1('50000-4'),
        perigeeKm: 350,
        apogeeKm: 360,
        meanMotion: meanMotionForCircularAltitudeKm(350),
      }),
      trend: undefined,
      solarFluxMultiplier: 1.18 * 0.92,
    },
    ({ entry, trend, solarFluxMultiplier }) =>
      resolveReentryRisk(entry, trend, solarFluxMultiplier)
  ),
  makeCase(
    'insufficient_data_non_debris',
    'Perigee above threshold, no debris, no actionable trend -> stable by default',
    {
      entry: makeEntry({ id: 40013, perigeeKm: 500, apogeeKm: 520 }),
      trend: makeTrend({
        noradId: 40013,
        epochsAvailable: 2, // below MIN_EPOCHS_FOR_TREND -> not actionable
        historyDaysAvailable: 0.5,
        decaySignal: 'insufficient_data',
        estimatedDaysRemaining: null,
        reentryTier: 'stable',
        decayConfidence: 0.05,
      }),
      solarFluxMultiplier: 1,
    },
    ({ entry, trend, solarFluxMultiplier }) =>
      resolveReentryRisk(entry, trend, solarFluxMultiplier)
  ),
];

// ---------------------------------------------------------------------------
// Assemble + write
// ---------------------------------------------------------------------------

async function main() {
  const payload = {
    $comment:
      'GENERATED FILE. Produced by scripts/generate-reentry-golden-fixtures.ts from ' +
      'the real production TypeScript re-entry model. Do not hand-edit -- regenerate ' +
      'deliberately when the reference implementation changes, and record why in ' +
      'fixtures/reentry-model/README.md.',
    generatedAt: new Date().toISOString(),
    baselineCommit: BASELINE_COMMIT,
    sourceModules: [
      'lib/satelliteHelpers.ts',
      'lib/explainReentryTrend.ts',
      'lib/objectTrendRisk.ts',
    ],
    primitives,
    explainReentryTrend: explainReentryTrendCases,
    resolveReentryRisk: resolveReentryRiskCases,
  };

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 2) + '\n', 'utf-8');

  const total =
    Object.values(primitives).reduce((sum, arr) => sum + arr.length, 0) +
    explainReentryTrendCases.length +
    resolveReentryRiskCases.length;

  console.log(`Wrote ${total} golden cases to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
