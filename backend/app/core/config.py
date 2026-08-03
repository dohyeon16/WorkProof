"""환경변수 설정(pydantic-settings).

기존 브릿지 변수 이름을 그대로 유지하고 DB/운영 변수만 추가한다. import 시
값만 읽고 실제 DB에는 접속하지 않는다. SESSION_SIGNING_SECRET은 기존 main.py와
동일하게 필수값이라, 없으면 설정 로드 단계에서 실패한다(브릿지 미기동 = 기존 동작).
"""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    # --- 기존 OAuth 브릿지 (이름 변경 금지) ---
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    KAKAO_REST_API_KEY: str = ""
    KAKAO_CLIENT_SECRET: str = ""
    NAVER_CLIENT_ID: str = ""
    NAVER_CLIENT_SECRET: str = ""
    FRONTEND_ALLOWED_ORIGIN: str = ""
    # 기존 동작 보존: 필수값 — 비어 있으면 설정 로드가 실패해 서버가 기동하지 않는다.
    SESSION_SIGNING_SECRET: str

    # --- 신규 (Phase 1) ---
    # PostgreSQL 접속 URL. 비어 있으면 DB 기능 비활성(엔진 생성 안 함, import 시 무접속).
    DATABASE_URL: str = ""
    ENVIRONMENT: str = "development"
    LOG_LEVEL: str = "INFO"

    # --- 신규 (Phase 2: 인증) ---
    # JWT access token 서명 키. SESSION_SIGNING_SECRET(브릿지 state 서명)과 분리한다.
    # 비어 있으면 앱 import는 가능하되(브릿지 전용 모드), 토큰 발급/검증 시점에
    # security 계층이 명시적으로 실패시킨다(무설정으로 서명되는 사고 방지).
    JWT_SECRET_KEY: str = ""
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30
    # 클라이언트가 보낸 provider_user_id를 서버가 검증하지 못하는 직접 소셜 로그인
    # (POST /api/v1/auth/social)을 허용할지. 기본 False — 검증기 미등록 provider는
    # 거부한다(임의 identity 위조로 계정 탈취를 막는 production-safe 기본값).
    ALLOW_UNVERIFIED_SOCIAL: bool = False

    @property
    def cors_allowed_origins(self) -> list[str]:
        return [o.strip() for o in self.FRONTEND_ALLOWED_ORIGIN.split(",") if o.strip()]


# import 시 1회 로드. SESSION_SIGNING_SECRET이 없으면 여기서 ValidationError로 실패.
settings = Settings()
