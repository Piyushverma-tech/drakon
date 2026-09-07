"""HTTP-level test for POST /compute/reentry.

test_resolve_reentry_risk_golden_fixtures.py already proves
resolve_reentry_risk() itself matches the golden fixtures. This file proves
the wire path around it -- Pydantic request validation, camelCase field
mapping, JSON response serialization -- doesn't lose or mangle anything
along the way. Same fixture cases, sent as real HTTP requests instead of
called as a plain Python function.
"""
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

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
    assert_matches_golden(response.json(), case["output"])
