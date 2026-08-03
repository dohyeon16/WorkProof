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


def test_single_head_is_auth_tables():
    from alembic.script import ScriptDirectory

    script = ScriptDirectory.from_config(_alembic_config())
    heads = list(script.get_heads())
    assert heads == ["0002_auth_tables"], f"단일 head 여야 함: {heads}"


def test_revision_chain_0002_to_0001_to_base():
    from alembic.script import ScriptDirectory

    script = ScriptDirectory.from_config(_alembic_config())
    rev = script.get_revision("0002_auth_tables")
    assert rev.down_revision == "0001_initial"
    base = script.get_revision("0001_initial")
    assert base.down_revision is None


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
