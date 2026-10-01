"""Ported from lib/reentrySignals.ts (plan §17 Phase 3 + Phase 4).

Phase 3 needed only decay_signal_flags/all_signals_agree_from_slopes (the
slope-only helpers explainReentryTrend calls). Phase 4 needs the rest:
is_debris_entry, decay_alt_km_from_trend, all_trend_signals_agree, and
trend_signals_agree -- the ObjectTrend-facing wrappers resolveReentryRisk()
and objectTrendToReentryRisk() call directly.
"""
from __future__ import annotations

from compute.satellite_helpers import ndot_indicates_decay

EARTH_RADIUS_KM = 6378.137


def is_debris_entry(entry: dict) -> bool:
    name_upper = entry["name"].upper()
    return bool(entry.get("isDebris")) or "DEB" in name_upper or "DEBRIS" in name_upper


def decay_alt_km_from_trend(trend: dict) -> float:
    sma_latest = trend.get("smaLatest")
    if sma_latest:
        return max(0.0, sma_latest - EARTH_RADIUS_KM)
    return trend.get("perigeeLatest") or 0


def decay_signal_flags(input: dict) -> dict:
    bstar_slope_14d = input.get("bstarSlope14d")
    ndot_slope_14d = input.get("ndotSlope14d")
    ndot_latest = input.get("ndotLatest")
    ndot_mean_14d = input.get("ndotMean14d")
    perigee_slope_14d = input.get("perigeeSlope14d")
    sma_slope_14d = input.get("smaSlope14d")
    decay_alt_km = input["decayAltKm"]

    bstar_agrees = (bstar_slope_14d if bstar_slope_14d is not None else 0) > 0
    ndot_agrees = (
        (ndot_slope_14d is not None and ndot_slope_14d > 0)
        or (
            ndot_latest is not None
            and ndot_indicates_decay(ndot_latest, decay_alt_km)
        )
        or (
            ndot_mean_14d is not None
            and ndot_indicates_decay(ndot_mean_14d, decay_alt_km)
        )
    )
    alt_agrees = (
        (perigee_slope_14d if perigee_slope_14d is not None else 0) < -0.01
        or (sma_slope_14d if sma_slope_14d is not None else 0) < -0.01
    )

    return {
        "bstarAgrees": bstar_agrees,
        "ndotAgrees": ndot_agrees,
        "altAgrees": alt_agrees,
    }


def _trend_signal_input(trend: dict, decay_alt_km: float) -> dict:
    return {
        "bstarSlope14d": trend.get("bstarSlope14d"),
        "ndotSlope14d": None,
        "ndotLatest": trend.get("meanMotionDotLatest"),
        "ndotMean14d": trend.get("meanMotionDotMean14d"),
        "perigeeSlope14d": trend.get("perigeeSlope14d"),
        "smaSlope14d": trend.get("smaSlope14d"),
        "decayAltKm": decay_alt_km,
    }


def all_trend_signals_agree(trend: dict) -> bool:
    decay_alt_km = decay_alt_km_from_trend(trend)
    flags = decay_signal_flags(_trend_signal_input(trend, decay_alt_km))
    return flags["bstarAgrees"] and flags["ndotAgrees"] and flags["altAgrees"]


def trend_signals_agree(trend: dict) -> bool:
    decay_alt_km = decay_alt_km_from_trend(trend)
    flags = decay_signal_flags(_trend_signal_input(trend, decay_alt_km))
    return sum(1 for v in flags.values() if v) >= 2


def all_signals_agree_from_slopes(input: dict) -> bool:
    flags = decay_signal_flags(input)
    return flags["bstarAgrees"] and flags["ndotAgrees"] and flags["altAgrees"]
