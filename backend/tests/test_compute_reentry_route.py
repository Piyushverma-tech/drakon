"""HTTP-level test for POST /compute/reentry.

test_resolve_reentry_risk_golden_fixtures.py already proves
resolve_reentry_risk() itself matches the golden fixtures. This file proves
the wire path around it -- Pydantic request validation (against the narrow
ReentryComputeInput contract, not the full TleEntry/ObjectTrend shape --
extra fields present in the golden fixture's entry/trend objects are
harmless, Pydantic ignores unknown fields by default), camelCase field
mapping, and the ComputeResponse envelope -- doesn't lose or mangle
anything along the way. Same fixture cases, sent as real HTTP requests
instead of called as a plain Python function.
"""
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from compute.registry import ENGINE_VERSION, MODEL_REGISTRY
from main import app
from tests._golden_compare import assert_matches_golden

client = TestClient(app)

FIXTURE_PATH = (
    Path(__file__).resolve().parents[2] / "fixtures" / "reentry-model" / "golden_cases.json"
)

with open(FIXTURE_PATH, encoding="utf-8") as f:
    GOLDEN = json.load(f)


@pytest.mark.parametrize(
    "case", GOLDEN["resolveReentryRisk"], ids=lambda c: c["id"]
)
def test_compute_reentry_route(case):
    response = client.post("/compute/reentry", json=case["input"])
    assert response.status_code == 200, response.text
    body = response.json()
    assert_matches_golden(body["result"], case["output"])


def test_compute_reentry_route_provenance_envelope():
    case = next(c for c in GOLDEN["resolveReentryRisk"] if c["id"] == "normal_decaying_debris")
    response = client.post("/compute/reentry", json=case["input"])
    assert response.status_code == 200, response.text
    body = response.json()

    registry_entry = MODEL_REGISTRY["reentry_resolution"]
    assert body["model"] == {
        "id": "reentry_resolution",
        "version": registry_entry["version"],
        "parameterSet": registry_entry["parameter_set"],
        "calibrationVersion": None,
    }
    assert body["engine"] == {"version": ENGINE_VERSION}
    assert set(body.keys()) == {"result", "model", "engine"}
