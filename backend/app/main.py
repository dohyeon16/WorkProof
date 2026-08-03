"""WorkProof backend application factory.

Phase 1: 기존 Expo Go OAuth 브릿지의 동작을 그대로 유지하면서 단일 파일
(backend/main.py)을 계층 구조로 분리한다. 기존 경로(/health, /auth/*)는
접두사 없이 그대로 두고, 새 버전 API는 /api/v1 아래에 추가한다(기존 경로에
영향 없음). 실행 방식(uvicorn main:app)도 backend/main.py 호환 진입점으로 유지.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.logging import configure_logging
from app.api.v1 import auth as v1_auth
from app.api.v1 import bridge as legacy_bridge
from app.api.v1 import health as v1_health

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
# Phase 2 인증 API (/api/v1/auth/*).
app.include_router(v1_auth.router, prefix="/api/v1")
