"""Shared comparator for golden-fixture parity tests (plan §17 Phase 5-style
checks, done per-phase as each piece lands). Not itself a test module --
deliberately not named test_*.py so pytest doesn't try to collect it.
"""
import math


def assert_matches_golden(actual, expected, path: str = "$") -> None:
    """Numeric leaves are compared with a tolerance (rel_tol=1e-9,
    abs_tol=1e-9); strings/bools/None/dict-and-list shape are compared
    exactly. See compute/satellite_helpers.py's module docstring for why:
    measured ~1e-16-relative divergence between Python's ``10.0 ** n`` and
    JS's ``Math.pow(10, n)``, which this tolerance safely absorbs without
    masking a real logic bug (it's ~7 orders of magnitude tighter than
    that noise floor).
    """
    if isinstance(expected, dict):
        assert isinstance(actual, dict), f"{path}: expected dict, got {type(actual)}"
        assert actual.keys() == expected.keys(), (
            f"{path}: key mismatch — actual={sorted(actual.keys())} "
            f"expected={sorted(expected.keys())}"
        )
        for key in expected:
            assert_matches_golden(actual[key], expected[key], f"{path}.{key}")
    elif isinstance(expected, list):
        assert isinstance(actual, list), f"{path}: expected list, got {type(actual)}"
        assert len(actual) == len(expected), f"{path}: length mismatch"
        for i, (a, e) in enumerate(zip(actual, expected)):
            assert_matches_golden(a, e, f"{path}[{i}]")
    elif isinstance(expected, bool) or expected is None:
        assert actual is expected, f"{path}: expected {expected!r}, got {actual!r}"
    elif isinstance(expected, (int, float)):
        assert isinstance(actual, (int, float)) and not isinstance(actual, bool), (
            f"{path}: expected number, got {type(actual)}"
        )
        assert math.isclose(actual, expected, rel_tol=1e-9, abs_tol=1e-9), (
            f"{path}: expected {expected!r}, got {actual!r}"
        )
    else:
        assert actual == expected, f"{path}: expected {expected!r}, got {actual!r}"
