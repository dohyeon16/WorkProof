"""직접 소셜 로그인 + 브릿지 교환 + 기존 OAuth 계약 보존 검증 (§9)."""
import time

import pytest
from sqlalchemy import select

from app.models.oauth_account import OAuthAccount
from app.models.user import User
from app.services import oauth_bridge, social_verify
from app.services.social_verify import VerifiedSocialIdentity


# --------------------------- 기존 OAuth 라우트 계약 보존 ---------------------------
def test_legacy_five_routes_still_registered(client):
    paths = client.app.openapi()["paths"]
    assert "get" in paths["/health"]
    assert "post" in paths["/auth/session/{provider}"]
    assert "get" in paths["/auth/{provider}/callback"]
    assert "get" in paths["/auth/session/{session_id}"]
    assert "delete" in paths["/auth/session/{session_id}"]


def test_legacy_health_contract_unchanged(client):
    r = client.get("/health")
    assert r.status_code == 200 and r.json() == {"status": "ok"}


def test_legacy_unknown_provider_contract_unchanged(client):
    r = client.post("/auth/session/unknown")
    assert r.status_code == 404
    assert r.json()["detail"] == "지원하지 않는 provider입니다."


# --------------------------- 직접 소셜 identity 위조 방지 ---------------------------
def test_direct_social_forgery_rejected_by_default(client):
    # 검증기 미등록 + ALLOW_UNVERIFIED_SOCIAL=False(기본) → 임의 provider_user_id
    # 로는 계정을 만들 수 없다(501). 이것이 계정 탈취 방지의 핵심 계약.
    r = client.post(
        "/api/v1/auth/social",
        json={
            "provider": "google",
            "provider_user_id": "victim-sub-123",
            "name": "공격자",
        },
    )
    assert r.status_code == 501


def test_direct_social_unsupported_provider_rejected(client):
    r = client.post(
        "/api/v1/auth/social",
        json={"provider": "myspace", "provider_user_id": "x", "name": "n"},
    )
    # 지원하지 않는 provider → 401(검증 실패).
    assert r.status_code == 401


def test_direct_social_success_with_registered_verifier(client, db):
    # 서버측 검증기가 credential 을 확인해 identity 를 확정하는 경우에만 성공.
    def fake_verifier(req):
        assert req.credential == "valid-credential"
        return VerifiedSocialIdentity(
            provider="google",
            provider_user_id="google-verified-999",
            email="social@example.com",
            name=req.name,
        )

    social_verify.register_verifier("google", fake_verifier)
    try:
        r = client.post(
            "/api/v1/auth/social",
            json={
                "provider": "google",
                "provider_user_id": "ignored-client-value",
                "name": "소셜유저",
                "credential": "valid-credential",
            },
        )
        assert r.status_code == 200
        body = r.json()
        assert body["access_token"]
        assert body["user"]["primary_provider"] == "google"
        # 저장된 provider_user_id 는 클라이언트 값이 아니라 검증기 반환값.
        acct = db.execute(select(OAuthAccount)).scalar_one()
        assert acct.provider_user_id == "google-verified-999"
    finally:
        social_verify.unregister_verifier("google")


def test_direct_social_invalid_credential_rejected(client):
    def rejecting_verifier(req):
        raise social_verify.SocialVerificationError("bad credential")

    social_verify.register_verifier("google", rejecting_verifier)
    try:
        r = client.post(
            "/api/v1/auth/social",
            json={
                "provider": "google",
                "provider_user_id": "x",
                "name": "n",
                "credential": "forged",
            },
        )
        assert r.status_code == 401
    finally:
        social_verify.unregister_verifier("google")


# --------------------------- 브릿지 교환 ---------------------------
@pytest.fixture()
def _clean_bridge():
    oauth_bridge.sessions.clear()
    yield
    oauth_bridge.sessions.clear()


def _seed_bridge(session_id, status, profile):
    oauth_bridge.sessions[session_id] = oauth_bridge.OAuthSession(
        provider=profile.get("provider", "google") if profile else "google",
        created_at=time.time(),
        status=status,
        profile=profile,
    )


def test_bridge_exchange_success_issues_tokens(client, db, _clean_bridge):
    _seed_bridge(
        "sess-success",
        "success",
        {
            "provider": "google",
            "providerUserId": "bridge-sub-1",
            "name": "브릿지유저",
            "email": "bridge@example.com",
        },
    )
    r = client.post(
        "/api/v1/auth/bridge/exchange", json={"bridge_session_id": "sess-success"}
    )
    assert r.status_code == 200
    body = r.json()
    assert body["access_token"] and body["refresh_token"]
    assert body["user"]["primary_provider"] == "google"
    # 사용자/소셜계정 생성 확인.
    user = db.execute(select(User)).scalar_one()
    assert user.name == "브릿지유저"
    acct = db.execute(select(OAuthAccount)).scalar_one()
    assert acct.provider == "google" and acct.provider_user_id == "bridge-sub-1"


def test_bridge_exchange_is_one_time(client, _clean_bridge):
    _seed_bridge(
        "sess-once",
        "success",
        {"provider": "google", "providerUserId": "sub-once", "name": "N"},
    )
    first = client.post(
        "/api/v1/auth/bridge/exchange", json={"bridge_session_id": "sess-once"}
    )
    assert first.status_code == 200
    # 재교환 거부(세션 소비됨).
    second = client.post(
        "/api/v1/auth/bridge/exchange", json={"bridge_session_id": "sess-once"}
    )
    assert second.status_code == 400


def test_bridge_exchange_rejects_pending(client, _clean_bridge):
    _seed_bridge("sess-pending", "pending", None)
    r = client.post(
        "/api/v1/auth/bridge/exchange", json={"bridge_session_id": "sess-pending"}
    )
    assert r.status_code == 400


def test_bridge_exchange_rejects_error(client, _clean_bridge):
    _seed_bridge("sess-error", "error", None)
    r = client.post(
        "/api/v1/auth/bridge/exchange", json={"bridge_session_id": "sess-error"}
    )
    assert r.status_code == 400


def test_bridge_exchange_rejects_unknown_session(client, _clean_bridge):
    r = client.post(
        "/api/v1/auth/bridge/exchange", json={"bridge_session_id": "does-not-exist"}
    )
    assert r.status_code == 400


def test_bridge_exchange_same_identity_reuses_user(client, db, _clean_bridge):
    profile = {
        "provider": "kakao",
        "providerUserId": "kakao-1",
        "name": "카카오",
        "email": None,
    }
    _seed_bridge("s1", "success", dict(profile))
    first = client.post(
        "/api/v1/auth/bridge/exchange", json={"bridge_session_id": "s1"}
    ).json()
    _seed_bridge("s2", "success", dict(profile))
    second = client.post(
        "/api/v1/auth/bridge/exchange", json={"bridge_session_id": "s2"}
    ).json()
    # 같은 소셜 identity → 같은 서버 사용자.
    assert first["user"]["id"] == second["user"]["id"]
    assert len(db.execute(select(User)).scalars().all()) == 1
