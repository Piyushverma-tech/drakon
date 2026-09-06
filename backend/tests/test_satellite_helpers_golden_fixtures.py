"""Parity tests: compute/satellite_helpers.py vs the frozen TypeScript
reference in fixtures/reentry-model/golden_cases.json (plan §17 Phase 2,
verified the way Phase 5 will verify everything else).

Numeric leaves are compared with a tolerance (see compute/satellite_helpers.py
module docstring for why: Math.pow() vs Python's ** can differ in the last
bit for the cube roots Kepler's-third-law uses). Strings, bools, None, and
dict/list shape are compared exactly -- a tier or signal flipping is a real
bug, not a rounding artifact.
"""
import json
from pathlib import Path

import pytest

from compute.satellite_helpers import (
    altitude_based_reentry_estimate,
    apply_confidence_ceiling,
    assign_reentry_tier,
    get_reentry_risk,
    get_reentry_tier_thresholds,
    ndot_indicates_decay,
    parse_bstar,
)
from tests._golden_compare import assert_matches_golden

FIXTURE_PATH = (
    Path(__file__).resolve().parents[2] / "fixtures" / "reentry-model" / "golden_cases.json"
)

with open(FIXTURE_PATH, encoding="utf-8") as f:
    GOLDEN = json.load(f)


@pytest.mark.parametrize(
    "case", GOLDEN["primitives"]["parseBSTAR"], ids=lambda c: c["id"]
)
def test_parse_bstar(case):
    assert_matches_golden(parse_bstar(case["input"]["l1"]), case["output"])


@pytest.mark.parametrize(
    "case", GOLDEN["primitives"]["ndotIndicatesDecay"], ids=lambda c: c["id"]
)
def test_ndot_indicates_decay(case):
    result = ndot_indicates_decay(case["input"]["nDot"], case["input"]["decayAltKm"])
    assert_matches_golden(result, case["output"])


@pytest.mark.parametrize(
    "case", GOLDEN["primitives"]["getReentryTierThresholds"], ids=lambda c: c["id"]
)
def test_get_reentry_tier_thresholds(case):
    result = get_reentry_tier_thresholds(case["input"]["altKm"])
    assert_matches_golden(result, case["output"])


@pytest.mark.parametrize(
    "case", GOLDEN["primitives"]["assignReentryTier"], ids=lambda c: c["id"]
)
def test_assign_reentry_tier(case):
    result = assign_reentry_tier(case["input"]["days"], case["input"]["altKm"])
    assert_matches_golden(result, case["output"])


@pytest.mark.parametrize(
    "case", GOLDEN["primitives"]["applyConfidenceCeiling"], ids=lambda c: c["id"]
)
def test_apply_confidence_ceiling(case):
    result = apply_confidence_ceiling(
        case["input"]["tier"], case["input"]["confidence"]
    )
    assert_matches_golden(result, case["output"])


@pytest.mark.parametrize(
    "case", GOLDEN["primitives"]["altitudeBasedReentryEstimate"], ids=lambda c: c["id"]
)
def test_altitude_based_reentry_estimate(case):
    result = altitude_based_reentry_estimate(
        case["input"]["perigeeKm"], case["input"]["solarFluxMultiplier"]
    )
    assert_matches_golden(result, case["output"])


@pytest.mark.parametrize(
    "case", GOLDEN["primitives"]["getReentryRisk"], ids=lambda c: c["id"]
)
def test_get_reentry_risk(case):
    result = get_reentry_risk(
        case["input"]["entry"], None, case["input"]["solarFluxMultiplier"]
    )
    assert_matches_golden(result, case["output"])
