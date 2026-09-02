"""앱 import, health 경로, 기존 OAuth 라우트 보존 검증.

외부(Google/Kakao/Naver) 네트워크 요청이나 실제 code 교환은 하지 않는다 —
모든 케이스가 네트워크 이전 단계에서 결정된다.
"""
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def test_app_import_and_title():
    # 1) app import 성공 + 기존 title 유지
    assert app.title == "WorkProof Auth Bridge"


def test_legacy_health_unchanged():
    # 2) 기존 GET /health 응답/상태코드 유지
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_v1_health():
    # 3) 신규 GET /api/v1/health
    r = client.get("/api/v1/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "service": "workproof-backend"}


def test_v1_health_db_without_database_url():
    # 7) DATABASE_URL이 없어도 앱은 정상, db health만 명확히 비정상 상태 반환
    r = client.get("/api/v1/health/db")
    assert r.status_code == 503
    assert r.json()["database"] == "not_configured"


def test_legacy_oauth_routes_registered():
    # 4) 기존 OAuth 5개 라우트가 등록돼 있는지(경로 + method).
    # OpenAPI 스키마로 확인한다 — Starlette 버전에 따라 app.routes가 포함 라우터를
    # 중첩(_IncludedRouter)으로 담아 평탄하지 않을 수 있어, 노출 경로 기준이 안정적이다.
    paths = app.openapi()["paths"]
    assert "get" in paths["/health"]
    assert "post" in paths["/auth/session/{provider}"]
    assert "get" in paths["/auth/{provider}/callback"]
    assert "get" in paths["/auth/session/{session_id}"]
    assert "delete" in paths["/auth/session/{session_id}"]


def test_unsupported_provider_create_session_unchanged():
    # 5) 지원하지 않는 provider의 기존 오류 동작 유지 (404 + 동일 메시지)
    r = client.post("/auth/session/unknown")
    assert r.status_code == 404
    assert r.json()["detail"] == "지원하지 않는 provider입니다."


def test_unsupported_provider_callback_unchanged():
    # 5) 콜백도 동일하게 404 결과 페이지(네트워크 미발생)
    r = client.get("/auth/unknown/callback", params={"state": "x"})
    assert r.status_code == 404
    assert "잘못된 요청이에요." in r.text


def test_configured_provider_without_client_id_returns_503():
    # provider는 지원하지만 client_id 미설정(테스트 env) → 네트워크 이전 503
    r = client.post("/auth/session/google")
    assert r.status_code == 503
