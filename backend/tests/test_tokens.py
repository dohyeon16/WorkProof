"""JWT access 토큰 + refresh rotation/재사용 방어 검증 (§9)."""
import time
import uuid

import jwt
import pytest
from sqlalchemy import select

from app.core import security
from app.models.refresh_token import RefreshToken


# --------------------------- access JWT 단위 ---------------------------
def test_access_token_roundtrip():
    sub = str(uuid.uuid4())
    token, expires_in = security.create_access_token(sub)
    assert expires_in == security.settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
    payload = security.decode_access_token(token)
    assert payload["sub"] == sub
    assert payload["type"] == "access"
    assert "jti" in payload and "iat" in payload and "exp" in payload


def test_access_token_bad_signature_rejected():
    token, _ = security.create_access_token(str(uuid.uuid4()))
    tampered = token[:-2] + ("aa" if not token.endswith("aa") else "bb")
    with pytest.raises(jwt.PyJWTError):
        security.decode_access_token(tampered)


def test_access_token_wrong_secret_rejected():
    token = jwt.encode(
        {"sub": "x", "type": "access", "iat": 1, "exp": 9999999999, "jti": "j"},
        "some-other-secret",
        algorithm="HS256",
    )
    with pytest.raises(jwt.PyJWTError):
        security.decode_access_token(token)


def test_access_token_expired_rejected():
    token, _ = security.create_access_token(str(uuid.uuid4()), expires_minutes=0)
    time.sleep(1)
    with pytest.raises(jwt.ExpiredSignatureError):
        security.decode_access_token(token)


def test_access_token_wrong_type_rejected():
    # type != access 는 거부.
    token = jwt.encode(
        {"sub": "x", "type": "refresh", "iat": 1, "exp": 9999999999, "jti": "j"},
        security.settings.JWT_SECRET_KEY,
        algorithm="HS256",
    )
    with pytest.raises(jwt.InvalidTokenError):
        security.decode_access_token(token)


# --------------------------- refresh rotation (API) ---------------------------
def _register(client):
    return client.post(
        "/api/v1/auth/register",
        json={"email": "u@example.com", "password": "password123", "name": "N"},
    ).json()


def test_refresh_rotation_issues_new_and_revokes_old(client, db):
    reg = _register(client)
    r1 = reg["refresh_token"]

    resp = client.post("/api/v1/auth/refresh", json={"refresh_token": r1})
    assert resp.status_code == 200
    r2 = resp.json()["refresh_token"]
    assert r2 != r1

    # 이전 토큰(r1)은 폐기되어 재사용 불가.
    reuse = client.post("/api/v1/auth/refresh", json={"refresh_token": r1})
    assert reuse.status_code == 401


def test_only_hash_is_stored_not_raw(client, db):
    reg = _register(client)
    raw = reg["refresh_token"]
    rows = db.execute(select(RefreshToken)).scalars().all()
    assert len(rows) == 1
    # 원문은 저장되지 않고 SHA-256 hash 만.
    assert rows[0].token_hash != raw
    assert rows[0].token_hash == security.sha256_hex(raw)
    assert len(rows[0].token_hash) == 64


def test_expired_refresh_rejected(client, db):
    from datetime import timedelta

    reg = _register(client)
    raw = reg["refresh_token"]
    # 저장된 토큰을 강제 만료시킨다.
    row = db.execute(select(RefreshToken)).scalar_one()
    row.expires_at = security.utcnow() - timedelta(days=1)
    db.commit()

    resp = client.post("/api/v1/auth/refresh", json={"refresh_token": raw})
    assert resp.status_code == 401


def test_reuse_of_revoked_token_revokes_entire_family(client, db):
    reg = _register(client)
    r1 = reg["refresh_token"]
    r2 = client.post("/api/v1/auth/refresh", json={"refresh_token": r1}).json()[
        "refresh_token"
    ]
    # r1(폐기됨) 재사용 → family 전체 폐기.
    reuse = client.post("/api/v1/auth/refresh", json={"refresh_token": r1})
    assert reuse.status_code == 401
    # 같은 family 의 유효했던 r2 도 이제 폐기되어 사용 불가.
    r2_after = client.post("/api/v1/auth/refresh", json={"refresh_token": r2})
    assert r2_after.status_code == 401
    # DB 상: family 내 모든 토큰 revoked.
    rows = db.execute(select(RefreshToken)).scalars().all()
    assert all(row.revoked_at is not None for row in rows)


def test_logout_revokes_refresh(client):
    reg = _register(client)
    raw = reg["refresh_token"]
    out = client.post("/api/v1/auth/logout", json={"refresh_token": raw})
    assert out.status_code == 200
    assert out.json() == {"ok": True}
    # 로그아웃 후 재사용 차단.
    resp = client.post("/api/v1/auth/refresh", json={"refresh_token": raw})
    assert resp.status_code == 401


def test_unknown_refresh_rejected(client):
    resp = client.post(
        "/api/v1/auth/refresh", json={"refresh_token": "nonexistent-token-value"}
    )
    assert resp.status_code == 401
