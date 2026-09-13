"""Re-entry Resolution Model -- ported from lib/objectTrendRisk.ts (plan
Sec17 Phase 4). Function-for-function port, same branch order and magic
numbers as the TypeScript source.

Deliberately NOT ported here (out of scope for the model itself):
  - attachTipData / effectiveDaysRemaining / buildReentryRiskMap /
    tipDaysRemaining -- these are TIP-comparison and batch-map orchestration
    concerns layered on top of the model, not the model itself.
  - The DEFAULT_SOLAR_FLUX_MULTIPLIER default parameter value -- it depends
    on env vars and a calibration curve (lib/solarFlux.ts) that live
    upstream of this model. Every golden fixture case passes
    solar_flux_multiplier explicitly, so resolve_reentry_risk() here
    requires it as a real argument rather than faking a default.

See compute/satellite_helpers.py's module docstring for the float-tolerance
caveat that applies to every numeric field here too.
"""
from __future__ import annotations

import math

from compute.reentry_signals import (
    all_trend_signals_agree,
    is_debris_entry,
    trend_signals_agree,
)
from compute.satellite_helpers import (
    altitude_based_reentry_estimate,
    get_reentry_risk,
    parse_bstar,
)


def is_actionable_trend(trend: dict) -> bool:
    """True when multi-epoch history is sufficient for trend-based
    screening."""
    return (
        trend["epochsAvailable"] >= 3
        and trend["historyDaysAvailable"] >= 1
        and trend["decaySignal"] != "insufficient_data"
    )


def _confidence_label(confidence: float | None) -> str:
    c = confidence if confidence is not None else 0
    if c >= 0.75:
        return "high"
    if c >= 0.4:
        return "medium"
    return "low"


def _stable_reentry_risk(entry: dict) -> dict:
    bstar = parse_bstar(entry["l1"])
    return {
        "satId": entry["id"],
        "bstar": bstar,
        "meanMotionDot": entry["meanMotionDot"],
        "signalsAgree": False,
        "confidence": "low",
        "perigeeKm": entry["perigeeKm"],
        "decayAltKm": entry["perigeeKm"],
        "decayRateKmPerDay": 0,
        "estimatedDaysRemaining": None,
        "tier": "stable",
        "source": "single_epoch",
    }


def object_trend_to_reentry_risk(
    trend: dict, entry: dict, debris: bool | None = None
) -> dict:
    
    if debris is None:
        debris = is_debris_entry(entry)

    tier = trend["reentryTier"]
    decay_confidence = trend.get("decayConfidence")
    decay_confidence_or_zero = decay_confidence if decay_confidence is not None else 0

    perigee_slope_14d = trend.get("perigeeSlope14d")
    sma_slope_14d = trend.get("smaSlope14d")
    decay_rate_km_per_day = max(
        abs(perigee_slope_14d) if perigee_slope_14d and perigee_slope_14d < 0 else 0,
        abs(sma_slope_14d) if sma_slope_14d and sma_slope_14d < 0 else 0,
    )

    bstar_latest = trend.get("bstarLatest")
    mean_motion_dot_latest = trend.get("meanMotionDotLatest")
    perigee_latest = trend.get("perigeeLatest")
    sma_latest = trend.get("smaLatest")

    return {
        "satId": trend["noradId"],
        "bstar": bstar_latest if bstar_latest is not None else 0,
        "meanMotionDot": (
            mean_motion_dot_latest
            if mean_motion_dot_latest is not None
            else entry["meanMotionDot"]
        ),
        "signalsAgree": (
            trend_signals_agree(trend) if debris else all_trend_signals_agree(trend)
        ),
        "confidence": _confidence_label(decay_confidence_or_zero),
        "perigeeKm": perigee_latest if perigee_latest is not None else entry["perigeeKm"],
        "decayAltKm": (
            max(0.0, sma_latest - 6378.137) if sma_latest else entry["perigeeKm"]
        ),
        "decayRateKmPerDay": decay_rate_km_per_day,
        "estimatedDaysRemaining": trend["estimatedDaysRemaining"],
        "tier": tier,
        "source": "multi_epoch",
        "decaySignal": trend["decaySignal"],
        "decayConfidence": trend.get("decayConfidence"),
        "maneuverLikelihood": trend.get("maneuverLikelihood"),
        "epochsAvailable": trend["epochsAvailable"],
        "historyDaysAvailable": trend["historyDaysAvailable"],
        "estimatedReentryAt": trend.get("estimatedReentryAt"),
    }


def resolve_reentry_risk(
    entry: dict, trend: dict | None, solar_flux_multiplier: float
) -> dict:
    debris = is_debris_entry(entry)
    perigee_km = entry["perigeeKm"]
    apogee_km = entry["apogeeKm"]

    is_heo = apogee_km > perigee_km * 10 and apogee_km > 2000
    if is_heo:
        return _stable_reentry_risk(entry)

    alt_threshold = 300 if debris else 240

    if perigee_km < alt_threshold:
        bstar = parse_bstar(entry["l1"])
        n_dot = entry["meanMotionDot"]
        is_raising_orbit = n_dot < -1e-6
        is_bstar_negative = bstar < 0

        if is_raising_orbit or (is_bstar_negative and n_dot < 0):
            return _stable_reentry_risk(entry)

        # Check trend data for maneuvering signal
        if not debris and trend:
            if trend["decaySignal"] == "maneuvering" or (
                trend["decaySignal"] == "stable" and trend["epochsAvailable"] >= 5
            ):
                return _stable_reentry_risk(entry)

        eccentricity_factor = (
            perigee_km / apogee_km
            if apogee_km > perigee_km * 3 and apogee_km > 500
            else 1.0
        )

        alt_estimate = altitude_based_reentry_estimate(perigee_km, solar_flux_multiplier)
        adjusted_days = max(
            1,
            math.ceil(
                (alt_estimate["estimatedDaysRemaining"] / eccentricity_factor) * 0.8
            ),
        )

        if adjusted_days > 3650:
            adjusted_tier = "stable"
        elif adjusted_days < 5:
            adjusted_tier = "critical"
        elif adjusted_days < 14:
            adjusted_tier = "warning"
        elif adjusted_days < 90:
            adjusted_tier = "nominal"
        else:
            adjusted_tier = "stable"

        if adjusted_tier == "stable":
            return _stable_reentry_risk(entry)

        alt_risk = {
            "satId": entry["id"],
            "bstar": bstar,
            "meanMotionDot": entry["meanMotionDot"],
            "signalsAgree": True,
            "confidence": "high" if perigee_km < 220 else "medium",
            "perigeeKm": perigee_km,
            "decayAltKm": perigee_km,
            "decayRateKmPerDay": alt_estimate["decayRateKmPerDay"],
            "estimatedDaysRemaining": adjusted_days,
            "tier": adjusted_tier,
            "source": "single_epoch",
            "decaySignal": "decaying",
        }

        # if trend is actionable, pick the more pessimistic estimate
        if (
            trend
            and is_actionable_trend(trend)
            and trend["estimatedDaysRemaining"] is not None
        ):
            trend_risk = object_trend_to_reentry_risk(trend, entry, debris)
            if (
                trend_risk["tier"] != "stable"
                and trend_risk["estimatedDaysRemaining"] is not None
                and trend_risk["estimatedDaysRemaining"] < adjusted_days
            ):
                return trend_risk

        # Altitude-based is more pessimistic (or no actionable trend)
        if not debris or alt_estimate["tier"] in ("critical", "warning"):
            return alt_risk

    # Standard multi-epoch path for perigee >= threshold
    if trend and is_actionable_trend(trend):
        if not debris:
            if trend["decaySignal"] != "decaying" or not all_trend_signals_agree(trend):
                return _stable_reentry_risk(entry)
        return object_trend_to_reentry_risk(trend, entry, debris)

    if debris:
        return get_reentry_risk(entry, None, solar_flux_multiplier)

    return _stable_reentry_risk(entry)
