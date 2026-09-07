"""Pydantic request/response contracts for the DRAKON Compute Engine.

This module is the stable wire contract between Next.js and FastAPI
(docs/DRAKON_COMPUTE_ENGINE_EXTRACTION_PLAN.md §6). It only describes shapes
that cross the HTTP boundary. Scientific model logic lives in compute/, not
here, and this module must never import anything from compute/ that isn't a
plain data shape.

Nothing in this file (or anywhere under compute/) may import os.environ
lookups for Vercel-specific names (BACKEND_URL, service bindings, etc.) --
that knowledge belongs entirely to the Next.js side of the contract. See
backend/README.md.

Field names intentionally stay camelCase (matching lib/types.ts exactly,
not idiomatic Python snake_case) because these models describe the wire
shape verbatim, and compute/ functions read dicts keyed by these same
camelCase names (see compute/satellite_helpers.py etc.) -- .model_dump()
on these models hands compute/ exactly the dict shape it already expects,
with no alias-mapping layer to keep in sync.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"


ModelStatus = Literal[
    "experimental", "shadow", "canary", "production", "deprecated"
]


class ModelInfo(BaseModel):
    model_id: str
    version: str
    parameter_set: str
    status: ModelStatus


class ModelsResponse(BaseModel):
    models: list[ModelInfo]


# --- Re-entry model wire contract (plan §17 Phase 4/6) ----------------------
# Mirrors lib/types.ts's TleEntry / ObjectTrend / ReentryRisk. Only the
# fields resolve_reentry_risk() and its dependents actually read are
# required; the rest are accepted (Next.js's real objects carry them) but
# unused by this model.

class TleEntryModel(BaseModel):
    id: int
    name: str
    operator: str
    l1: str
    l2: str
    inclination: float
    raan: float
    argPerigee: float
    meanAnomaly: float
    meanMotion: float
    meanMotionDot: float
    tleEpoch: str
    isDebris: bool = False
    ecc: float
    perigeeKm: float
    apogeeKm: float
    semiMajorAxisKm: float


class ObjectTrendModel(BaseModel):
    noradId: int
    updatedAt: str
    trendVersion: int
    epochsAvailable: int
    historyDaysAvailable: float
    bstarLatest: float | None = None
    bstarSlope7d: float | None = None
    bstarSlope14d: float | None = None
    bstarSlope30d: float | None = None
    bstarMean14d: float | None = None
    bstarStddev14d: float | None = None
    bstarRsq14d: float | None = None
    perigeeLatest: float | None = None
    perigeeSlope7d: float | None = None
    perigeeSlope14d: float | None = None
    perigeeSlope30d: float | None = None
    apogeeLatest: float | None = None
    apogeeSlope14d: float | None = None
    smaLatest: float | None = None
    smaSlope7d: float | None = None
    smaSlope14d: float | None = None
    meanMotionDotLatest: float | None = None
    meanMotionDotMean14d: float | None = None
    decaySignal: Literal["decaying", "stable", "maneuvering", "insufficient_data"]
    maneuverLikelihood: float | None = None
    decayConfidence: float | None = None
    bstarSignalStrength: float | None = None
    ndotSignalStrength: float | None = None
    altitudeSignalStrength: float | None = None
    consensusRequired: Literal["full", "partial", "none"] | None = None
    consensusMet: bool | None = None
    estimatedDaysRemaining: float | None = None
    estimatedReentryAt: str | None = None
    reentryTier: Literal["critical", "warning", "nominal", "stable"]
    objectType: Literal["debris", "rocket_body", "payload", "unknown"] | None = None
    isDebris: bool


class ReentryRiskModel(BaseModel):
    satId: int
    bstar: float
    meanMotionDot: float
    signalsAgree: bool
    confidence: Literal["high", "medium", "low"]
    perigeeKm: float
    decayAltKm: float
    decayRateKmPerDay: float
    estimatedDaysRemaining: float | None
    tier: Literal["critical", "warning", "nominal", "stable"]
    source: Literal["single_epoch", "multi_epoch"] | None = None
    decaySignal: Literal["decaying", "stable", "maneuvering", "insufficient_data"] | None = None
    decayConfidence: float | None = None
    maneuverLikelihood: float | None = None
    epochsAvailable: int | None = None
    historyDaysAvailable: float | None = None
    estimatedReentryAt: str | None = None


class ReentryRequest(BaseModel):
    entry: TleEntryModel
    trend: ObjectTrendModel | None = None
    solarFluxMultiplier: float
