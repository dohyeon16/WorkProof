"""회원가입 / 로그인 계약 검증 (§9)."""
from sqlalchemy import select

from app.models.user import User


def _register(client, email="user@example.com", password="password123", name="테스터"):
    return client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": password, "name": name},
    )


def test_register_success_returns_201_and_tokens(client):
    r = _register(client)
    assert r.status_code == 201
    body = r.json()
    assert body["token_type"] == "bearer"
    assert body["access_token"]
    assert body["refresh_token"]
    assert body["expires_in"] > 0
    assert body["user"]["email"] == "user@example.com"
    assert body["user"]["primary_provider"] == "email"


def test_register_response_excludes_internal_fields(client):
    body = _register(client).json()
    user = body["user"]
    # 내부 정보는 응답에 없어야 한다.
    for leaked in ("password", "password_hash", "normalized_email", "deleted_at"):
        assert leaked not in user
    # 평문 비밀번호가 응답 어디에도 없어야 한다.
    assert "password123" not in r_text(body)


def r_text(obj):
    import json

    return json.dumps(obj, ensure_ascii=False)


def test_password_stored_as_argon2_hash_not_plaintext(client, db):
    _register(client)
    user = db.execute(select(User)).scalar_one()
    assert user.password_hash is not None
    assert user.password_hash != "password123"
    assert user.password_hash.startswith("$argon2")


def test_email_is_normalized(client, db):
    r = _register(client, email="User@Example.COM")
    assert r.status_code == 201
    user = db.execute(select(User)).scalar_one()
    assert user.normalized_email == "user@example.com"
    # 대소문자만 다른 로그인도 성공.
    login = client.post(
        "/api/v1/auth/login",
        json={"email": "user@example.com", "password": "password123"},
    )
    assert login.status_code == 200


def test_duplicate_email_returns_409(client):
    assert _register(client).status_code == 201
    # 대소문자 다른 동일 이메일도 중복으로 처리.
    dup = _register(client, email="USER@example.com")
    assert dup.status_code == 409


def test_register_short_password_422(client):
    r = _register(client, password="short")
    assert r.status_code == 422


def test_login_success_returns_200(client):
    _register(client)
    r = client.post(
        "/api/v1/auth/login",
        json={"email": "user@example.com", "password": "password123"},
    )
    assert r.status_code == 200
    assert r.json()["access_token"]


def test_login_wrong_password_401(client):
    _register(client)
    r = client.post(
        "/api/v1/auth/login",
        json={"email": "user@example.com", "password": "wrongpassword"},
    )
    assert r.status_code == 401


def test_login_unknown_account_same_error_as_wrong_password(client):
    _register(client)
    wrong_pw = client.post(
        "/api/v1/auth/login",
        json={"email": "user@example.com", "password": "wrongpassword"},
    )
    unknown = client.post(
        "/api/v1/auth/login",
        json={"email": "nobody@example.com", "password": "whatever12"},
    )
    assert wrong_pw.status_code == unknown.status_code == 401
    # 사용자 존재 여부를 메시지로 구분하지 않는다.
    assert wrong_pw.json()["detail"] == unknown.json()["detail"]


def test_login_blocked_for_deleted_account(client):
    reg = _register(client).json()
    access = reg["access_token"]
    # 계정 삭제.
    d = client.delete(
        "/api/v1/users/me", headers={"Authorization": f"Bearer {access}"}
    )
    assert d.status_code == 204
    # 삭제된 계정 로그인 차단(동일 401 메시지).
    r = client.post(
        "/api/v1/auth/login",
        json={"email": "user@example.com", "password": "password123"},
    )
    assert r.status_code == 401
