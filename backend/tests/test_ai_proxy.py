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


# ---- 하드닝: MIME/payload/timeout/network/malformed/forwarding/logging ----
def test_ocr_unsupported_mime_415(client, monkeypatch):
    monkeypatch.setattr(settings, "GOOGLE_VISION_API_KEY", "k")
    _mock_http(_fixed(200, {"responses": [{"fullTextAnnotation": {"text": "x"}}]}))
    r = client.post("/api/v1/ai/ocr", json={"content_base64": "AAAA", "mime_type": "text/plain"}, headers=_auth(client))
    assert r.status_code == 415


def test_ocr_oversized_payload_422(client, monkeypatch):
    monkeypatch.setattr(settings, "GOOGLE_VISION_API_KEY", "k")
    big = "A" * 12_000_001
    r = client.post("/api/v1/ai/ocr", json={"content_base64": big, "mime_type": "image/png"}, headers=_auth(client))
    assert r.status_code == 422


def test_ocr_missing_field_422(client):
    r = client.post("/api/v1/ai/ocr", json={"mime_type": "image/png"}, headers=_auth(client))
    assert r.status_code == 422


def test_ocr_timeout_504(client, monkeypatch):
    monkeypatch.setattr(settings, "GOOGLE_VISION_API_KEY", "k")

    def handler(request):
        raise httpx.TimeoutException("timeout", request=request)

    _mock_http(handler)
    r = client.post("/api/v1/ai/ocr", json={"content_base64": "AAAA", "mime_type": "image/png"}, headers=_auth(client))
    assert r.status_code == 504


def test_ocr_network_error_502(client, monkeypatch):
    monkeypatch.setattr(settings, "GOOGLE_VISION_API_KEY", "k")

    def handler(request):
        raise httpx.ConnectError("boom", request=request)

    _mock_http(handler)
    r = client.post("/api/v1/ai/ocr", json={"content_base64": "AAAA", "mime_type": "image/png"}, headers=_auth(client))
    assert r.status_code == 502


def test_ocr_malformed_provider_response_502(client, monkeypatch):
    monkeypatch.setattr(settings, "GOOGLE_VISION_API_KEY", "k")

    def handler(request):
        return httpx.Response(200, content=b"<html>not json</html>", headers={"content-type": "text/html"})

    _mock_http(handler)
    r = client.post("/api/v1/ai/ocr", json={"content_base64": "AAAA", "mime_type": "image/png"}, headers=_auth(client))
    assert r.status_code == 502


def test_proxy_does_not_forward_user_auth_and_adds_key(client, monkeypatch):
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "server-side-secret")
    seen = {}

    def handler(request):
        seen["auth"] = request.headers.get("authorization")
        seen["api_key_header"] = request.headers.get("x-goog-api-key")
        seen["url"] = str(request.url)
        return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": "요약"}]}}]})

    _mock_http(handler)
    headers = _auth(client)  # 사용자 Bearer(앱 JWT)
    r = client.post("/api/v1/ai/summarize", json={"text": "문서 원문"}, headers=headers)
    assert r.status_code == 200
    # 정책: 사용자 토큰은 provider 로 전달하지 않는다(서버가 key 로만 인증).
    assert seen["auth"] is None
    # 키는 헤더로만 전달되고 URL(로그에 남을 수 있음)에는 절대 넣지 않는다.
    assert seen["api_key_header"] == "server-side-secret"
    assert "server-side-secret" not in seen["url"]


def test_key_and_doc_text_not_logged(client, monkeypatch, caplog):
    monkeypatch.setattr(settings, "GOOGLE_VISION_API_KEY", "super-secret-key-xyz")
    secret_doc = "SENSITIVE_DOC_BODY_12345"
    _mock_http(_fixed(200, {"responses": [{"fullTextAnnotation": {"text": "ok"}}]}))
    with caplog.at_level("DEBUG"):
        r = client.post(
            "/api/v1/ai/ocr",
            json={"content_base64": secret_doc, "mime_type": "image/png"},
            headers=_auth(client),
        )
    assert r.status_code == 200
    assert "super-secret-key-xyz" not in caplog.text  # 키가 로그에 안 남음
    assert secret_doc not in caplog.text  # 문서 원문이 로그에 안 남음


# ---- 급여명세서 구조화(extract-payslip) ----
import json as _json  # noqa: E402


def test_extract_payslip_requires_auth(client):
    r = client.post("/api/v1/ai/extract-payslip", json={"ocr_text": "기본급 1,200,000"})
    assert r.status_code == 401


def test_extract_payslip_not_configured(client, monkeypatch):
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "")
    _mock_http(_fixed(200, {}))
    r = client.post("/api/v1/ai/extract-payslip", json={"ocr_text": "기본급 1,200,000"}, headers=_auth(client))
    assert r.status_code == 503


def test_extract_payslip_missing_field_422(client):
    r = client.post("/api/v1/ai/extract-payslip", json={}, headers=_auth(client))
    assert r.status_code == 422


def test_extract_payslip_success_returns_raw_json_and_forces_json_mode(client, monkeypatch):
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "server-key")
    model_json = '{"basePay": 1200000, "incomeTax": 39600, "netPay": 1100000}'
    captured = {}

    def handler(request):
        captured["url"] = str(request.url)
        captured["body"] = _json.loads(request.content.decode())
        return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": model_json}]}}]})

    _mock_http(handler)
    r = client.post(
        "/api/v1/ai/extract-payslip", json={"ocr_text": "기본급 1,200,000 소득세 39,600"}, headers=_auth(client)
    )
    assert r.status_code == 200
    # 서버는 모델 원문을 그대로 raw 로 돌려준다(파싱/정규화는 클라이언트가 담당).
    assert r.json()["raw"] == model_json
    assert "generateContent" in captured["url"]
    # JSON 모드를 강제한다.
    assert captured["body"]["generationConfig"]["responseMimeType"] == "application/json"
    assert "server-key" not in r.text  # 키 미노출


def test_extract_payslip_empty_result_422(client, monkeypatch):
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "k")
    _mock_http(_fixed(200, {"candidates": [{"content": {"parts": [{"text": ""}]}}]}))
    r = client.post("/api/v1/ai/extract-payslip", json={"ocr_text": "빈 응답"}, headers=_auth(client))
    assert r.status_code == 422


def test_extract_payslip_quota_429(client, monkeypatch):
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "k")
    _mock_http(_fixed(429, {"error": {"message": "RESOURCE_EXHAUSTED"}}))
    r = client.post("/api/v1/ai/extract-payslip", json={"ocr_text": "명세서"}, headers=_auth(client))
    assert r.status_code == 429
    assert "RESOURCE_EXHAUSTED" not in r.text  # 업스트림 원문 미노출


def test_extract_payslip_timeout_504(client, monkeypatch):
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "k")

    def handler(request):
        raise httpx.TimeoutException("timeout", request=request)

    _mock_http(handler)
    r = client.post("/api/v1/ai/extract-payslip", json={"ocr_text": "명세서"}, headers=_auth(client))
    assert r.status_code == 504


def test_extract_payslip_blocked_maps_502(client, monkeypatch):
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "k")
    _mock_http(_fixed(200, {"promptFeedback": {"blockReason": "SAFETY"}}))
    r = client.post("/api/v1/ai/extract-payslip", json={"ocr_text": "명세서"}, headers=_auth(client))
    assert r.status_code == 502


def test_extract_payslip_does_not_forward_auth_and_adds_key(client, monkeypatch):
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "server-side-secret")
    seen = {}

    def handler(request):
        seen["auth"] = request.headers.get("authorization")
        seen["api_key_header"] = request.headers.get("x-goog-api-key")
        seen["url"] = str(request.url)
        return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": "{}"}]}}]})

    _mock_http(handler)
    r = client.post("/api/v1/ai/extract-payslip", json={"ocr_text": "명세서"}, headers=_auth(client))
    assert r.status_code == 200
    assert seen["auth"] is None  # 사용자 토큰은 provider 로 전달 안 함
    assert seen["api_key_header"] == "server-side-secret"  # 키는 헤더로만
    assert "server-side-secret" not in seen["url"]
