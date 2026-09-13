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
#
# ReentryComputeEntry / ReentryComputeTrend are deliberately NOT mirrors of
# lib/types.ts's TleEntry / ObjectTrend. Those are the application's
# persistence models (~16 and ~30 fields respectively); this model only
# needs 8 and 17 of them. Coupling this contract to the full persistence
# schema would mean every unrelated column Next.js adds to its `object_trend`
# table is a potential (accidental) change to the compute engine's wire
# contract. ReentryComputeInput is a scientific model input -- it should
# stay stable even when the database schema changes, and it should be
# obvious from reading it alone what resolve_reentry_risk() actually needs,
# without cross-referencing lib/types.ts. The Next.js caller (Phase 6) maps
# its own TleEntry/ObjectTrend records down to this shape before calling;
# that mapping lives entirely on the Next.js side, not here.
#
# Field selection here is exhaustive and traceable: every field below is
# read somewhere in compute/reentry.py or compute/reentry_signals.py's
# ObjectTrend-facing functions (grep for entry["..."] / trend["..."] /
# trend.get("...") if this ever needs re-auditing after a compute/ change).

class ReentryComputeEntry(BaseModel):
    id: int
    name: str
    l1: str
    meanMotion: float
    meanMotionDot: float
    perigeeKm: float
    apogeeKm: float
    isDebris: bool = False


class ReentryComputeTrend(BaseModel):
    noradId: int
    epochsAvailable: int
    historyDaysAvailable: float
    decaySignal: Literal["decaying", "stable", "maneuvering", "insufficient_data"]
    reentryTier: Literal["critical", "warning", "nominal", "stable"]
    decayConfidence: float | None = None
    maneuverLikelihood: float | None = None
    bstarLatest: float | None = None
    bstarSlope14d: float | None = None
    perigeeLatest: float | None = None
    perigeeSlope14d: float | None = None
    smaLatest: float | None = None
    smaSlope14d: float | None = None
    meanMotionDotLatest: float | None = None
    meanMotionDotMean14d: float | None = None
    estimatedDaysRemaining: float | None = None
    estimatedReentryAt: str | None = None


class ReentryComputeInput(BaseModel):
    entry: ReentryComputeEntry
    trend: ReentryComputeTrend | None = None
    # Single combined atmospheric-density multiplier. Currently the ONLY
    # environmental input this model accepts -- solar-flux and geomagnetic
    # corrections are composed into one number upstream of this boundary
    # (see plan §8.3 and compute/satellite_helpers.py's
    # 'composed_environmental_multiplier' golden fixture case).
    #
    # Geomagnetic-correction work is underway in parallel on the TS side.
    # Once it lands, the future shape of this input is
    # solarFluxMultiplier x geomagneticCorrection -> re-entry model, i.e.
    # two separate named fields instead of one pre-multiplied number. That
    # is NOT implemented here yet -- no geomagnetic logic before this
    # model has full parity with its TS reference (Phase 5/6). When it
    # does land, it's a model-version bump: 0.1.0 (this port, exact TS
    # migration) -> 0.2.0 (geomagnetic-aware), not a silent field addition.
    # See compute/registry.py.
    solarFluxMultiplier: float


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


class ModelProvenance(BaseModel):
    """Result provenance, not just service metadata. Every model result
    should be traceable to the (id, version, parameterSet,
    calibrationVersion) tuple that produced it (plan §18-19) -- this is
    what makes that traceable on the wire, not just in the /models
    listing. calibrationVersion is None until there's an actual
    calibration step to version; the field exists now so adding one later
    doesn't change the response shape."""

    id: str
    version: str
    parameterSet: str
    calibrationVersion: str | None = None


class EngineInfo(BaseModel):
    version: str


class ComputeResponse(BaseModel):
    """Envelope every /compute/* route returns: the actual model result
    plus its provenance. Deliberately decided now rather than after
    Next.js starts depending on a naked result shape -- see plan §6 and
    backend/README.md."""

    result: ReentryRiskModel
    model: ModelProvenance
    engine: EngineInfo
