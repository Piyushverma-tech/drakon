"""Parity tests: compute/reentry_trend.py and compute/reentry_signals.py vs
the frozen TypeScript reference in fixtures/reentry-model/golden_cases.json
(plan §17 Phase 3).

Reuses the tolerant comparator from test_satellite_helpers_golden_fixtures.py
(numeric leaves within rel_tol=1e-9; strings/bools/None/shape exact) -- see
that file's docstring and compute/satellite_helpers.py's module docstring
for why a tolerance is the deliberate, evidence-backed choice here rather
than bit-exact equality.
"""
import json
from pathlib import Path

import pytest

from compute.reentry_signals import all_signals_agree_from_slopes
from compute.reentry_trend import (
    altitude_signal_strength,
    bstar_signal_strength,
    classify_decay_signal,
    compute_maneuver_likelihood,
    explain_reentry_trend,
    ndot_signal_strength,
    partial_consensus_required,
    payload_consensus_required,
)
from tests._golden_compare import assert_matches_golden

FIXTURE_PATH = (
    Path(__file__).resolve().parents[2] / "fixtures" / "reentry-model" / "golden_cases.json"
)

with open(FIXTURE_PATH, encoding="utf-8") as f:
    GOLDEN = json.load(f)


@pytest.mark.parametrize(
    "case", GOLDEN["reentryTrendHelpers"]["bstarSignalStrength"], ids=lambda c: c["id"]
)
def test_bstar_signal_strength(case):
    result = bstar_signal_strength(case["input"]["bstarReg"])
    assert_matches_golden(result, case["output"])


@pytest.mark.parametrize(
    "case", GOLDEN["reentryTrendHelpers"]["ndotSignalStrength"], ids=lambda c: c["id"]
)
def test_ndot_signal_strength(case):
    result = ndot_signal_strength(
        case["input"]["ndotReg"], case["input"]["ndotLatest"], case["input"]["decayAltKm"]
    )
    assert_matches_golden(result, case["output"])


@pytest.mark.parametrize(
    "case", GOLDEN["reentryTrendHelpers"]["altitudeSignalStrength"], ids=lambda c: c["id"]
)
def test_altitude_signal_strength(case):
    result = altitude_signal_strength(case["input"]["perigeeReg"], case["input"]["smaReg"])
    assert_matches_golden(result, case["output"])


@pytest.mark.parametrize(
    "case", GOLDEN["reentryTrendHelpers"]["computeManeuverLikelihood"], ids=lambda c: c["id"]
)
def test_compute_maneuver_likelihood(case):
    result = compute_maneuver_likelihood(
        case["input"]["bstarReg"], case["input"]["altitudeSignal"]
    )
    assert_matches_golden(result, case["output"])


@pytest.mark.parametrize(
    "case", GOLDEN["reentryTrendHelpers"]["classifyDecaySignal"], ids=lambda c: c["id"]
)
def test_classify_decay_signal(case):
    i = case["input"]
    result = classify_decay_signal(
        i["bstarReg"], i["ndotReg"], i["perigeeReg"], i["smaReg"], i["ndotLatest"], i["decayAltKm"]
    )
    assert_matches_golden(result, case["output"])


@pytest.mark.parametrize(
    "case", GOLDEN["reentryTrendHelpers"]["payloadConsensusRequired"], ids=lambda c: c["id"]
)
def test_payload_consensus_required(case):
    result = payload_consensus_required(
        case["input"]["objectType"], case["input"]["perigeeLatest"]
    )
    assert_matches_golden(result, case["output"])


@pytest.mark.parametrize(
    "case", GOLDEN["reentryTrendHelpers"]["partialConsensusRequired"], ids=lambda c: c["id"]
)
def test_partial_consensus_required(case):
    result = partial_consensus_required(case["input"]["perigeeLatest"])
    assert_matches_golden(result, case["output"])


@pytest.mark.parametrize(
    "case", GOLDEN["reentryTrendHelpers"]["allSignalsAgreeFromSlopes"], ids=lambda c: c["id"]
)
def test_all_signals_agree_from_slopes(case):
    result = all_signals_agree_from_slopes(case["input"])
    assert_matches_golden(result, case["output"])


@pytest.mark.parametrize(
    "case", GOLDEN["explainReentryTrend"], ids=lambda c: c["id"]
)
def test_explain_reentry_trend(case):
    result = explain_reentry_trend(case["input"])
    assert_matches_golden(result, case["output"])
