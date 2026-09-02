"""보안 원시 연산: 비밀번호 해시, access JWT, refresh 토큰.

원칙:
- 비밀번호 평문·refresh 원문·JWT secret은 로그에 남기지 않는다(이 모듈은 로깅 안 함).
- 시간은 전부 timezone-aware UTC.
- refresh 원문은 반환만 하고 저장하지 않는다 — 저장은 SHA-256 hash(sha256_hex)만.
- access JWT는 HS256(stdlib hmac 기반, cryptography 불필요).
"""
import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

from app.core.config import settings

ALGORITHM = "HS256"
ACCESS_TOKEN_TYPE = "access"
# refresh 원문 엔트로피(bytes). token_urlsafe(48) ≈ 64자, 384비트.
_REFRESH_TOKEN_BYTES = 48

# Argon2id(기본 type). 파라미터는 argon2-cffi 기본값(안전한 기본).
_password_hasher = PasswordHasher()


def utcnow() -> datetime:
    """timezone-aware UTC 현재 시각."""
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# 비밀번호 (Argon2id)
# ---------------------------------------------------------------------------
def hash_password(password: str) -> str:
    """평문 비밀번호를 Argon2id 해시로 변환. 평문은 반환/로그하지 않는다."""
    return _password_hasher.hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    """평문과 저장된 해시를 상수 시간 비교. 해시가 없으면(소셜 전용) False."""
    if not password_hash:
        return False
    try:
        return _password_hasher.verify(password_hash, password)
    except (VerifyMismatchError, InvalidHashError, Exception):
        return False


def password_needs_rehash(password_hash: str) -> bool:
    """Argon2 파라미터가 바뀌었을 때 재해시 필요 여부."""
    try:
        return _password_hasher.check_needs_rehash(password_hash)
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Access JWT (HS256)
# ---------------------------------------------------------------------------
def _require_secret() -> str:
    secret = settings.JWT_SECRET_KEY
    if not secret:
        # 무설정 상태에서 토큰이 서명/검증되는 사고를 명시적으로 막는다.
        raise RuntimeError("JWT_SECRET_KEY가 설정되지 않아 토큰을 처리할 수 없어요.")
    return secret


def create_access_token(
    subject: str, expires_minutes: int | None = None
) -> tuple[str, int]:
    """access JWT와 만료까지 남은 초(expires_in)를 반환한다.

    claims: sub, type=access, iat, exp, jti.
    """
    minutes = (
        expires_minutes
        if expires_minutes is not None
        else settings.ACCESS_TOKEN_EXPIRE_MINUTES
    )
    now = utcnow()
    expire = now + timedelta(minutes=minutes)
    payload = {
        "sub": subject,
        "type": ACCESS_TOKEN_TYPE,
        "iat": int(now.timestamp()),
        "exp": int(expire.timestamp()),
        "jti": uuid.uuid4().hex,
    }
    token = jwt.encode(payload, _require_secret(), algorithm=ALGORITHM)
    return token, minutes * 60


def decode_access_token(token: str) -> dict:
    """access JWT를 검증(서명·만료)하고 payload를 반환한다.

    실패 시 jwt.PyJWTError 하위 예외를 던진다(호출부에서 401로 매핑).
    type이 access가 아니면 InvalidTokenError.
    """
    payload = jwt.decode(
        token,
        _require_secret(),
        algorithms=[ALGORITHM],
        options={"require": ["exp", "iat", "sub"]},
    )
    if payload.get("type") != ACCESS_TOKEN_TYPE:
        raise jwt.InvalidTokenError("access 토큰이 아니에요.")
    return payload


# ---------------------------------------------------------------------------
# Refresh 토큰 (불투명 랜덤 + SHA-256 hash 저장)
# ---------------------------------------------------------------------------
def generate_refresh_token() -> str:
    """암호학적 랜덤 refresh 원문. 이 값은 클라이언트에만 주고 저장하지 않는다."""
    return secrets.token_urlsafe(_REFRESH_TOKEN_BYTES)


def sha256_hex(value: str) -> str:
    """refresh 원문 → 저장/조회용 SHA-256 hex digest."""
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def refresh_expiry(days: int | None = None) -> datetime:
    """refresh 만료 시각(UTC)."""
    d = days if days is not None else settings.REFRESH_TOKEN_EXPIRE_DAYS
    return utcnow() + timedelta(days=d)
