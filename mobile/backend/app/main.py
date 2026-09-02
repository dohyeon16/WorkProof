"""WorkProof backend application factory.

Phase 1: 기존 Expo Go OAuth 브릿지의 동작을 그대로 유지하면서 단일 파일
(backend/main.py)을 계층 구조로 분리한다. 기존 경로(/health, /auth/*)는
접두사 없이 그대로 두고, 새 버전 API는 /api/v1 아래에 추가한다(기존 경로에
영향 없음). 실행 방식(uvicorn main:app)도 backend/main.py 호환 진입점으로 유지.
"""
from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import settings
from app.core.logging import configure_logging
from app.api.v1 import ai_proxy as v1_ai
from app.api.v1 import attendance_records as v1_attendance
from app.api.v1 import auth as v1_auth
from app.api.v1 import bridge as legacy_bridge
from app.api.v1 import health as v1_health
from app.api.v1 import users as v1_users
from app.api.v1 import work_schedules as v1_work_schedules
from app.api.v1 import workplaces as v1_workplaces
from app.services import work_data

configure_logging()

app = FastAPI(title="WorkProof Auth Bridge")

# CORS: 기존 동작 보존 — FRONTEND_ALLOWED_ORIGIN(콤마 구분)이 비어 있으면
# 로컬 개발 편의를 위해 "*"로 폴백한다(운영에서는 origin을 채워 제한 권장).
_allowed = settings.cors_allowed_origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed or ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 기존 경로 유지: 접두사 없이 등록(/health, /auth/session/{provider} 등).
app.include_router(legacy_bridge.router)
# 신규 버전 API: 기존 경로와 분리된 /api/v1 아래에만 추가.
app.include_router(v1_health.router, prefix="/api/v1")
# Phase 2 인증/사용자 API (/api/v1/auth/*, /api/v1/users/*).
app.include_router(v1_auth.router, prefix="/api/v1")
app.include_router(v1_users.router, prefix="/api/v1")
# Phase 3A work-data API (/api/v1/workplaces, /work-schedules, /attendance-records).
app.include_router(v1_workplaces.router, prefix="/api/v1")
app.include_router(v1_work_schedules.router, prefix="/api/v1")
app.include_router(v1_attendance.router, prefix="/api/v1")
# Phase 4C AI 프록시 (/api/v1/ai/ocr, /ai/summarize) — 키는 서버 보관, 인증 필수.
app.include_router(v1_ai.router, prefix="/api/v1")


# work-data 도메인 예외 → HTTP 상태 매핑(라우터를 얇게 유지).
@app.exception_handler(work_data.NotFoundError)
def _handle_not_found(request: Request, exc: work_data.NotFoundError) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_404_NOT_FOUND, content={"detail": str(exc)}
    )


@app.exception_handler(work_data.ClientIdConflictError)
def _handle_client_conflict(
    request: Request, exc: work_data.ClientIdConflictError
) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_409_CONFLICT, content={"detail": str(exc)}
    )


@app.exception_handler(work_data.InvalidWorkplaceError)
def _handle_invalid_workplace(
    request: Request, exc: work_data.InvalidWorkplaceError
) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, content={"detail": str(exc)}
    )
