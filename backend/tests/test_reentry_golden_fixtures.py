"""Python side of the golden-fixture freeze (plan §17 Phase 1 / §22): shape
and category-coverage guards for fixtures/reentry-model/golden_cases.json
itself, independent of any single consumer module.

The real per-case assertions against resolve_reentry_risk() output live in
backend/tests/test_resolve_reentry_risk_golden_fixtures.py (Phase 4, done).
This file just guards that the fixture file's shape and required category
coverage (plan §17 Phase 1's list) doesn't silently erode if the generator
script is edited again later.
"""
import json
from pathlib import Path

FIXTURE_PATH = (
    Path(__file__).resolve().parents[2] / "fixtures" / "reentry-model" / "golden_cases.json"
)


def _load_fixtures() -> dict:
    with open(FIXTURE_PATH, encoding="utf-8") as f:
        return json.load(f)


def test_fixture_file_exists_and_parses():
    golden = _load_fixtures()
    assert "primitives" in golden
    assert "explainReentryTrend" in golden
    assert "resolveReentryRisk" in golden


def test_expected_primitive_groups_present():
    golden = _load_fixtures()
    expected_groups = {
        "parseBSTAR",
        "ndotIndicatesDecay",
        "getReentryTierThresholds",
        "assignReentryTier",
        "applyConfidenceCeiling",
        "altitudeBasedReentryEstimate",
        "getReentryRisk",
    }
    assert expected_groups.issubset(golden["primitives"].keys())


def test_resolve_reentry_risk_cases_cover_required_categories():
    golden = _load_fixtures()
    case_ids = {case["id"] for case in golden["resolveReentryRisk"]}
    # Category coverage required by plan §17 Phase 1. Kept as a substring
    # match against case ids rather than an exact set, since case ids may
    # gain suffixes over time without dropping the category itself.
    required_substrings = [
        "decaying",
        "stable",
        "low_altitude",
        "heo",
        "raising_orbit",
        "maneuver",
        "contradictory",
        "solar_flux",
        "composed_environmental",
        "insufficient_data",
    ]
    for substring in required_substrings:
        assert any(substring in case_id for case_id in case_ids), (
            f"no golden resolveReentryRisk case covers '{substring}'"
        )
