"""소셜 identity 검증 경계 (§6 — 위조 방지의 핵심).

보안 원칙:
  클라이언트가 보낸 provider_user_id 자체는 **절대 신뢰하지 않는다**. 누구든
  임의의 provider_user_id를 POST 하면 남의 계정을 탈취할 수 있기 때문이다.
  identity는 다음 중 하나로만 서버에서 확정된다.
    (1) 브릿지 경로: 서버가 직접 OAuth code 교환으로 프로필을 받은 세션
        (oauth_bridge). → auth_service.exchange_bridge_session 에서 처리.
    (2) 직접 경로(POST /api/v1/auth/social): provider별 검증기(verifier)가
        credential(id_token/access_token 등)을 provider에 확인해 identity를
        반환한 경우에만 허용.

현재 상태(중요, production 주의):
  실제 provider 토큰 검증기는 **미등록**이다(네트워크 호출을 이 Phase에서 하지
  않기로 함). 따라서 직접 소셜 경로는 기본적으로 SocialVerificationUnavailable
  로 거부된다(= production-safe: 위조 불가). 실제 provider 검증을 붙이려면
  register_verifier 로 provider별 검증기를 등록해야 한다. 그 전까지 직접 경로는
  production-ready가 아니다.

  개발 편의를 위해 settings.ALLOW_UNVERIFIED_SOCIAL=True 로 두면 클라이언트
  입력을 그대로 신뢰하지만, 이는 **위조 가능**하므로 운영에서 켜면 안 된다.
"""
from collections.abc import Callable
from dataclasses import dataclass

from app.core.config import settings
from app.schemas.auth import SocialAuthRequest

SUPPORTED_PROVIDERS = {"google", "kakao", "naver"}


@dataclass(frozen=True)
class VerifiedSocialIdentity:
    provider: str
    provider_user_id: str
    email: str | None
    name: str


class SocialVerificationError(Exception):
    """credential 검증 실패(위조/만료 등). → 401."""


class SocialVerificationUnavailable(Exception):
    """해당 provider의 서버측 검증 수단이 없음. → 501(직접 경로 비활성)."""


# provider -> (SocialAuthRequest) -> VerifiedSocialIdentity
# 실제 provider 검증기는 여기 등록한다. 기본은 비어 있음(위조 방지 우선).
_VERIFIERS: dict[str, Callable[[SocialAuthRequest], VerifiedSocialIdentity]] = {}


def register_verifier(
    provider: str, verifier: Callable[[SocialAuthRequest], VerifiedSocialIdentity]
) -> None:
    _VERIFIERS[provider] = verifier


def unregister_verifier(provider: str) -> None:
    _VERIFIERS.pop(provider, None)


def verify_social(req: SocialAuthRequest) -> VerifiedSocialIdentity:
    """직접 소셜 경로의 identity를 서버 기준으로 확정한다.

    - provider 미지원 → SocialVerificationError
    - 검증기 등록됨 → credential을 검증해 identity 반환(실패 시 SocialVerificationError)
    - 검증기 없음:
        ALLOW_UNVERIFIED_SOCIAL=True  → 클라이언트 입력 신뢰(개발 전용, 위조 가능)
        ALLOW_UNVERIFIED_SOCIAL=False → SocialVerificationUnavailable(기본, 안전)
    """
    if req.provider not in SUPPORTED_PROVIDERS:
        raise SocialVerificationError("지원하지 않는 provider입니다.")

    verifier = _VERIFIERS.get(req.provider)
    if verifier is not None:
        return verifier(req)

    if settings.ALLOW_UNVERIFIED_SOCIAL:
        # 개발 전용 경로. provider_user_id를 검증 없이 신뢰한다(운영 금지).
        return VerifiedSocialIdentity(
            provider=req.provider,
            provider_user_id=req.provider_user_id,
            email=req.email,
            name=req.name,
        )

    raise SocialVerificationUnavailable(
        "이 provider의 서버측 검증이 아직 설정되지 않았어요."
    )
