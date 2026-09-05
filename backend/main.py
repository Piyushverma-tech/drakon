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

No /compute/* routes are wired yet. They land once a model function
actually exists behind them (Phase 4 for re-entry) -- see compute/reentry.py.
Adding a route ahead of its model would mean serving fabricated results.
"""
from fastapi import FastAPI

from contracts import HealthResponse, ModelInfo, ModelsResponse
from compute.registry import MODEL_REGISTRY

app = FastAPI(title="DRAKON Compute Engine", version="0.1.0")


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
