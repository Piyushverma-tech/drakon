"""Ported from lib/explainReentryTrend.ts (plan §17 Phase 3).

Function-for-function port, same operation order, same magic numbers,
same branch structure as the TypeScript source. See
compute/satellite_helpers.py's module docstring for the general
float-tolerance caveat that applies here too (this module also calls
assign_reentry_tier / apply_confidence_ceiling from that module).

RegressionResult objects are plain dicts (or None) with keys: slope,
rSquared, mean, stddev, n -- matching the TS RegressionResult shape
exactly (camelCase keys preserved so parity tests can compare directly
against the JSON fixtures).
"""
from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone

from compute.satellite_helpers import (
    apply_confidence_ceiling,
    assign_reentry_tier,
    ndot_indicates_decay,
)
from compute.reentry_signals import all_signals_agree_from_slopes

MS_PER_DAY = 86_400_000
REENTRY_ALTITUDE_KM = 120

SIGNAL_WEIGHTS = {"bstar": 0.35, "ndot": 0.25, "altitude": 0.4}
SIGNAL_AGREE_THRESHOLDS = {"bstar": 0.3, "ndot": 0.3, "altitude": 0.2}

_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


def _iso_from_epoch_ms(epoch_ms: float) -> str:
    """Matches JS's `new Date(ms).toISOString()` format exactly:
    YYYY-MM-DDTHH:mm:ss.sssZ. Built via timedelta from a fixed epoch rather
    than datetime.fromtimestamp() to avoid float-epoch rounding noise."""
    dt = _EPOCH + timedelta(milliseconds=epoch_ms)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def reconstruct_signal_contributions(scores: dict) -> list[dict]:
    bstar_strength = scores["bstarSignalStrength"]
    ndot_strength = scores["ndotSignalStrength"]
    altitude_strength = scores["altitudeSignalStrength"]

    if bstar_strength is None or ndot_strength is None or altitude_strength is None:
        return []

    strengths = {"bstar": bstar_strength, "ndot": ndot_strength, "altitude": altitude_strength}

    return [
        {
            "name": name,
            "strength": strengths[name],
            "weight": SIGNAL_WEIGHTS[name],
            "contribution": strengths[name] * SIGNAL_WEIGHTS[name],
            "agrees": strengths[name] >= SIGNAL_AGREE_THRESHOLDS[name],
        }
        for name in ("bstar", "ndot", "altitude")
    ]


def bstar_signal_strength(bstar_reg: dict | None) -> float:
    if not bstar_reg or bstar_reg["slope"] <= 0:
        return 0.0
    return min(1, bstar_reg["rSquared"] * min(1, bstar_reg["slope"] / 1e-7))


def ndot_signal_strength(
    ndot_reg: dict | None, ndot_latest: float | None, decay_alt_km: float
) -> float:
    from_trend = (
        min(1, ndot_reg["rSquared"] * min(1, ndot_reg["slope"] / 1e-5))
        if ndot_reg and ndot_reg["slope"] > 0
        else 0
    )
    from_instant = (
        0.65
        if ndot_latest is not None and ndot_indicates_decay(ndot_latest, decay_alt_km)
        else 0
    )
    return max(from_trend, from_instant)


def altitude_signal_strength(perigee_reg: dict | None, sma_reg: dict | None) -> float:
    regs = [r for r in (perigee_reg, sma_reg) if r and r["slope"] < -0.01]
    if not regs:
        return 0.0
    return max(min(1, abs(r["slope"]) / 0.5) * max(r["rSquared"], 0.35) for r in regs)


def compute_maneuver_likelihood(bstar_reg: dict | None, altitude_signal: float) -> float:
    if not bstar_reg or abs(bstar_reg["mean"]) <= 0:
        return 0.0
    cv = bstar_reg["stddev"] / abs(bstar_reg["mean"])
    if cv > 1.5 and altitude_signal < 0.15:
        return min(1, cv / 3)
    return 0.0


def classify_decay_signal(
    bstar_reg: dict | None,
    ndot_reg: dict | None,
    perigee_reg: dict | None,
    sma_reg: dict | None,
    ndot_latest: float | None,
    decay_alt_km: float,
) -> dict:
    bstar_sig = bstar_signal_strength(bstar_reg)
    ndot_sig = ndot_signal_strength(ndot_reg, ndot_latest, decay_alt_km)
    alt_sig = altitude_signal_strength(perigee_reg, sma_reg)
    maneuver_likelihood = compute_maneuver_likelihood(bstar_reg, alt_sig)

    signals = [
        {
            "name": "bstar",
            "strength": bstar_sig,
            "weight": SIGNAL_WEIGHTS["bstar"],
            "contribution": bstar_sig * SIGNAL_WEIGHTS["bstar"],
            "agrees": bstar_sig >= SIGNAL_AGREE_THRESHOLDS["bstar"],
        },
        {
            "name": "ndot",
            "strength": ndot_sig,
            "weight": SIGNAL_WEIGHTS["ndot"],
            "contribution": ndot_sig * SIGNAL_WEIGHTS["ndot"],
            "agrees": ndot_sig >= SIGNAL_AGREE_THRESHOLDS["ndot"],
        },
        {
            "name": "altitude",
            "strength": alt_sig,
            "weight": SIGNAL_WEIGHTS["altitude"],
            "contribution": alt_sig * SIGNAL_WEIGHTS["altitude"],
            "agrees": alt_sig >= SIGNAL_AGREE_THRESHOLDS["altitude"],
        },
    ]

    raw_confidence = (
        SIGNAL_WEIGHTS["bstar"] * bstar_sig
        + SIGNAL_WEIGHTS["ndot"] * ndot_sig
        + SIGNAL_WEIGHTS["altitude"] * alt_sig
    )

    decay_confidence = max(0.0, min(1.0, raw_confidence * (1 - maneuver_likelihood * 0.75)))

    if maneuver_likelihood > 0.5:
        return {
            "signal": "maneuvering",
            "maneuverLikelihood": maneuver_likelihood,
            "decayConfidence": decay_confidence * 0.2,
            "signals": signals,
        }

    decaying = decay_confidence >= 0.35 and (
        alt_sig >= 0.2 or (bstar_sig >= 0.3 and ndot_sig >= 0.3)
    )

    if decaying:
        return {
            "signal": "decaying",
            "maneuverLikelihood": 0,
            "decayConfidence": decay_confidence,
            "signals": signals,
        }

    bstar_n = bstar_reg["n"] if bstar_reg else 0
    if decay_confidence < 0.15 and bstar_n >= 5:
        return {
            "signal": "stable",
            "maneuverLikelihood": 0,
            "decayConfidence": max(decay_confidence, 0.8),
            "signals": signals,
        }

    return {
        "signal": "insufficient_data",
        "maneuverLikelihood": maneuver_likelihood,
        "decayConfidence": decay_confidence,
        "signals": signals,
    }


def payload_consensus_required(object_type: str, perigee_latest: float | None) -> bool:
    # Below 220km, altitude drop alone is sufficient evidence. Drag
    # overwhelms maneuver authority at this altitude, even if BSTAR is
    # contaminated by prior burns.
    if perigee_latest is not None and perigee_latest < 220:
        return False

    if perigee_latest is not None and perigee_latest < 300:
        return False

    return object_type in ("payload", "unknown")


def partial_consensus_required(perigee_latest: float | None) -> bool:
    return perigee_latest is not None and 220 <= perigee_latest < 300


def _decay_component(reg: dict | None) -> float:
    if reg and reg["slope"] < 0:
        return abs(reg["slope"])
    return 0.0


def _estimate_reentry(input: dict) -> dict:
    signal = input["signal"]
    decay_confidence = input["decayConfidence"]
    object_type = input["objectType"]
    perigee_latest = input["perigeeLatest"]
    decay_alt_km = input["decayAltKm"]
    perigee_reg = input["perigeeReg"]
    perigee_reg_7d = input["perigeeReg7d"]
    sma_reg = input["smaReg"]
    sma_reg_7d = input["smaReg7d"]
    bstar_reg = input["bstarReg"]
    ndot_reg = input["ndotReg"]
    ndot_latest = input["ndotLatest"]
    ndot_mean_14d = input["ndotMean14d"]
    now_ms = input["nowMs"]
    maneuver_likelihood = input["maneuverLikelihood"]

    full_consensus_required = payload_consensus_required(object_type, perigee_latest)
    all_agree = all_signals_agree_from_slopes(
        {
            "bstarSlope14d": bstar_reg["slope"] if bstar_reg else None,
            "ndotSlope14d": ndot_reg["slope"] if ndot_reg else None,
            "ndotLatest": ndot_latest,
            "ndotMean14d": ndot_mean_14d,
            "perigeeSlope14d": perigee_reg["slope"] if perigee_reg else None,
            "smaSlope14d": sma_reg["slope"] if sma_reg else None,
            "decayAltKm": decay_alt_km,
        }
    )

    partial_consensus = partial_consensus_required(perigee_latest)
    alt_agrees = (
        (perigee_reg["slope"] if perigee_reg else 0) < -0.01
        or (sma_reg["slope"] if sma_reg else 0) < -0.01
    )

    if full_consensus_required:
        consensus = {"required": "full", "met": all_agree}
    elif partial_consensus:
        consensus = {"required": "partial", "met": alt_agrees}
    else:
        consensus = {"required": "none", "met": True}

    consensus_blocks = not consensus["met"]

    if (
        signal == "maneuvering"
        or signal == "insufficient_data"
        or (signal != "decaying" and decay_confidence < 0.35)
        or consensus_blocks
        or perigee_latest is None
        or perigee_latest <= REENTRY_ALTITUDE_KM
    ):
        return {
            "estimatedDaysRemaining": None,
            "estimatedReentryAt": None,
            "reentryTier": "stable",
            "decayRateKmPerDay": None,
            "consensus": consensus,
        }

    decay_rate_km_per_day = max(
        _decay_component(perigee_reg_7d),
        _decay_component(sma_reg_7d),
        _decay_component(perigee_reg),
        _decay_component(sma_reg),
    )

    if decay_rate_km_per_day < 0.001:
        return {
            "estimatedDaysRemaining": None,
            "estimatedReentryAt": None,
            "reentryTier": "stable",
            "decayRateKmPerDay": decay_rate_km_per_day,
            "consensus": consensus,
        }

    estimated_days_remaining = max(
        1,
        math.ceil(
            ((perigee_latest - REENTRY_ALTITUDE_KM) / decay_rate_km_per_day) * (2 / 3)
        ),
    )
    estimated_reentry_at = _iso_from_epoch_ms(now_ms + estimated_days_remaining * MS_PER_DAY)

    raw_tier = assign_reentry_tier(estimated_days_remaining, decay_alt_km)
    if perigee_latest is not None and perigee_latest < 220 and maneuver_likelihood == 0:
        tier = raw_tier
    else:
        tier = apply_confidence_ceiling(raw_tier, decay_confidence)

    return {
        "estimatedDaysRemaining": estimated_days_remaining,
        "estimatedReentryAt": estimated_reentry_at,
        "reentryTier": tier,
        "decayRateKmPerDay": decay_rate_km_per_day,
        "consensus": consensus,
    }


def explain_reentry_trend(input: dict) -> dict:
    classification = classify_decay_signal(
        input["bstarReg"],
        input["ndotReg"],
        input["perigeeReg"],
        input["smaReg"],
        input["ndotLatest"],
        input["decayAltKm"],
    )

    reentry_result = _estimate_reentry(
        {
            "signal": classification["signal"],
            "decayConfidence": classification["decayConfidence"],
            "objectType": input["objectType"],
            "perigeeLatest": input["perigeeLatest"],
            "decayAltKm": input["decayAltKm"],
            "perigeeReg": input["perigeeReg"],
            "perigeeReg7d": input["perigeeReg7d"],
            "smaReg": input["smaReg"],
            "smaReg7d": input["smaReg7d"],
            "bstarReg": input["bstarReg"],
            "ndotReg": input["ndotReg"],
            "ndotLatest": input["ndotLatest"],
            "ndotMean14d": input["ndotMean14d"],
            "nowMs": input["nowMs"],
            "maneuverLikelihood": classification["maneuverLikelihood"],
        }
    )

    consensus = reentry_result.pop("consensus")

    return {
        "signal": classification["signal"],
        "decayConfidence": classification["decayConfidence"],
        "maneuverLikelihood": classification["maneuverLikelihood"],
        "signals": classification["signals"],
        "consensus": consensus,
        "reentry": reentry_result,
    }
