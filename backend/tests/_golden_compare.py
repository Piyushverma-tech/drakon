"""Shared comparator for golden-fixture parity tests (plan §17 Phase 5-style
checks, done per-phase as each piece lands). Not itself a test module --
deliberately not named test_*.py so pytest doesn't try to collect it.

Design: EXACT equality by default for every numeric leaf, with a small,
named, individually-justified set of fields that get a tolerance instead.
This is deliberately the opposite of "tolerant by default, exact by
exception" -- a blanket tolerance is exactly what would risk masking a real
bug in a threshold-adjacent quantity (e.g. estimatedDaysRemaining, which
gates which tier gets assigned) under the excuse of "floating point is
inherently imprecise". Most of the ported computation in compute/ involves
no pow()-with-fractional-exponent at all, so exact equality is both correct
and achievable for the overwhelming majority of fields; per-phase
diagnostic checks (comparing raw Python output against the JS-generated
fixture values directly, not through this tolerant comparator) confirmed
zero divergence everywhere except the fields listed below.

FIELD_TOLERANCES: fields with a *measured*, not merely theoretical, source
of last-bit floating-point divergence:

  bstar -- parse_bstar() computes `mantissa * 10.0 ** exponent`. Python's
    `10.0 ** n` and JS's `Math.pow(10, n)` are both IEEE-754 doubles but
    aren't guaranteed identical last-bit rounding. Measured: ~1e-16
    relative divergence (machine epsilon) across multiple golden cases.

  decayRateKmPerDay -- in get_reentry_risk()/resolve_reentry_risk()'s
    single-epoch debris path, this is `abs(bstar) * ...`, so it inherits
    bstar's noise multiplicatively. (In altitude_based_reentry_estimate()'s
    lineage this field has no bstar dependency and no measured noise, but
    the field name is the same in both output shapes -- see the module
    docstring in compute/satellite_helpers.py. Loosening it unconditionally
    by name is safe: it never causes a false negative, and the tolerance is
    ~7 orders of magnitude tighter than the actual measured noise floor, so
    it can't mask a real logic bug either.)

  decayAltKm -- get_reentry_risk() derives this via
    _estimate_altitude_from_mean_motion(), which uses a genuine
    fractional-exponent cube root (Kepler's third law) -- the canonical
    case where Math.pow(x, 1/3) vs Python's `x ** (1/3)` can disagree in
    the last bit. (In resolve_reentry_risk()'s single-epoch altitude path
    this field is a direct copy of perigeeKm with no computation at all, so
    it's exact there regardless -- the loosened tolerance is a no-op that
    still passes trivially in that lineage.)

Every other numeric field -- estimatedDaysRemaining (integer, gates tier
assignment), the tier-threshold ints (critical/warning/nominal),
decayConfidence, maneuverLikelihood, signal strengths, etc. -- has no
pow()-with-fractional-exponent anywhere in its computation and is compared
exactly. If a future change to compute/ introduces one for a field not
listed here and a test starts failing, that's real: either add the field
here with a documented reason (measured, not assumed), or fix the port.
"""
import math

_TIGHT_TOLERANCE = {"rel_tol": 1e-9, "abs_tol": 1e-9}

FIELD_TOLERANCES: dict[str, dict] = {
    "bstar": _TIGHT_TOLERANCE,
    "decayRateKmPerDay": _TIGHT_TOLERANCE,
    "decayAltKm": _TIGHT_TOLERANCE,
}


def _field_name(path: str) -> str:
    """Last path segment, with any trailing [index] stripped."""
    tail = path.rsplit(".", 1)[-1]
    return tail.split("[", 1)[0]


def assert_matches_golden(actual, expected, path: str = "$") -> None:
    """path may be seeded with a leading field name (e.g. path="bstar") when
    comparing a bare scalar result so the field-tolerance lookup still
    applies -- see test call sites for parse_bstar() etc.
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
        tolerance = FIELD_TOLERANCES.get(_field_name(path))
        if tolerance is not None:
            assert math.isclose(actual, expected, **tolerance), (
                f"{path}: expected {expected!r}, got {actual!r} "
                f"(outside documented tolerance {tolerance})"
            )
        else:
            assert actual == expected, (
                f"{path}: expected {expected!r}, got {actual!r} (exact match required — "
                f"add '{_field_name(path)}' to FIELD_TOLERANCES with a measured "
                f"justification if this is genuine floating-point noise, not a bug)"
            )
    else:
        assert actual == expected, f"{path}: expected {expected!r}, got {actual!r}"
