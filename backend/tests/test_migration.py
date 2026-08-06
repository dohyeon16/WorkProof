"""Alembic 마이그레이션 검증 (§9).

- head 가 정확히 1개(0002_auth_tables)이고 0001 → 0002 체인이 이어지는지.
- upgrade/downgrade 함수가 존재하는지.
- offline(--sql) 로 PostgreSQL 방언 SQL 을 생성해 세 테이블 CREATE 와
  부분 unique index(WHERE deleted_at IS NULL)가 포함되는지(실 DB 무접속).
"""
import os
import subprocess
import sys

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _alembic_config():
    from alembic.config import Config

    return Config(os.path.join(BACKEND_DIR, "alembic.ini"))


def test_single_head_is_workplace_policy():
    from alembic.script import ScriptDirectory

    script = ScriptDirectory.from_config(_alembic_config())
    heads = list(script.get_heads())
    assert heads == ["0004_workplace_policy"], f"단일 head 여야 함: {heads}"


def test_revision_chain_0004_to_0001_to_base():
    from alembic.script import ScriptDirectory

    script = ScriptDirectory.from_config(_alembic_config())
    policy = script.get_revision("0004_workplace_policy")
    assert policy.down_revision == "0003_work_data"
    work = script.get_revision("0003_work_data")
    assert work.down_revision == "0002_auth_tables"
    rev = script.get_revision("0002_auth_tables")
    assert rev.down_revision == "0001_initial"
    base = script.get_revision("0001_initial")
    assert base.down_revision is None


def test_0004_migration_has_upgrade_and_downgrade():
    from alembic.script import ScriptDirectory

    script = ScriptDirectory.from_config(_alembic_config())
    module = script.get_revision("0004_workplace_policy").module
    assert callable(module.upgrade)
    assert callable(module.downgrade)


def test_work_data_migration_has_upgrade_and_downgrade():
    from alembic.script import ScriptDirectory

    script = ScriptDirectory.from_config(_alembic_config())
    module = script.get_revision("0003_work_data").module
    assert callable(module.upgrade)
    assert callable(module.downgrade)


def test_migration_has_upgrade_and_downgrade():
    from alembic.script import ScriptDirectory

    script = ScriptDirectory.from_config(_alembic_config())
    module = script.get_revision("0002_auth_tables").module
    assert callable(module.upgrade)
    assert callable(module.downgrade)


def test_offline_sql_creates_all_three_tables():
    # 별도 프로세스로 offline SQL 생성 — 새 프로세스라 DATABASE_URL(placeholder)이
    # settings 에 반영된다. 실제 DB 에는 접속하지 않는다(--sql).
    env = dict(os.environ)
    env["DATABASE_URL"] = "postgresql+psycopg://ci:ci@localhost/workproof_ci"
    env["SESSION_SIGNING_SECRET"] = "test-signing-secret-not-a-real-value"
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head", "--sql"],
        cwd=BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    sql = result.stdout.lower()
    assert "create table users" in sql
    assert "create table oauth_accounts" in sql
    assert "create table refresh_tokens" in sql
    # 부분 unique index 가 PostgreSQL WHERE 절과 함께 렌더링되는지.
    assert "where deleted_at is null" in sql


def test_offline_sql_0003_creates_work_data_tables():
    env = dict(os.environ)
    env["DATABASE_URL"] = "postgresql+psycopg://ci:ci@localhost/workproof_ci"
    env["SESSION_SIGNING_SECRET"] = "test-signing-secret-not-a-real-value"
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "0002_auth_tables:0003_work_data", "--sql"],
        cwd=BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    sql = result.stdout.lower()
    assert "create table workplaces" in sql
    assert "create table work_schedules" in sql
    assert "create table attendance_records" in sql
    assert "uq_workplaces_user_client" in sql
    assert "ck_workplaces_coords_paired" in sql


def test_offline_sql_0004_adds_policy_columns():
    env = dict(os.environ)
    env["DATABASE_URL"] = "postgresql+psycopg://ci:ci@localhost/workproof_ci"
    env["SESSION_SIGNING_SECRET"] = "test-signing-secret-not-a-real-value"
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "alembic",
            "upgrade",
            "0003_work_data:0004_workplace_policy",
            "--sql",
        ],
        cwd=BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    sql = result.stdout.lower()
    assert "add column pay_day" in sql
    assert "weekly_allowance" in sql
    assert "income_deduction_type" in sql
    assert "break_minutes_per_shift" in sql
    assert "ck_workplaces_pay_day_range" in sql


def _run_alembic(db_url, *args):
    env = dict(os.environ)
    env["DATABASE_URL"] = db_url
    env["SESSION_SIGNING_SECRET"] = "test-signing-secret-not-a-real-value"
    env["JWT_SECRET_KEY"] = "test-jwt-secret-not-a-real-value"
    return subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
    )


def _sqlite_tables(path):
    import sqlite3

    con = sqlite3.connect(path)
    try:
        rows = con.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
    finally:
        con.close()
    return {r[0] for r in rows}


def test_upgrade_downgrade_roundtrip_sqlite(tmp_path):
    """빈 DB → head 업그레이드 → 0002 다운그레이드 → 다시 head. DDL 만 실행(실 DB 무접속).

    다운그레이드 시 work-data 테이블만 사라지고 auth 테이블(users 등)은 보존되는지 확인.
    """
    db_file = tmp_path / "roundtrip.db"
    db_url = f"sqlite:///{db_file.as_posix()}"

    up = _run_alembic(db_url, "upgrade", "head")
    assert up.returncode == 0, up.stderr
    tables = _sqlite_tables(str(db_file))
    assert {"users", "workplaces", "work_schedules", "attendance_records"} <= tables

    down = _run_alembic(db_url, "downgrade", "0002_auth_tables")
    assert down.returncode == 0, down.stderr
    tables = _sqlite_tables(str(db_file))
    assert "users" in tables  # auth 보존
    assert not {"workplaces", "work_schedules", "attendance_records"} & tables

    up2 = _run_alembic(db_url, "upgrade", "head")
    assert up2.returncode == 0, up2.stderr
    tables = _sqlite_tables(str(db_file))
    assert {"workplaces", "work_schedules", "attendance_records"} <= tables


def test_0004_backfills_existing_rows_sqlite(tmp_path):
    """3B 이전에 생긴 정책 필드 없는 행이, 0004 적용 후 server_default 로 채워지는지.

    0003 상태에서 근무지 1건을 직접 INSERT → head(0004) 업그레이드 → 정책 컬럼이
    기본값(pay_day=10 등)으로 백필됐는지 확인. 기존 사용자 데이터 손실 없는 마이그레이션.
    """
    import sqlite3
    import uuid

    db_file = tmp_path / "backfill.db"
    db_url = f"sqlite:///{db_file.as_posix()}"

    up = _run_alembic(db_url, "upgrade", "0003_work_data")
    assert up.returncode == 0, up.stderr

    con = sqlite3.connect(str(db_file))
    try:
        con.execute(
            "INSERT INTO workplaces "
            "(id, user_id, client_id, name, hourly_wage, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                uuid.uuid4().hex,
                uuid.uuid4().hex,
                "legacy-1",
                "옛근무지",
                12000,
                "2026-08-01T00:00:00Z",
                "2026-08-01T00:00:00Z",
            ),
        )
        con.commit()
    finally:
        con.close()

    up2 = _run_alembic(db_url, "upgrade", "head")
    assert up2.returncode == 0, up2.stderr

    con = sqlite3.connect(str(db_file))
    try:
        row = con.execute(
            "SELECT pay_day, weekly_allowance, five_or_more_employees, "
            "income_deduction_type, break_minutes_per_shift "
            "FROM workplaces WHERE client_id = 'legacy-1'"
        ).fetchone()
    finally:
        con.close()

    assert row is not None, "기존 행이 사라지면 안 됨"
    pay_day, weekly, five, income, brk = row
    assert pay_day == 10
    assert weekly == 1  # true
    assert five == 0  # false
    assert income == "none"
    assert brk == 0
