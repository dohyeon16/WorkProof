"""근무 예정 API 검증: CRUD / 날짜·근무지 필터 / 자정 넘김 / 소유권 / 삭제된 근무지 참조."""
import uuid


def _auth(client, email="sch@example.com"):
    r = client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": "password123", "name": "사용자"},
    )
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _workplace(client, headers, **over):
    body = {"name": "카페", "hourly_wage": 11000}
    body.update(over)
    return client.post("/api/v1/workplaces", json=body, headers=headers).json()["id"]


def _create(client, headers, workplace_id, **over):
    body = {
        "workplace_id": workplace_id,
        "work_date": "2026-08-10",
        "start_time": "09:00",
        "end_time": "18:00",
    }
    body.update(over)
    return client.post("/api/v1/work-schedules", json=body, headers=headers)


def test_create_and_get(client):
    h = _auth(client)
    wp = _workplace(client, h)
    r = _create(client, h, wp, reminder_minutes=30)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["workplace_id"] == wp
    assert body["work_date"] == "2026-08-10"
    assert body["reminder_minutes"] == 30
    assert "user_id" not in body
    assert client.get(f"/api/v1/work-schedules/{body['id']}", headers=h).status_code == 200


def test_requires_auth(client):
    assert client.get("/api/v1/work-schedules").status_code == 401


def test_time_format_validation(client):
    h = _auth(client)
    wp = _workplace(client, h)
    assert _create(client, h, wp, start_time="9:00").status_code == 422
    assert _create(client, h, wp, start_time="24:00").status_code == 422
    assert _create(client, h, wp, end_time="99:99").status_code == 422


def test_midnight_crossing_allowed(client):
    h = _auth(client)
    wp = _workplace(client, h)
    # 종료가 시작보다 이른 자정 넘김 근무도 허용(서버는 대소를 강제하지 않음).
    r = _create(client, h, wp, start_time="22:00", end_time="06:00")
    assert r.status_code == 201
    assert r.json()["end_time"] == "06:00"


def test_end_time_optional(client):
    h = _auth(client)
    wp = _workplace(client, h)
    r = client.post(
        "/api/v1/work-schedules",
        json={"workplace_id": wp, "work_date": "2026-08-10", "start_time": "09:00"},
        headers=h,
    )
    assert r.status_code == 201
    assert r.json()["end_time"] is None


def test_reference_own_active_workplace_only(client):
    h1 = _auth(client, "s1@example.com")
    h2 = _auth(client, "s2@example.com")
    wp_other = _workplace(client, h2)
    # 타인 근무지 참조 → 422.
    assert _create(client, h1, wp_other).status_code == 422
    # 존재하지 않는 근무지 → 422.
    assert _create(client, h1, str(uuid.uuid4())).status_code == 422


def test_reference_deleted_workplace_rejected(client):
    h = _auth(client)
    wp = _workplace(client, h)
    client.delete(f"/api/v1/workplaces/{wp}", headers=h)
    # 삭제된 근무지에는 새 예정 연결 금지.
    assert _create(client, h, wp).status_code == 422


def test_deleting_workplace_keeps_schedules(client):
    h = _auth(client)
    wp = _workplace(client, h)
    sid = _create(client, h, wp).json()["id"]
    client.delete(f"/api/v1/workplaces/{wp}", headers=h)
    # 근무지 삭제해도 기존 예정은 보존(하드 cascade 아님).
    assert client.get(f"/api/v1/work-schedules/{sid}", headers=h).status_code == 200


def test_filters_and_ordering(client):
    h = _auth(client)
    wp_a = _workplace(client, h, name="A")
    wp_b = _workplace(client, h, name="B")
    _create(client, h, wp_a, work_date="2026-08-01")
    _create(client, h, wp_a, work_date="2026-08-20")
    _create(client, h, wp_b, work_date="2026-08-10")
    # workplace 필터.
    only_a = client.get(f"/api/v1/work-schedules?workplace_id={wp_a}", headers=h).json()
    assert len(only_a) == 2 and all(s["workplace_id"] == wp_a for s in only_a)
    # 날짜 범위 필터.
    ranged = client.get(
        "/api/v1/work-schedules?date_from=2026-08-05&date_to=2026-08-15", headers=h
    ).json()
    assert [s["work_date"] for s in ranged] == ["2026-08-10"]
    # 정렬: work_date 내림차순.
    dates = [s["work_date"] for s in client.get("/api/v1/work-schedules", headers=h).json()]
    assert dates == sorted(dates, reverse=True)
    # date_from > date_to → 422.
    assert client.get(
        "/api/v1/work-schedules?date_from=2026-08-20&date_to=2026-08-01", headers=h
    ).status_code == 422


def test_client_id_idempotent(client):
    h = _auth(client)
    wp = _workplace(client, h)
    a = _create(client, h, wp, client_id="s-1")
    b = _create(client, h, wp, client_id="s-1")
    assert a.status_code == 201 and b.status_code == 200
    assert a.json()["id"] == b.json()["id"]


def test_patch_and_ownership(client):
    h1 = _auth(client, "sp1@example.com")
    h2 = _auth(client, "sp2@example.com")
    wp = _workplace(client, h1)
    sid = _create(client, h1, wp).json()["id"]
    r = client.patch(
        f"/api/v1/work-schedules/{sid}", json={"start_time": "10:00"}, headers=h1
    )
    assert r.status_code == 200 and r.json()["start_time"] == "10:00"
    # 타인 수정/삭제 404.
    assert client.patch(
        f"/api/v1/work-schedules/{sid}", json={"start_time": "11:00"}, headers=h2
    ).status_code == 404
    assert client.delete(f"/api/v1/work-schedules/{sid}", headers=h2).status_code == 404


def test_delete_soft(client):
    h = _auth(client)
    wp = _workplace(client, h)
    sid = _create(client, h, wp).json()["id"]
    assert client.delete(f"/api/v1/work-schedules/{sid}", headers=h).status_code == 204
    assert client.get(f"/api/v1/work-schedules/{sid}", headers=h).status_code == 404
