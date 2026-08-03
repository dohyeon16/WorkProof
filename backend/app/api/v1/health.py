"""신규 버전 API 헬스체크 (/api/v1 아래에 등록).

기존 GET /health 는 bridge 라우터가 그대로 유지하며, 여기서는 새 경로만 추가한다.
DB 헬스체크는 별도 경로로 분리해 — DATABASE_URL이 없거나 접속 실패해도 기본
health와 앱 전체 import는 영향을 받지 않게 한다.
"""
from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.core.config import settings

router = APIRouter()


@router.get("/health")
async def health() -> dict:
    return {"status": "ok", "service": "workproof-backend"}


@router.get("/health/db")
async def health_db():
    if not settings.DATABASE_URL:
        return JSONResponse(
            status_code=503,
            content={"status": "unavailable", "database": "not_configured"},
        )
    # DB 기계장치는 실제로 DB가 설정됐을 때만 지연 import 한다 — 기본 health와
    # 앱 import 가 SQLAlchemy 유무에 묶이지 않게 한다.
    try:
        from sqlalchemy import text

        from app.db.session import get_sessionmaker

        session_factory = get_sessionmaker()
        with session_factory() as db:
            db.execute(text("SELECT 1"))
        return {"status": "ok", "database": "connected"}
    except Exception:
        # 접속 실패 상세는 사용자에게 노출하지 않는다.
        return JSONResponse(
            status_code=503,
            content={"status": "error", "database": "unreachable"},
        )
