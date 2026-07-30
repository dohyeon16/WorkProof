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

    @property
    def cors_allowed_origins(self) -> list[str]:
        return [o.strip() for o in self.FRONTEND_ALLOWED_ORIGIN.split(",") if o.strip()]


# import 시 1회 로드. SESSION_SIGNING_SECRET이 없으면 여기서 ValidationError로 실패.
settings = Settings()
