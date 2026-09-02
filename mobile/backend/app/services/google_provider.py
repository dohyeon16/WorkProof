"""Google provider 호출 공용 계층 — OCR(Vision)과 AI 요약(Gemini)이 함께 쓴다.

두 기능은 서로 다른 provider·프롬프트·응답 형태를 갖지만, "키는 서버 환경변수에만
두고, 실패는 호출자가 안전한 HTTP 응답으로 옮길 수 있는 예외로 정규화한다"는 규칙은
동일하다. 그 공통 규칙만 여기 둔다 — OCR 도, 요약도 서로를 알 필요가 없다.

원칙:
 - API 키는 절대 로그/응답에 남기지 않는다.
 - 외부 호출은 주입된 httpx.Client 로 수행한다(테스트에서 MockTransport 로 대체).
 - 키 미설정 → AiNotConfigured. 업스트림 오류 → AiUpstreamError.
"""
from __future__ import annotations

import httpx

from app.core.logging import get_logger

# 로거 이름은 분리 전 값을 그대로 유지한다 — 운영 로그 필터/집계가 이 이름에 걸려 있다.
logger = get_logger("workproof.ai_proxy")


class AiNotConfigured(Exception):
    """해당 기능의 API 키가 서버에 설정되지 않음. → 503."""


class AiUpstreamError(Exception):
    """업스트림(Google) 호출 실패. status_code 로 원인 구분(키/원문은 안 담는다)."""

    def __init__(self, upstream_status: int) -> None:
        super().__init__(f"upstream status {upstream_status}")
        self.upstream_status = upstream_status


class AiEmptyResult(Exception):
    """호출은 성공했지만 인식/생성 결과가 비어 있음. → 422(텍스트 없음)."""


class AiUnsupportedMime(Exception):
    """이미지/PDF 가 아닌 MIME. → 415."""


class AiTimeout(Exception):
    """업스트림 응답 지연(timeout). → 504."""


def require_key(key: str) -> str:
    if not key:
        raise AiNotConfigured()
    return key


def post_json(client: httpx.Client, url: str, payload: dict, api_key: str) -> dict:
    """외부 호출 공통 처리: timeout/네트워크/비정형 응답/오류 상태를 안전하게 매핑한다.
    API 키는 URL 쿼리(?key=)가 아니라 x-goog-api-key 헤더로 보낸다 — URL 이 로그(httpx
    등)에 남아도 키가 노출되지 않게 한다. payload·응답 원문·키는 이 계층에서 로그하지 않는다."""
    try:
        resp = client.post(url, json=payload, headers={"x-goog-api-key": api_key})
    except httpx.TimeoutException:
        raise AiTimeout()
    except httpx.RequestError:
        # 연결 실패/DNS 등 — 원인 원문을 담지 않고 502 로 일반화.
        raise AiUpstreamError(502)
    if resp.status_code != 200:
        # 진단용: provider의 오류 JSON(error.status/message/details)만 남긴다.
        # 요청 payload(사용자 문서 텍스트)·API 키는 절대 로그하지 않는다 — Google
        # 오류 응답 자체에는 우리가 보낸 키가 echo되지 않으므로 이 바디는 안전하다.
        try:
            body_preview = resp.text[:500]
        except Exception:
            body_preview = "(응답 본문 읽기 실패)"
        logger.warning(
            "AI 업스트림 오류 status=%s body=%s", resp.status_code, body_preview
        )
        raise AiUpstreamError(resp.status_code)
    try:
        data = resp.json()
    except ValueError:
        # provider 가 JSON 이 아닌 본문(HTML 오류 페이지 등)을 준 경우 → 비정형 응답.
        raise AiUpstreamError(502)
    if not isinstance(data, dict) or data.get("error"):
        raise AiUpstreamError(502)
    return data
