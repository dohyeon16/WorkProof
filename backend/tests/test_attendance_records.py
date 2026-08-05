"""출퇴근 기록 API 검증: CRUD / GPS 재계산(반경 경계) / 자정 넘김 / PATCH 좌표 / 소유권."""
import uuid


def _auth(client, email="att@example.com"):
    r = client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": "password123", "name": "사용자"},
    )
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _workplace(client, headers, **over):
    body = {"name": "카페", "hourly_wage": 11000}
    body.update(over)
    return client.post("/api/v1/workplaces", json=body, headers=headers).json()


def _create(client, headers, workplace_id, **over):
    body = {
        "workplace_id": workplace_id,
        "work_date": "2026-08-10",
        "clock_in": "09:00",
        "clock_out": "18:00",
        "break_minutes": 60,
    }
    body.update(over)
    return client.post("/api/v1/attendance-records", json=body, headers=headers)


def test_create_and_fields(client):
    h = _auth(client)
    wp = _workplace(client, h)["id"]
    r = _create(client, h, wp, note="  메모  ", is_holiday=True)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["clock_in"] == "09:00" and body["clock_out"] == "18:00"
    assert body["is_holiday"] is True
    assert body["note"] == "메모"  # trim 됨
    assert "user_id" not in body
    # 좌표 없으면 proximity null.
    assert body["clock_in_proximity"] is None


def test_requires_auth(client):
    assert client.get("/api/v1/attendance-records").status_code == 401


def test_clock_out_optional_inprogress(client):
    h = _auth(client)
    wp = _workplace(client, h)["id"]
    r = client.post(
        "/api/v1/attendance-records",
        json={"workplace_id": wp, "work_date": "2026-08-10", "clock_in": "09:00"},
        headers=h,
    )
    # 퇴근 전(진행 중) 기록 허용.
    assert r.status_code == 201
    assert r.json()["clock_out"] is None


def test_clock_in_required_and_time_format(client):
    h = _auth(client)
    wp = _workplace(client, h)["id"]
    # clock_in 누락 → 422.
    assert client.post(
        "/api/v1/attendance-records",
        json={"workplace_id": wp, "work_date": "2026-08-10"},
        headers=h,
    ).status_code == 422
    assert _create(client, h, wp, clock_in="9:00").status_code == 422


def test_midnight_crossing(client):
    h = _auth(client)
    wp = _workplace(client, h)["id"]
    r = _create(client, h, wp, clock_in="22:00", clock_out="06:00")
    assert r.status_code == 201


def test_negative_break_rejected(client):
    h = _auth(client)
    wp = _workplace(client, h)["id"]
    assert _create(client, h, wp, break_minutes=-1).status_code == 422


def test_gps_proximity_recomputed_within_radius(client):
    h = _auth(client)
    # 근무지 좌표.
    wp = _workplace(client, h, latitude=37.5000, longitude=127.0000)["id"]
    # 같은 좌표로 출근 → 거리 0, 반경 내.
    r = _create(
        client, h, wp, clock_in_latitude=37.5000, clock_in_longitude=127.0000
    )
    prox = r.json()["clock_in_proximity"]
    assert prox is not None
    assert prox["distance_m"] == 0 and prox["verified"] is True


def test_gps_proximity_outside_radius(client):
    h = _auth(client)
    wp = _workplace(client, h, latitude=37.5000, longitude=127.0000)["id"]
    # 위도 0.01도 ≈ 1.1km → 반경(200m) 밖.
    r = _create(
        client, h, wp, clock_in_latitude=37.5100, clock_in_longitude=127.0000
    )
    prox = r.json()["clock_in_proximity"]
    assert prox["verified"] is False and prox["distance_m"] > 200


def test_proximity_null_when_workplace_has_no_coords(client):
    h = _auth(client)
    wp = _workplace(client, h)["id"]  # 좌표 없음
    r = _create(
        client, h, wp, clock_in_latitude=37.5, clock_in_longitude=127.0
    )
    assert r.json()["clock_in_proximity"] is None


def test_client_sent_distance_ignored(client):
    """클라가 거리 필드를 보내도 무시된다(스키마에 없어 422도 아니고 저장/반영 안 됨)."""
    h = _auth(client)
    wp = _workplace(client, h, latitude=37.5, longitude=127.0)["id"]
    body = {
        "workplace_id": wp,
        "work_date": "2026-08-10",
        "clock_in": "09:00",
        "clock_in_latitude": 37.5,
        "clock_in_longitude": 127.0,
        "distance": 99999,  # 무시됨(모델에 없음)
    }
    r = client.post("/api/v1/attendance-records", json=body, headers=h)
    assert r.status_code == 201
    assert r.json()["clock_in_proximity"]["distance_m"] == 0  # 서버 재계산값


def test_coords_must_pair(client):
    h = _auth(client)
    wp = _workplace(client, h)["id"]
    assert _create(client, h, wp, clock_in_latitude=37.5).status_code == 422


def test_patch_gps_preserved_and_cleared(client):
    h = _auth(client)
    wp = _workplace(client, h, latitude=37.5, longitude=127.0)["id"]
    rid = _create(
        client, h, wp, clock_in_latitude=37.5, clock_in_longitude=127.0
    ).json()["id"]
    # note 만 수정 → 좌표 유지.
    r = client.patch(
        f"/api/v1/attendance-records/{rid}", json={"note": "x"}, headers=h
    )
    assert r.json()["clock_in_latitude"] == 37.5
    # 좌표 쌍을 명시적 null 로 제거.
    r2 = client.patch(
        f"/api/v1/attendance-records/{rid}",
        json={"clock_in_latitude": None, "clock_in_longitude": None},
        headers=h,
    )
    assert r2.json()["clock_in_latitude"] is None
    assert r2.json()["clock_in_proximity"] is None
    # 좌표 한쪽만 수정 → 422.
    assert client.patch(
        f"/api/v1/attendance-records/{rid}",
        json={"clock_in_latitude": 37.5},
        headers=h,
    ).status_code == 422


def test_filters(client):
    h = _auth(client)
    wp_a = _workplace(client, h, name="A")["id"]
    wp_b = _workplace(client, h, name="B")["id"]
    _create(client, h, wp_a, work_date="2026-08-01")
    _create(client, h, wp_b, work_date="2026-08-20")
    only_a = client.get(
        f"/api/v1/attendance-records?workplace_id={wp_a}", headers=h
    ).json()
    assert len(only_a) == 1 and only_a[0]["workplace_id"] == wp_a
    ranged = client.get(
        "/api/v1/attendance-records?date_from=2026-08-15", headers=h
    ).json()
    assert [r["work_date"] for r in ranged] == ["2026-08-20"]


def test_ownership_and_missing(client):
    h1 = _auth(client, "ao1@example.com")
    h2 = _auth(client, "ao2@example.com")
    wp = _workplace(client, h1)["id"]
    rid = _create(client, h1, wp).json()["id"]
    assert client.get(f"/api/v1/attendance-records/{rid}", headers=h2).status_code == 404
    assert client.delete(
        f"/api/v1/attendance-records/{rid}", headers=h2
    ).status_code == 404
    assert client.get(
        f"/api/v1/attendance-records/{uuid.uuid4()}", headers=h1
    ).status_code == 404


def test_client_id_idempotent_and_conflict(client):
    h = _auth(client)
    wp = _workplace(client, h)["id"]
    a = _create(client, h, wp, client_id="a-1")
    b = _create(client, h, wp, client_id="a-1")
    assert a.status_code == 201 and b.status_code == 200
    assert a.json()["id"] == b.json()["id"]
    client.delete(f"/api/v1/attendance-records/{a.json()['id']}", headers=h)
    assert _create(client, h, wp, client_id="a-1").status_code == 409


def test_delete_soft(client):
    h = _auth(client)
    wp = _workplace(client, h)["id"]
    rid = _create(client, h, wp).json()["id"]
    assert client.delete(f"/api/v1/attendance-records/{rid}", headers=h).status_code == 204
    assert client.get(f"/api/v1/attendance-records/{rid}", headers=h).status_code == 404
