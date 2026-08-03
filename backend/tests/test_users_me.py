"""users/me API 검증 (§9)."""


def _register(client, email="me@example.com"):
    return client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": "password123", "name": "원래이름"},
    ).json()


def _auth(access):
    return {"Authorization": f"Bearer {access}"}


def test_read_me_requires_auth(client):
    r = client.get("/api/v1/users/me")
    assert r.status_code == 401


def test_read_me_with_valid_token(client):
    reg = _register(client)
    r = client.get("/api/v1/users/me", headers=_auth(reg["access_token"]))
    assert r.status_code == 200
    body = r.json()
    assert body["email"] == "me@example.com"
    assert body["name"] == "원래이름"
    # 내부 필드 미노출.
    assert "password_hash" not in body


def test_read_me_invalid_token(client):
    r = client.get("/api/v1/users/me", headers=_auth("not-a-real-jwt"))
    assert r.status_code == 401


def test_update_name(client):
    reg = _register(client)
    r = client.patch(
        "/api/v1/users/me",
        json={"name": "새이름"},
        headers=_auth(reg["access_token"]),
    )
    assert r.status_code == 200
    assert r.json()["name"] == "새이름"
    # 재조회로 반영 확인.
    again = client.get("/api/v1/users/me", headers=_auth(reg["access_token"]))
    assert again.json()["name"] == "새이름"


def test_update_name_requires_auth(client):
    r = client.patch("/api/v1/users/me", json={"name": "X"})
    assert r.status_code == 401


def test_delete_me_then_access_blocked(client):
    reg = _register(client)
    access = reg["access_token"]
    d = client.delete("/api/v1/users/me", headers=_auth(access))
    assert d.status_code == 204
    # 탈퇴 후에는 (유효기간 내라도) access 토큰이 차단된다.
    after = client.get("/api/v1/users/me", headers=_auth(access))
    assert after.status_code == 401


def test_delete_me_revokes_refresh(client):
    reg = _register(client)
    access = reg["access_token"]
    refresh = reg["refresh_token"]
    client.delete("/api/v1/users/me", headers=_auth(access))
    # 탈퇴로 refresh 도 폐기 → 재발급 불가.
    r = client.post("/api/v1/auth/refresh", json={"refresh_token": refresh})
    assert r.status_code == 401
