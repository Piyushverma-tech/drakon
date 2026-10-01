from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def test_health_ok():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_models_lists_reentry_resolution_as_experimental():
    response = client.get("/models")
    assert response.status_code == 200
    body = response.json()
    by_id = {m["model_id"]: m for m in body["models"]}
    assert "reentry_resolution" in by_id
    assert by_id["reentry_resolution"]["status"] == "experimental"
