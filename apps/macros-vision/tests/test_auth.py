from fastapi.testclient import TestClient

from macros_vision.app import app, state


class FakeEngine:
    def read(self, _image: bytes):
        raise AssertionError("not used")


def test_health_requires_loaded_model() -> None:
    state.ready = False
    state.engine = None
    with TestClient(app) as client:
        assert client.get("/healthz").status_code == 200


def test_label_requires_bearer_token(monkeypatch) -> None:
    monkeypatch.setenv("MACROS_VISION_API_TOKEN", "secret")
    with TestClient(app) as client:
        response = client.post(
            "/v1/label",
            files={"image": ("label.jpg", b"not-an-image", "image/jpeg")},
        )
    assert response.status_code == 401
