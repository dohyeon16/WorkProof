"""로깅 설정.

Secret / OAuth code / access·refresh token / 전체 사용자 프로필 / OCR·계약서 /
비밀번호는 절대 로그로 남기지 않는다. 오류에는 provider와 예외 유형 정도의
correlation 정보만 남긴다(호출부 책임).
"""
import logging

from app.core.config import settings

_configured = False


def configure_logging() -> None:
    global _configured
    if _configured:
        return
    logging.basicConfig(
        level=getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    _configured = True


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)
