"""Python side of the golden-fixture freeze (plan §17 Phase 1 / §22).

This does NOT assert resolveReentryRisk() output yet -- compute/reentry.py
raises NotImplementedError until Phases 3-4 land (Phase 2's primitives are
already ported and parity-tested in
backend/tests/test_satellite_helpers_golden_fixtures.py). This test only
proves the fixture file (generated from the real TypeScript implementation,
see scripts/generate-reentry-golden-fixtures.ts and
lib/reentryModel.goldenFixtures.test.ts) is present, parseable, and has the
shape the eventual Phase 5 parity tests will depend on.

Once compute/reentry.py implements resolve_reentry_risk(), extend this file
to loop over golden["resolveReentryRisk"] the same way the TS test does and
assert exact equality against each case's "output" -- that IS Phase 5.
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
