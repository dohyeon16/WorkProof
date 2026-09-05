"""인증 요청/응답 스키마."""
from pydantic import BaseModel, EmailStr, Field

from app.schemas.user import UserResponse

# 비밀번호 정책: 최소 8자(§2). 상한은 Argon2/DoS 방지용 방어적 상한.
_PASSWORD_MIN = 8
_PASSWORD_MAX = 256


class AuthRegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=_PASSWORD_MIN, max_length=_PASSWORD_MAX)
    name: str = Field(min_length=1, max_length=255)


class AuthLoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=_PASSWORD_MAX)
    device_label: str | None = Field(default=None, max_length=255)


class SocialAuthRequest(BaseModel):
    provider: str = Field(min_length=1, max_length=32)
    provider_user_id: str = Field(min_length=1, max_length=255)
    email: EmailStr | None = None
    name: str = Field(min_length=1, max_length=255)
    bridge_session_id: str | None = Field(default=None, max_length=128)
    # 서버가 검증 가능한 provider credential(예: id_token/access_token).
    # 이것 없이 provider_user_id만으로는 identity를 신뢰하지 않는다(§6).
    credential: str | None = Field(default=None, max_length=4096)
    device_label: str | None = Field(default=None, max_length=255)


class BridgeExchangeRequest(BaseModel):
    bridge_session_id: str = Field(min_length=1, max_length=128)
    device_label: str | None = Field(default=None, max_length=255)
    mode: str = Field(default="signup", pattern="^(signup|login)$")


class RefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=1, max_length=512)


class LogoutRequest(BaseModel):
    refresh_token: str = Field(min_length=1, max_length=512)


class TokenPairResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserResponse
