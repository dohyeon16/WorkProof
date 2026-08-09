// 서버 프록시(/ai/ocr) HTTP 오류를 사용자용 OcrResult 로 바꾸는 순수 매퍼.
// RN/파일시스템 의존이 없어 node:test 로 단독 검증한다(visionOcr 는 파일 읽기 때문에
// RN 결합이라 이 매핑만 분리해 테스트 가능하게 둔다).
//
// 원칙: 키/원문은 절대 담지 않는다. 서버가 준 사용자 노출용 detail(친화 한국어)이
// 있으면 그대로 쓰고, 없으면 상태별 기본 문구로 폴백한다.
import type { ApiError } from '../../../../core/api/errors';
import type { OcrResult } from './types';

/** OCR 인식 결과가 비었을 때(빈 텍스트)의 기본 사용자 문구. */
export const OCR_EMPTY_MESSAGE = '텍스트를 인식하지 못했어요. 더 선명한 파일로 다시 시도해주세요.';

/**
 * 프록시 OCR 요청의 ApiError 를 OcrResult 로 변환한다.
 *  - 503: 서버에 Vision 키 미설정 → not_configured(호출부가 설정 안내).
 *  - 422: 인식된 내용 없음 → empty.
 *  - 415: 이미지/PDF 가 아님 → request_failed(서버 안내 문구 사용).
 *  - 그 외(429/5xx/파싱) 및 network/timeout → request_failed/network.
 */
export function mapOcrApiError(err: ApiError): OcrResult {
  const status = err.status;
  if (status === 503) return { status: 'not_configured' };
  if (status === 422) {
    return { status: 'error', message: err.detail ?? OCR_EMPTY_MESSAGE, code: 'empty' };
  }
  if (status === 415) {
    return {
      status: 'error',
      message: err.detail ?? '이미지 또는 PDF만 처리할 수 있어요.',
      code: 'request_failed',
    };
  }
  if (err.kind === 'network') {
    return { status: 'error', message: '네트워크 오류로 텍스트 추출에 실패했어요.', code: 'network' };
  }
  if (err.kind === 'timeout') {
    return {
      status: 'error',
      message: '처리 시간이 초과됐어요. 잠시 후 다시 시도해주세요.',
      code: 'request_failed',
    };
  }
  // 429/500/502/504 등 — 서버 안내가 있으면 노출, 없으면 일반 문구.
  return {
    status: 'error',
    message: err.detail ?? '텍스트 추출에 실패했어요. 잠시 후 다시 시도해주세요.',
    code: 'request_failed',
  };
}
