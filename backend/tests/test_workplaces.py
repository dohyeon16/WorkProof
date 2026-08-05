"""근무지 API 검증: CRUD / 검증 / 소유권 / client_id 멱등 / soft-delete / PATCH."""
import uuid


def _auth(client, email="wp@example.com"):
    r = client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": "password123", "name": "사용자"},
    )
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _create(client, headers, **over):
    body = {"name": "카페", "hourly_wage": 11000}
    body.update(over)
    return client.post("/api/v1/workplaces", json=body, headers=headers)


# --- 기본 CRUD / 응답 형태 ---
def test_create_and_get(client):
    h = _auth(client)
    r = _create(client, h, address="서울", latitude=37.5, longitude=127.0)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["name"] == "카페"
    assert body["hourly_wage"] == 11000
    assert body["latitude"] == 37.5
    # 내부 필드 미노출.
    assert "user_id" not in body and "deleted_at" not in body
    got = client.get(f"/api/v1/workplaces/{body['id']}", headers=h)
    assert got.status_code == 200
    assert got.json()["id"] == body["id"]


def test_requires_auth(client):
    assert client.get("/api/v1/workplaces").status_code == 401
    assert _create(client, {}).status_code == 401


# --- 검증 ---
def test_blank_name_rejected(client):
    h = _auth(client)
    assert _create(client, h, name="   ").status_code == 422


def test_negative_wage_rejected(client):
    h = _auth(client)
    assert _create(client, h, hourly_wage=-1).status_code == 422


def test_coord_range_and_pairing(client):
    h = _auth(client)
    assert _create(client, h, latitude=91, longitude=0).status_code == 422
    assert _create(client, h, longitude=181, latitude=0).status_code == 422
    # 한쪽 좌표만 → 짝 안 맞음.
    assert _create(client, h, latitude=37.5).status_code == 422


# --- client_id 멱등 ---
def test_client_id_idempotent_replay(client):
    h = _auth(client)
    first = _create(client, h, client_id="local-1")
    assert first.status_code == 201
    again = _create(client, h, client_id="local-1", name="다른이름")
    # 재전송: 새로 만들지 않고 기존 레코드를 200 으로.
    assert again.status_code == 200
    assert again.json()["id"] == first.json()["id"]
    assert again.json()["name"] == "카페"  # 기존 값 유지


def test_client_id_after_delete_conflicts(client):
    h = _auth(client)
    made = _create(client, h, client_id="local-2")
    client.delete(f"/api/v1/workplaces/{made.json()['id']}", headers=h)
    # 삭제된 레코드의 client_id 재생성 → 409(부활 방지).
    assert _create(client, h, client_id="local-2").status_code == 409


def test_null_client_id_allows_multiple(client):
    h = _auth(client)
    assert _create(client, h).status_code == 201
    assert _create(client, h).status_code == 201  # client_id 없으면 매번 새로


# --- 목록 / 페이지네이션 ---
def test_list_excludes_deleted_and_paginates(client):
    h = _auth(client)
    ids = [_create(client, h, name=f"WP{i}").json()["id"] for i in range(3)]
    client.delete(f"/api/v1/workplaces/{ids[0]}", headers=h)
    listed = client.get("/api/v1/workplaces", headers=h).json()
    got_ids = {w["id"] for w in listed}
    assert ids[0] not in got_ids and ids[1] in got_ids
    # limit/offset.
    page = client.get("/api/v1/workplaces?limit=1&offset=0", headers=h).json()
    assert len(page) == 1
    assert client.get("/api/v1/workplaces?limit=0", headers=h).status_code == 422
    assert client.get("/api/v1/workplaces?limit=201", headers=h).status_code == 422


# --- 소유권 ---
def test_ownership_isolation(client):
    h1 = _auth(client, "owner1@example.com")
    h2 = _auth(client, "owner2@example.com")
    wid = _create(client, h1).json()["id"]
    # 타인은 조회/수정/삭제 모두 404(존재 노출 안 함).
    assert client.get(f"/api/v1/workplaces/{wid}", headers=h2).status_code == 404
    assert client.patch(
        f"/api/v1/workplaces/{wid}", json={"name": "X"}, headers=h2
    ).status_code == 404
    assert client.delete(f"/api/v1/workplaces/{wid}", headers=h2).status_code == 404
    # 타인 목록엔 안 보임.
    assert client.get("/api/v1/workplaces", headers=h2).json() == []


def test_bad_and_missing_id(client):
    h = _auth(client)
    assert client.get("/api/v1/workplaces/not-a-uuid", headers=h).status_code == 422
    assert client.get(
        f"/api/v1/workplaces/{uuid.uuid4()}", headers=h
    ).status_code == 404


# --- PATCH omitted vs null ---
def test_patch_omitted_and_explicit_null(client):
    h = _auth(client)
    wid = _create(client, h, address="원주소").json()["id"]
    # hourly_wage 만 수정 → address 유지(생략).
    r = client.patch(
        f"/api/v1/workplaces/{wid}", json={"hourly_wage": 12000}, headers=h
    )
    assert r.status_code == 200
    assert r.json()["hourly_wage"] == 12000 and r.json()["address"] == "원주소"
    # address 명시적 null → 제거.
    r2 = client.patch(f"/api/v1/workplaces/{wid}", json={"address": None}, headers=h)
    assert r2.json()["address"] is None
    # 빈 PATCH → no-op 200.
    assert client.patch(f"/api/v1/workplaces/{wid}", json={}, headers=h).status_code == 200


def test_patch_coords_must_pair(client):
    h = _auth(client)
    wid = _create(client, h).json()["id"]
    assert client.patch(
        f"/api/v1/workplaces/{wid}", json={"latitude": 37.5}, headers=h
    ).status_code == 422


# --- soft delete ---
def test_delete_is_soft_and_idempotent_404(client):
    h = _auth(client)
    wid = _create(client, h).json()["id"]
    assert client.delete(f"/api/v1/workplaces/{wid}", headers=h).status_code == 204
    assert client.get(f"/api/v1/workplaces/{wid}", headers=h).status_code == 404
    # 이미 삭제됨 → 재삭제 404.
    assert client.delete(f"/api/v1/workplaces/{wid}", headers=h).status_code == 404
