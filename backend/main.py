"""DRAKON Compute Engine -- FastAPI service entrypoint.

This service is PRIVATE (docs/DRAKON_COMPUTE_ENGINE_EXTRACTION_PLAN.md §5).
It has no public route in /vercel.json's `rewrites` -- it is reached only
from server-side Next.js code via a Vercel Service Binding
(`BACKEND_URL`, declared on the `web` service in /vercel.json). This module
itself has zero knowledge of that: it does not read BACKEND_URL, does not
know it's on Vercel, and would run identically as a plain `uvicorn main:app`
behind any other private network boundary. That knowledge lives entirely on
the Next.js caller's side, by design -- see backend/README.md.

Route handlers stay thin: HTTP -> validate -> call a compute/ function ->
serialize. No scientific/model logic belongs here directly (plan §6).

/compute/reentry (Phase 4, done) is the first model route. It exists now
because resolve_reentry_risk() exists and is parity-tested -- routes only
get added once a real model backs them (see compute/reentry.py). This is
still `reentry_resolution`'s "experimental" status: shadow-mode comparison
against the TypeScript reference (Phase 6+) hasn't run yet.

Every /compute/* route returns a ComputeResponse envelope (result +
provenance), never a naked result object -- decided now, before Next.js
starts depending on the shape, specifically so the response contract
doesn't need redesigning once a real caller exists. See contracts.py.
"""
from fastapi import FastAPI

from contracts import (
    ComputeResponse,
    EngineInfo,
    HealthResponse,
    ModelInfo,
    ModelProvenance,
    ModelsResponse,
    ReentryComputeInput,
    ReentryRiskModel,
)
from compute.registry import ENGINE_VERSION, MODEL_REGISTRY
from compute.reentry import resolve_reentry_risk

app = FastAPI(title="DRAKON Compute Engine", version=ENGINE_VERSION)


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(status="ok")


@app.get("/models", response_model=ModelsResponse)
def models() -> ModelsResponse:
    return ModelsResponse(
        models=[
            ModelInfo(model_id=model_id, **meta)
            for model_id, meta in MODEL_REGISTRY.items()
        ]
    )


@app.post(
    "/compute/reentry",
    response_model=ComputeResponse,
    response_model_exclude_unset=True,
)
def compute_reentry(payload: ReentryComputeInput) -> ComputeResponse:
    entry = payload.entry.model_dump()
    trend = payload.trend.model_dump() if payload.trend is not None else None
    result = resolve_reentry_risk(entry, trend, payload.solarFluxMultiplier)

    registry_entry = MODEL_REGISTRY["reentry_resolution"]
    return ComputeResponse(
        result=ReentryRiskModel(**result),
        model=ModelProvenance(
            id="reentry_resolution",
            version=registry_entry["version"],
            parameterSet=registry_entry["parameter_set"],
            calibrationVersion=None,
        ),
        engine=EngineInfo(version=ENGINE_VERSION),
    )
