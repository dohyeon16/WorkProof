"""SQLAlchemy 2 (동기) 엔진/세션.

engine은 지연 생성한다 — 앱을 import 하는 것만으로는 DB에 접속하지 않으며,
DATABASE_URL이 비어 있어도 import가 실패하지 않는다. 스키마는 Alembic으로만
관리한다(Base.metadata.create_all은 절대 호출하지 않는다).
"""
from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings

_engine: Engine | None = None
_SessionLocal: sessionmaker[Session] | None = None


def get_engine() -> Engine:
    """엔진을 지연 생성한다. DATABASE_URL이 없으면 명시적으로 실패시킨다.

    create_engine 자체는 연결을 열지 않고(pool_pre_ping은 체크아웃 시점에만 ping),
    실제 접속은 세션이 쿼리를 실행할 때 일어난다.
    """
    global _engine, _SessionLocal
    if _engine is None:
        if not settings.DATABASE_URL:
            raise RuntimeError("DATABASE_URL이 설정되지 않아 DB 엔진을 만들 수 없어요.")
        _engine = create_engine(settings.DATABASE_URL, pool_pre_ping=True, future=True)
        _SessionLocal = sessionmaker(bind=_engine, autoflush=False, autocommit=False)
    return _engine


def get_sessionmaker() -> sessionmaker[Session]:
    get_engine()
    assert _SessionLocal is not None
    return _SessionLocal


def get_db() -> Iterator[Session]:
    """FastAPI 의존성: 요청 스코프 세션(Phase 2+ 라우트에서 사용)."""
    session_factory = get_sessionmaker()
    db = session_factory()
    try:
        yield db
    finally:
        db.close()
