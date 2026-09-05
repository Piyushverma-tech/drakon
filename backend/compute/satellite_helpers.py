"""Ported from lib/satelliteHelpers.ts (plan §17 Phase 2).

Every function here is a direct, function-for-function port -- same
operation order, same magic numbers, same branch structure as the
TypeScript source. Where the TS source keeps a helper private (not
exported), this module keeps it private too (leading underscore) for the
same reason: it's an implementation detail of getReentryRisk(), not a
primitive to be called or tested on its own.

Known parity caveat: Kepler's-third-law cube roots here use Python's
``**(1/3)`` where the TypeScript source uses ``Math.pow(x, 1/3)``. Both are
IEEE-754 double-precision, but V8 and libm don't guarantee identical
last-bit rounding for pow(). In practice this shows up (if at all) as a
sub-1e-9-relative difference in decayAltKm -- not enough to move an
estimatedDaysRemaining integer or a tier boundary in any golden fixture
case, but real enough that Phase 5 parity tests compare floats with a
tolerance rather than bit-exact equality. See
backend/tests/test_satellite_helpers_golden_fixtures.py.

Entries and results here are plain dicts, not the Pydantic contracts in
contracts.py -- see backend/README.md for why compute/ stays free of
FastAPI/Pydantic imports.
"""
from __future__ import annotations

import math

EARTH_RADIUS_KM = 6378.137
MU_KM3_S2 = 398600.4418

DECAY_SCALE_HEIGHT_KM = 60
DECAY_CAP_REF_ALT_KM = 400
# Plausible peak drag-loss rate near 400 km; scales down with altitude like density.
MAX_DECAY_RATE_AT_REF_KM_PER_DAY = 20


def parse_bstar(l1: str) -> float:
    """Parse the BSTAR drag term from TLE line 1 (columns 54-61, 1-indexed;
    53:61 0-indexed slice, matching the TS l1.substring(53, 61))."""
    try:
        raw = l1[53:61].strip()
        if not raw or raw in ("00000-0", "00000+0"):
            return 0.0

        # Handle both space-for-positive and explicit-sign forms.
        padded = raw.rjust(8, " ")

        mantissa_sign = -1 if padded[0] == "-" else 1
        mantissa_digits = padded[1:6]  # 5 digits
        exp_sign = -1 if padded[6] == "-" else 1
        try:
            exp_digit = int(padded[7])
        except (ValueError, IndexError):
            return 0.0

        mantissa = float("0." + mantissa_digits) * mantissa_sign
        result = mantissa * (10.0 ** (exp_sign * exp_digit))
        return result if math.isfinite(result) else 0.0
    except Exception:
        return 0.0


def ndot_indicates_decay(n_dot: float, decay_alt_km: float) -> bool:
    """Ndot threshold (rev/day^2) scales with altitude -- TLE fit noise
    dominates above ~500 km."""
    if n_dot <= 0:
        return False
    if decay_alt_km > 500:
        return n_dot > 5e-5
    if decay_alt_km > 400:
        return n_dot > 2e-5
    return n_dot > 1e-5


def _lerp(start: float, end: float, t: float) -> float:
    return start + (end - start) * t


def get_reentry_tier_thresholds(alt_km: float) -> dict:
    critical = 30

    if alt_km <= 300:
        return {"critical": critical, "warning": 180, "nominal": 365}

    if alt_km <= 500:
        t = (alt_km - 300) / 200
        return {
            "critical": critical,
            "warning": math.floor(_lerp(180, 120, t)),
            "nominal": math.floor(_lerp(365, 240, t)),
        }

    if alt_km <= 800:
        t = (alt_km - 500) / 300
        return {
            "critical": critical,
            "warning": math.floor(_lerp(120, 90, t)),
            "nominal": math.floor(_lerp(240, 180, t)),
        }

    if alt_km <= 1000:
        t = (alt_km - 800) / 200
        return {
            "critical": critical,
            "warning": math.floor(_lerp(90, 60, t)),
            "nominal": math.floor(_lerp(180, 120, t)),
        }

    t = min(1.0, (alt_km - 1000) / 1000)
    return {
        "critical": critical,
        "warning": math.floor(_lerp(60, 45, t)),
        "nominal": math.floor(_lerp(120, 90, t)),
    }


def assign_reentry_tier(estimated_days: float, decay_alt_km: float) -> str:
    thresholds = get_reentry_tier_thresholds(decay_alt_km)
    if estimated_days < thresholds["critical"]:
        return "critical"
    if thresholds["warning"] > 0 and estimated_days < thresholds["warning"]:
        return "warning"
    if thresholds["nominal"] > 0 and estimated_days < thresholds["nominal"]:
        return "nominal"
    return "stable"


def _get_reentry_confidence(signals_agree: bool, alt_km: float) -> str:
    if signals_agree:
        return "high"
    if alt_km <= 500:
        return "medium"
    return "low"


def apply_confidence_ceiling(tier: str, confidence: float) -> str:
    if tier == "stable":
        return "stable"

    normalized_conf = confidence / 100 if confidence > 1 else confidence

    if normalized_conf < 0.75:
        if tier in ("critical", "warning"):
            return "nominal"
        return tier
    if normalized_conf < 0.85:
        if tier == "critical":
            return "warning"
        return tier
    return tier


def _estimate_altitude_from_mean_motion(mean_motion: float) -> float:
    """Kepler's third law for semi-major axis from mean motion."""
    n = (mean_motion * 2 * math.pi) / 1440  # rad/min
    n_per_sec = n / 60
    a = (MU_KM3_S2 / (n_per_sec * n_per_sec)) ** (1 / 3)  # semi-major axis km
    return max(0.0, a - EARTH_RADIUS_KM)


def _max_plausible_decay_rate_km_per_day(alt_km: float) -> float:
    """Terminal re-entry can accelerate far beyond the mid-LEO anomaly cap."""
    if alt_km <= 180:
        return math.inf

    if alt_km <= 400 and alt_km > 180:
        # Tighter cap in the 250-400km band -- this is where BSTAR noise
        # produces the most false positives. At 300km solar max peak is
        # ~5km/day, solar minimum is ~0.5km/day. Cap at 8km/day as a
        # generous upper bound.
        tight_cap = 8 * math.exp((300 - alt_km) / 60)
        return min(
            MAX_DECAY_RATE_AT_REF_KM_PER_DAY
            * math.exp((DECAY_CAP_REF_ALT_KM - alt_km) / DECAY_SCALE_HEIGHT_KM),
            max(tight_cap, 0.5),
        )

    return MAX_DECAY_RATE_AT_REF_KM_PER_DAY * math.exp(
        (DECAY_CAP_REF_ALT_KM - alt_km) / DECAY_SCALE_HEIGHT_KM
    )


def get_reentry_risk(
    entry: dict, current_alt_km: float | None = None, solar_flux_multiplier: float = 1.0
) -> dict:
    """da/dt = -3pi * B* * rho_ref * (a/R_e) * v  [km/day]

    Only screens debris objects -- payloads always come back stable (this
    function's job is single-epoch debris screening; payload trends are
    handled by explainReentryTrend()/resolveReentryRisk(), Phase 3/4).
    """
    bstar = parse_bstar(entry["l1"])
    decay_alt_km = (
        current_alt_km
        if current_alt_km is not None
        else _estimate_altitude_from_mean_motion(entry["meanMotion"])
    )

    # perigee is used only as a sanity gate: objects with high perigee
    # genuinely cannot be in significant drag regardless of BSTAR value.
    perigee_km = entry["perigeeKm"]

    stable = {
        "satId": entry["id"],
        "bstar": bstar,
        "meanMotionDot": entry["meanMotionDot"],
        "signalsAgree": False,
        "confidence": "low",
        "decayAltKm": decay_alt_km,
        "perigeeKm": perigee_km,
        "decayRateKmPerDay": 0,
        "estimatedDaysRemaining": None,
        "tier": "stable",
        "source": "single_epoch",
    }

    period_min = 1440 / max(entry["meanMotion"], 0.001)
    if period_min > 600 or perigee_km > 2000:
        return stable

    name_upper = entry["name"].upper()
    is_debris_object = (
        entry.get("isDebris") or "DEB" in name_upper or "DEBRIS" in name_upper
    )
    if not is_debris_object:
        return stable

    v_km_s = math.sqrt(MU_KM3_S2 / (EARTH_RADIUS_KM + decay_alt_km))
    density_factor = math.exp(
        (DECAY_CAP_REF_ALT_KM - decay_alt_km) / DECAY_SCALE_HEIGHT_KM
    )

    # Calibrated so |B*| ~= 1e-4 yields ~0.72 km/day at 400 km
    # (order-of-magnitude screening).
    base_factor = 7.4e3
    decay_rate_km_per_day = (
        abs(bstar) * base_factor * density_factor * (v_km_s / 7.905) * solar_flux_multiplier
    )

    # Altitude-aware anomaly guard rejects misfit BSTAR; cap scales with density.
    if decay_rate_km_per_day > _max_plausible_decay_rate_km_per_day(decay_alt_km):
        return stable

    # Re-entry completes when perigee drops to 120km.
    alt_above_reentry = max(0.0, perigee_km - 120)
    if decay_rate_km_per_day < 1e-4:
        return stable

    n_dot = entry.get("meanMotionDot")
    n_dot = 0 if n_dot is None else n_dot
    signals_agree = ndot_indicates_decay(n_dot, decay_alt_km)
    confidence = _get_reentry_confidence(signals_agree, decay_alt_km)

    # If BSTAR is negative and orbit is raising, assume stable.
    if bstar < 0 and n_dot < -1e-6:
        return stable

    # Atmospheric density increases as altitude decreases.
    linear_days = alt_above_reentry / decay_rate_km_per_day
    if linear_days > 3650:
        return stable

    # 2/3 correction: accounts for increasing drag as altitude decreases.
    estimated_days_remaining = max(1, math.ceil(linear_days * (2 / 3)))

    raw_tier = assign_reentry_tier(estimated_days_remaining, decay_alt_km)
    if signals_agree:
        confidence_score = 0.85 if decay_alt_km <= 400 else 0.65
    else:
        confidence_score = 0.45 if decay_alt_km <= 500 else 0.25
    tier = apply_confidence_ceiling(raw_tier, confidence_score)

    return {
        "satId": entry["id"],
        "bstar": bstar,
        "meanMotionDot": entry["meanMotionDot"],
        "signalsAgree": signals_agree,
        "confidence": confidence,
        "perigeeKm": perigee_km,
        "decayAltKm": decay_alt_km,
        "decayRateKmPerDay": decay_rate_km_per_day,
        "estimatedDaysRemaining": estimated_days_remaining,
        "tier": tier,
        "source": "single_epoch",
    }


def estimate_decay_rate_from_altitude(
    alt_km: float, solar_flux_multiplier: float = 1.0
) -> float:
    """Uses exponential scale height model calibrated to NRLMSISE-00
    midpoints."""
    if alt_km > 300:
        return 0.0
    base_rate_200km = 10 * solar_flux_multiplier
    scale_height = 35  # tighter scale height in lower thermosphere
    return base_rate_200km * math.exp((200 - alt_km) / scale_height)


def altitude_based_reentry_estimate(
    perigee_km: float, solar_flux_multiplier: float = 1.0
) -> dict:
    decay_rate = estimate_decay_rate_from_altitude(perigee_km, solar_flux_multiplier)
    alt_above_reentry = max(0.0, perigee_km - 120)
    if decay_rate < 0.01:
        return {
            "decayRateKmPerDay": 0,
            "estimatedDaysRemaining": 999,
            "tier": "stable",
        }
    acceleration_factor = 0.5 if perigee_km <= 220 else 2 / 3
    days = max(1, math.ceil((alt_above_reentry / decay_rate) * acceleration_factor))
    tier = assign_reentry_tier(days, perigee_km)
    return {"decayRateKmPerDay": decay_rate, "estimatedDaysRemaining": days, "tier": tier}
