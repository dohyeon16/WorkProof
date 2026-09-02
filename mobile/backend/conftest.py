"""pytest 부트스트랩 + 인증 테스트 픽스처.

- backend/ 를 import 경로에 올려 `from main import app` / `from app...` 가 되게 한다.
- 앱 import 전에 필수 시크릿을 테스트용 더미로 설정한다(실제 값 아님).
- DATABASE_URL은 설정하지 않는다 — 단위 테스트는 아래 SQLite in-memory 엔진과
  get_db 의존성 오버라이드를 쓴다(운영/실DB 무접속). 앱/마이그레이션은 절대
  create_all 을 쓰지 않으며, create_all 은 여기(테스트 픽스처)서만 스키마를
  materialize 하는 용도로 쓴다. PostgreSQL 마이그레이션·제약 검증은 CI 의
  PostgreSQL service(alembic upgrade head)에서 별도로 수행한다.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

os.environ.setdefault("SESSION_SIGNING_SECRET", "test-signing-secret-not-a-real-value")
os.environ.setdefault("JWT_SECRET_KEY", "test-jwt-secret-not-a-real-value")
os.environ.setdefault("ENVIRONMENT", "test")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import Session, sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app.core import deps  # noqa: E402
from app.db.base import Base  # noqa: E402
import app.models  # noqa: E402,F401  (모든 모델 등록 → metadata 완성)
from main import app as fastapi_app  # noqa: E402


@pytest.fixture()
def engine():
    """테스트 엔진.

    TEST_DATABASE_URL 이 있으면 그 PostgreSQL 을 쓰고(§10 전략 C의 PG 통합 검증),
    없으면 SQLite in-memory(빠른 단위 테스트)를 쓴다. 어느 쪽이든 스키마는
    create_all 로 materialize 한다(모델이 postgresql_where 를 정의하므로 PG 에서는
    부분 unique index 도 실제로 생성·강제된다). 운영/실 DB 마이그레이션 실행은 CI
    의 별도 alembic upgrade 단계에서 검증한다.
    """
    test_db_url = os.environ.get("TEST_DATABASE_URL")
    if test_db_url:
        eng = create_engine(test_db_url, future=True)
    else:
        eng = create_engine(
            "sqlite+pysqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
            future=True,
        )
    Base.metadata.drop_all(eng)
    Base.metadata.create_all(eng)
    try:
        yield eng
    finally:
        Base.metadata.drop_all(eng)
        eng.dispose()


@pytest.fixture()
def SessionLocal(engine):
    return sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


@pytest.fixture()
def db(SessionLocal) -> Session:
    """service 계층 직접 테스트용 세션."""
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def client(SessionLocal):
    """get_db 를 테스트 SQLite 세션으로 오버라이드한 TestClient."""

    def _override_get_db():
        session = SessionLocal()
        try:
            yield session
        finally:
            session.close()

    fastapi_app.dependency_overrides[deps.get_db] = _override_get_db
    try:
        with TestClient(fastapi_app) as c:
            yield c
    finally:
        fastapi_app.dependency_overrides.pop(deps.get_db, None)
