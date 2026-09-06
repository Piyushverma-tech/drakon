"""Ported from lib/reentrySignals.ts (plan §17 Phase 3) -- only the two
functions explainReentryTrend() actually depends on: decay_signal_flags and
all_signals_agree_from_slopes.

The remaining reentrySignals.ts exports (isDebrisEntry, decayAltKmFromTrend,
allTrendSignalsAgree, trendSignalsAgree) operate directly on ObjectTrend
records rather than raw regression slopes, and belong to Phase 4 when
resolve_reentry_risk() needs them directly.
"""
from __future__ import annotations

from compute.satellite_helpers import ndot_indicates_decay


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


def all_signals_agree_from_slopes(input: dict) -> bool:
    flags = decay_signal_flags(input)
    return flags["bstarAgrees"] and flags["ndotAgrees"] and flags["altAgrees"]
