"""앱 '초기화'의 서버측 동작 검증: DELETE /api/v1/users/me/work-data.

회원탈퇴(DELETE /me)와 구분된다 — 업무 데이터(근무지·예정근무·출퇴근)만 물리
삭제하고 계정(user/oauth/refresh)은 유지한다. 재로그인하면 빈 상태로 시작하고,
다음 동기화(pull)에 과거 데이터가 다시 내려오지 않아야 한다(§4).
"""
import pytest

from app.models.attendance_record import AttendanceRecord
from app.models.user import User
from app.models.work_schedule import WorkSchedule
from app.models.workplace import Workplace
from app.services import work_data_service


def _register(client, email):
    r = client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": "password123", "name": "N"},
    )
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _seed(client, headers, tag):
    """근무지 1 + 예정 1 + 출퇴근 1 을 만든다. workplace_id 반환."""
    wp = client.post(
        "/api/v1/workplaces",
        json={"client_id": f"wp-{tag}", "name": f"WP {tag}", "hourly_wage": 10030},
        headers=headers,
    )
    assert wp.status_code == 201, wp.text
    wpid = wp.json()["id"]
    sc = client.post(
        "/api/v1/work-schedules",
        json={
            "client_id": f"sc-{tag}",
            "workplace_id": wpid,
            "work_date": "2026-08-15",
            "start_time": "09:00",
            "end_time": "18:00",
        },
        headers=headers,
    )
    assert sc.status_code == 201, sc.text
    ar = client.post(
        "/api/v1/attendance-records",
        json={
            "client_id": f"ar-{tag}",
            "workplace_id": wpid,
            "work_date": "2026-08-15",
            "clock_in": "09:00",
            "clock_out": "18:00",
        },
        headers=headers,
    )
    assert ar.status_code == 201, ar.text
    return wpid


def _counts(client, headers):
    return (
        len(client.get("/api/v1/workplaces", headers=headers).json()),
        len(client.get("/api/v1/work-schedules", headers=headers).json()),
        len(client.get("/api/v1/attendance-records", headers=headers).json()),
    )


def test_reset_deletes_all_work_data(client):
    h = _register(client, "reset-a@example.com")
    _seed(client, h, "a")
    assert _counts(client, h) == (1, 1, 1)

    r = client.delete("/api/v1/users/me/work-data", headers=h)
    assert r.status_code == 204, r.text

    # 목록(=sync pull)에 과거 데이터가 다시 내려오지 않는다.
    assert _counts(client, h) == (0, 0, 0)


def test_reset_does_not_touch_other_user(client):
    ha = _register(client, "reset-owner@example.com")
    hb = _register(client, "reset-bystander@example.com")
    _seed(client, ha, "own")
    _seed(client, hb, "by")

    assert client.delete("/api/v1/users/me/work-data", headers=ha).status_code == 204

    assert _counts(client, ha) == (0, 0, 0)
    # 타 사용자 데이터는 그대로.
    assert _counts(client, hb) == (1, 1, 1)


def test_reset_keeps_account_and_allows_relogin(client):
    email = "reset-keep@example.com"
    h = _register(client, email)
    _seed(client, h, "keep")

    assert client.delete("/api/v1/users/me/work-data", headers=h).status_code == 204

    # 계정 유지: /me 200, 같은 자격으로 재로그인 가능.
    assert client.get("/api/v1/users/me", headers=h).status_code == 200
    relogin = client.post(
        "/api/v1/auth/login", json={"email": email, "password": "password123"}
    )
    assert relogin.status_code == 200, relogin.text
    # 재로그인 세션에서도 데이터는 비어 있다.
    h2 = {"Authorization": f"Bearer {relogin.json()['access_token']}"}
    assert _counts(client, h2) == (0, 0, 0)


def test_reset_is_idempotent(client):
    h = _register(client, "reset-idem@example.com")
    _seed(client, h, "idem")
    assert client.delete("/api/v1/users/me/work-data", headers=h).status_code == 204
    # 두 번째도 데이터가 없어도 성공(204).
    assert client.delete("/api/v1/users/me/work-data", headers=h).status_code == 204
    assert _counts(client, h) == (0, 0, 0)


def test_reset_requires_auth(client):
    assert client.delete("/api/v1/users/me/work-data").status_code == 401


def test_reset_rolls_back_on_midway_failure(db, monkeypatch):
    """중간 삭제 실패 시 전체 롤백 — 부분 삭제가 남지 않는다."""
    from datetime import date

    from app.core import security

    user = User(
        email="rollback@example.com",
        normalized_email="rollback@example.com",
        name="R",
        password_hash=security.hash_password("password123"),
        primary_provider="email",
        is_active=True,
    )
    db.add(user)
    db.flush()
    wp = Workplace(user_id=user.id, name="WP", hourly_wage=10030)
    db.add(wp)
    db.flush()
    db.add(
        WorkSchedule(
            user_id=user.id, workplace_id=wp.id, work_date=date(2026, 8, 15), start_time="09:00"
        )
    )
    db.add(
        AttendanceRecord(
            user_id=user.id, workplace_id=wp.id, work_date=date(2026, 8, 15), clock_in="09:00"
        )
    )
    db.commit()

    # 3번째 삭제(workplaces)에서 실패하도록 execute 를 감싼다.
    real_execute = db.execute
    calls = {"n": 0}

    def flaky_execute(*args, **kwargs):
        calls["n"] += 1
        if calls["n"] == 3:
            raise RuntimeError("boom")
        return real_execute(*args, **kwargs)

    monkeypatch.setattr(db, "execute", flaky_execute)

    with pytest.raises(RuntimeError):
        work_data_service.reset_work_data(db, user)

    monkeypatch.undo()
    # 롤백되어 세 종류 모두 그대로 남아 있어야 한다(부분 삭제 없음).
    assert db.query(Workplace).filter_by(user_id=user.id).count() == 1
    assert db.query(WorkSchedule).filter_by(user_id=user.id).count() == 1
    assert db.query(AttendanceRecord).filter_by(user_id=user.id).count() == 1
