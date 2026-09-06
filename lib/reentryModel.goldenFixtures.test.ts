/**
 * Freezes the current re-entry model's behavior against
 * fixtures/reentry-model/golden_cases.json.
 *
 * This is the TypeScript half of docs/DRAKON_COMPUTE_ENGINE_EXTRACTION_PLAN.md
 * §17 Phase 1 / §22 "Golden tests". The Python port (Phases 2-4) will load
 * the same JSON file and assert the same outputs -- see backend/tests/.
 *
 * If this test starts failing because the *reference* implementation
 * changed on purpose, that's a real model-behavior change: regenerate the
 * fixture deliberately (`npx tsx scripts/generate-reentry-golden-fixtures.ts`),
 * record why in fixtures/reentry-model/README.md, and treat it as a
 * model-version bump per plan §18 -- don't just silently accept a new
 * fixture file to make this test green again.
 */
import goldenFixtures from '../fixtures/reentry-model/golden_cases.json';
import {
  altitudeBasedReentryEstimate,
  applyConfidenceCeiling,
  assignReentryTier,
  getReentryRisk,
  getReentryTierThresholds,
  ndotIndicatesDecay,
  parseBSTAR,
} from './satelliteHelpers';
import {
  altitudeSignalStrength,
  bstarSignalStrength,
  classifyDecaySignal,
  computeManeuverLikelihood,
  explainReentryTrend,
  ndotSignalStrength,
  partialConsensusRequired,
  payloadConsensusRequired,
  type ObjectType,
  type RegressionResult,
} from './explainReentryTrend';
import { allSignalsAgreeFromSlopes } from './reentrySignals';
import { resolveReentryRisk } from './objectTrendRisk';
import type { ObjectTrend, ReentryRisk, TleEntry } from './types';

type ExplainReentryTrendInput = Parameters<typeof explainReentryTrend>[0];

type ResolveReentryRiskInput = {
  entry: TleEntry;
  /** Omitted in JSON when the generator passed `undefined`. */
  trend?: ObjectTrend;
  solarFluxMultiplier: number;
};

type GoldenCase<TInput> = {
  id: string;
  input: TInput;
  output: unknown;
};

type PrimitiveInputs = {
  parseBSTAR: { l1: string };
  ndotIndicatesDecay: { nDot: number; decayAltKm: number };
  getReentryTierThresholds: { altKm: number };
  assignReentryTier: { days: number; altKm: number };
  applyConfidenceCeiling: {
    tier: ReentryRisk['tier'];
    confidence: number;
  };
  altitudeBasedReentryEstimate: {
    perigeeKm: number;
    solarFluxMultiplier: number;
  };
  getReentryRisk: { entry: TleEntry; solarFluxMultiplier: number };
};

type ReentryTrendHelperInputs = {
  bstarSignalStrength: { bstarReg: RegressionResult };
  ndotSignalStrength: {
    ndotReg: RegressionResult;
    ndotLatest: number | null;
    decayAltKm: number;
  };
  altitudeSignalStrength: {
    perigeeReg: RegressionResult;
    smaReg: RegressionResult;
  };
  computeManeuverLikelihood: {
    bstarReg: RegressionResult;
    altitudeSignal: number;
  };
  classifyDecaySignal: {
    bstarReg: RegressionResult;
    ndotReg: RegressionResult;
    perigeeReg: RegressionResult;
    smaReg: RegressionResult;
    ndotLatest: number | null;
    decayAltKm: number;
  };
  payloadConsensusRequired: {
    objectType: ObjectType;
    perigeeLatest: number | null;
  };
  partialConsensusRequired: { perigeeLatest: number | null };
  allSignalsAgreeFromSlopes: Parameters<typeof allSignalsAgreeFromSlopes>[0];
};

// Round-trip through JSON the same way the fixture generator did, so Date
// objects, NaN/Infinity edge cases, and key ordering compare the same way
// they were frozen.
function normalize<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value));
}

function describePrimitiveFixtures<K extends keyof PrimitiveInputs>(
  group: K,
  fn: (input: PrimitiveInputs[K]) => unknown
) {
  // JSON module types are structural literals; bridge via unknown to our
  // PrimitiveInputs map (same shape, but TleEntry / tier unions differ).
  const cases = goldenFixtures.primitives[group] as unknown as GoldenCase<
    PrimitiveInputs[K]
  >[];

  describe(group, () => {
    it.each(cases.map((c) => [c.id, c]))('%s', (_id, testCase) => {
      expect(normalize(fn(testCase.input))).toEqual(testCase.output);
    });
  });
}

function describeReentryTrendHelperFixtures<
  K extends keyof ReentryTrendHelperInputs,
>(group: K, fn: (input: ReentryTrendHelperInputs[K]) => unknown) {
  const cases = goldenFixtures.reentryTrendHelpers[
    group
  ] as unknown as GoldenCase<ReentryTrendHelperInputs[K]>[];

  describe(group, () => {
    it.each(cases.map((c) => [c.id, c]))('%s', (_id, testCase) => {
      expect(normalize(fn(testCase.input))).toEqual(testCase.output);
    });
  });
}

describe('re-entry model golden fixtures — primitives (satelliteHelpers.ts)', () => {
  describePrimitiveFixtures('parseBSTAR', ({ l1 }) => parseBSTAR(l1));
  describePrimitiveFixtures('ndotIndicatesDecay', ({ nDot, decayAltKm }) =>
    ndotIndicatesDecay(nDot, decayAltKm)
  );
  describePrimitiveFixtures('getReentryTierThresholds', ({ altKm }) =>
    getReentryTierThresholds(altKm)
  );
  describePrimitiveFixtures('assignReentryTier', ({ days, altKm }) =>
    assignReentryTier(days, altKm)
  );
  describePrimitiveFixtures('applyConfidenceCeiling', ({ tier, confidence }) =>
    applyConfidenceCeiling(tier, confidence)
  );
  describePrimitiveFixtures(
    'altitudeBasedReentryEstimate',
    ({ perigeeKm, solarFluxMultiplier }) =>
      altitudeBasedReentryEstimate(perigeeKm, solarFluxMultiplier)
  );
  describePrimitiveFixtures(
    'getReentryRisk',
    ({ entry, solarFluxMultiplier }) =>
      getReentryRisk(entry, undefined, solarFluxMultiplier)
  );
});

describe('re-entry model golden fixtures — explainReentryTrend/reentrySignals sub-functions', () => {
  describeReentryTrendHelperFixtures('bstarSignalStrength', ({ bstarReg }) =>
    bstarSignalStrength(bstarReg)
  );
  describeReentryTrendHelperFixtures(
    'ndotSignalStrength',
    ({ ndotReg, ndotLatest, decayAltKm }) =>
      ndotSignalStrength(ndotReg, ndotLatest, decayAltKm)
  );
  describeReentryTrendHelperFixtures(
    'altitudeSignalStrength',
    ({ perigeeReg, smaReg }) => altitudeSignalStrength(perigeeReg, smaReg)
  );
  describeReentryTrendHelperFixtures(
    'computeManeuverLikelihood',
    ({ bstarReg, altitudeSignal }) =>
      computeManeuverLikelihood(bstarReg, altitudeSignal)
  );
  describeReentryTrendHelperFixtures(
    'classifyDecaySignal',
    ({ bstarReg, ndotReg, perigeeReg, smaReg, ndotLatest, decayAltKm }) =>
      classifyDecaySignal(
        bstarReg,
        ndotReg,
        perigeeReg,
        smaReg,
        ndotLatest,
        decayAltKm
      )
  );
  describeReentryTrendHelperFixtures(
    'payloadConsensusRequired',
    ({ objectType, perigeeLatest }) =>
      payloadConsensusRequired(objectType, perigeeLatest)
  );
  describeReentryTrendHelperFixtures(
    'partialConsensusRequired',
    ({ perigeeLatest }) => partialConsensusRequired(perigeeLatest)
  );
  describeReentryTrendHelperFixtures('allSignalsAgreeFromSlopes', (input) =>
    allSignalsAgreeFromSlopes(input)
  );
});

describe('re-entry model golden fixtures — explainReentryTrend', () => {
  it.each(goldenFixtures.explainReentryTrend.map((c) => [c.id, c]))(
    '%s',
    (_id, testCase) => {
      expect(
        normalize(
          explainReentryTrend(testCase.input as ExplainReentryTrendInput)
        )
      ).toEqual(testCase.output);
    }
  );
});

describe('re-entry model golden fixtures — resolveReentryRisk end-to-end', () => {
  it.each(goldenFixtures.resolveReentryRisk.map((c) => [c.id, c]))(
    '%s',
    (_id, testCase) => {
      const { entry, trend, solarFluxMultiplier } =
        testCase.input as ResolveReentryRiskInput;
      expect(
        normalize(resolveReentryRisk(entry, trend, solarFluxMultiplier))
      ).toEqual(testCase.output);
    }
  );
});
