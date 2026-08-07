"""AI 프록시(Phase 4C) 검증: 인증 필수 / 키 미설정 503 / 성공 / 빈 결과 / 업스트림 오류.

외부 Google 호출은 httpx.MockTransport 로 대체한다(실제 네트워크/키 없이 검증).
"""
import httpx
import pytest

from main import app
from app.api.v1 import ai_proxy as ai_router
from app.core.config import settings


def _auth(client, email="ai@example.com"):
    r = client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": "password123", "name": "사용자"},
    )
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _mock_http(handler):
    def _override():
        with httpx.Client(transport=httpx.MockTransport(handler)) as c:
            yield c

    app.dependency_overrides[ai_router.get_http_client] = _override


@pytest.fixture(autouse=True)
def _cleanup():
    yield
    app.dependency_overrides.pop(ai_router.get_http_client, None)


def _fixed(status_code, json_body):
    return lambda request: httpx.Response(status_code, json=json_body)


# ---- 인증 ----
def test_ocr_requires_auth(client):
    r = client.post("/api/v1/ai/ocr", json={"content_base64": "abc", "mime_type": "image/png"})
    assert r.status_code == 401


def test_summarize_requires_auth(client):
    r = client.post("/api/v1/ai/summarize", json={"text": "hello"})
    assert r.status_code == 401


# ---- 키 미설정 → 503 ----
def test_ocr_not_configured(client, monkeypatch):
    monkeypatch.setattr(settings, "GOOGLE_VISION_API_KEY", "")
    _mock_http(_fixed(200, {}))
    r = client.post("/api/v1/ai/ocr", json={"content_base64": "abc", "mime_type": "image/png"}, headers=_auth(client))
    assert r.status_code == 503


def test_summarize_not_configured(client, monkeypatch):
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "")
    _mock_http(_fixed(200, {}))
    r = client.post("/api/v1/ai/summarize", json={"text": "hello"}, headers=_auth(client))
    assert r.status_code == 503


# ---- OCR 성공/빈결과/PDF/업스트림 오류 ----
def test_ocr_image_success(client, monkeypatch):
    monkeypatch.setattr(settings, "GOOGLE_VISION_API_KEY", "server-side-key")
    captured = {}

    def handler(request):
        captured["url"] = str(request.url)
        return httpx.Response(200, json={"responses": [{"fullTextAnnotation": {"text": "근로계약서 내용"}}]})

    _mock_http(handler)
    r = client.post("/api/v1/ai/ocr", json={"content_base64": "AAAA", "mime_type": "image/png"}, headers=_auth(client))
    assert r.status_code == 200
    assert r.json()["text"] == "근로계약서 내용"
    assert "images:annotate" in captured["url"]  # 이미지 분기
    assert "server-side-key" not in r.text  # 키가 응답에 절대 노출되지 않음


def test_ocr_pdf_uses_files_annotate(client, monkeypatch):
    monkeypatch.setattr(settings, "GOOGLE_VISION_API_KEY", "k")
    captured = {}

    def handler(request):
        captured["url"] = str(request.url)
        return httpx.Response(200, json={"responses": [{"responses": [{"fullTextAnnotation": {"text": "pdf 텍스트"}}]}]})

    _mock_http(handler)
    r = client.post("/api/v1/ai/ocr", json={"content_base64": "AAAA", "mime_type": "application/pdf"}, headers=_auth(client))
    assert r.status_code == 200
    assert r.json()["text"] == "pdf 텍스트"
    assert "files:annotate" in captured["url"]


def test_ocr_empty_result_422(client, monkeypatch):
    monkeypatch.setattr(settings, "GOOGLE_VISION_API_KEY", "k")
    _mock_http(_fixed(200, {"responses": [{}]}))
    r = client.post("/api/v1/ai/ocr", json={"content_base64": "AAAA", "mime_type": "image/png"}, headers=_auth(client))
    assert r.status_code == 422


def test_ocr_upstream_403_maps_502(client, monkeypatch):
    monkeypatch.setattr(settings, "GOOGLE_VISION_API_KEY", "k")
    _mock_http(_fixed(403, {"error": {"message": "billing disabled"}}))
    r = client.post("/api/v1/ai/ocr", json={"content_base64": "AAAA", "mime_type": "image/png"}, headers=_auth(client))
    assert r.status_code == 502
    assert "billing" not in r.text  # 업스트림 원문 미노출


def test_ocr_upstream_429_maps_429(client, monkeypatch):
    monkeypatch.setattr(settings, "GOOGLE_VISION_API_KEY", "k")
    _mock_http(_fixed(429, {"error": {"message": "quota"}}))
    r = client.post("/api/v1/ai/ocr", json={"content_base64": "AAAA", "mime_type": "image/png"}, headers=_auth(client))
    assert r.status_code == 429


# ---- 요약 성공/차단 ----
def test_summarize_success(client, monkeypatch):
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "server-key")
    captured = {}

    def handler(request):
        captured["url"] = str(request.url)
        return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": "요약 결과예요."}]}}]})

    _mock_http(handler)
    r = client.post("/api/v1/ai/summarize", json={"text": "근로계약서 원문"}, headers=_auth(client))
    assert r.status_code == 200
    assert r.json()["summary"] == "요약 결과예요."
    assert "generateContent" in captured["url"]
    assert "server-key" not in r.text


def test_summarize_blocked_maps_502(client, monkeypatch):
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "k")
    _mock_http(_fixed(200, {"promptFeedback": {"blockReason": "SAFETY"}}))
    r = client.post("/api/v1/ai/summarize", json={"text": "x"}, headers=_auth(client))
    assert r.status_code == 502


def test_summarize_empty_body_422(client, monkeypatch):
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "k")
    _mock_http(_fixed(200, {"candidates": [{"content": {"parts": [{"text": ""}]}}]}))
    r = client.post("/api/v1/ai/summarize", json={"text": "some text"}, headers=_auth(client))
    assert r.status_code == 422
