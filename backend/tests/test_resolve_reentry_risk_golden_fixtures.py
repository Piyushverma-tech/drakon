"""Parity tests: compute/reentry.py's resolve_reentry_risk() vs the frozen
TypeScript reference in fixtures/reentry-model/golden_cases.json (plan §17
Phase 4). This is effectively Phase 5's content for the piece that's now
actually implemented -- see compute/reentry.py's module docstring.
"""
import json
from pathlib import Path

import pytest

from compute.reentry import resolve_reentry_risk
from tests._golden_compare import assert_matches_golden

FIXTURE_PATH = (
    Path(__file__).resolve().parents[2] / "fixtures" / "reentry-model" / "golden_cases.json"
)

with open(FIXTURE_PATH, encoding="utf-8") as f:
    GOLDEN = json.load(f)


@pytest.mark.parametrize(
    "case", GOLDEN["resolveReentryRisk"], ids=lambda c: c["id"]
)
def test_resolve_reentry_risk(case):
    entry = case["input"]["entry"]
    trend = case["input"].get("trend")
    solar_flux_multiplier = case["input"]["solarFluxMultiplier"]
    result = resolve_reentry_risk(entry, trend, solar_flux_multiplier)
    assert_matches_golden(result, case["output"])
