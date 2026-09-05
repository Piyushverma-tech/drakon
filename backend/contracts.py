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
