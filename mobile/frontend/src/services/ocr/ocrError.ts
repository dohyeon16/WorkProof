// 서버 프록시(/ai/ocr) HTTP 오류를 사용자용 OcrResult 로 바꾸는 순수 매퍼.
// RN/파일시스템 의존이 없어 node:test 로 단독 검증한다(visionOcr 는 파일 읽기 때문에
// RN 결합이라 이 매핑만 분리해 테스트 가능하게 둔다).
//
// 원칙: 키/원문은 절대 담지 않는다. 서버가 준 사용자 노출용 detail(친화 한국어)이
// 있으면 그대로 쓰고, 없으면 상태별 기본 문구로 폴백한다.
import type { ApiError } from '../api/errors';
import type { OcrResult } from './ocr.types';

/** OCR 인식 결과가 비었을 때(빈 텍스트)의 기본 사용자 문구. */
export const OCR_EMPTY_MESSAGE = '텍스트를 인식하지 못했어요. 더 선명한 파일로 다시 시도해주세요.';

/**
 * 프록시 OCR 요청의 ApiError 를 OcrResult 로 변환한다.
 *  - 503: 서버에 Vision 키 미설정 → not_configured(호출부가 설정 안내).
 *  - 422: 인식된 내용 없음 → empty(사진 화질 문제로 안내).
 *  - 415: 이미지/PDF 가 아님 → request_failed(서버 안내 문구 사용).
 *  - 429: 요청 한도 초과 → rate_limit(사진 문제 아님 — 잠시 후 재시도 안내).
 *  - network/timeout/5xx → network/server_error(서버·연결 문제로 안내, 사진 문제 아님).
 * empty 만 "사진 상태 확인" 문구로 이어지고, rate_limit/server_error/network 는 서버·연결
 * 문제로 별도 안내해야 한다 — 여기서 원인을 뭉뚱그리면 호출부가 구분할 수 없다.
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
  if (status === 429) {
    return {
      status: 'error',
      message: err.detail ?? '요청이 많아요. 잠시 후 다시 시도해주세요.',
      code: 'rate_limit',
    };
  }
  if (err.kind === 'network') {
    return { status: 'error', message: '네트워크 오류로 텍스트 추출에 실패했어요.', code: 'network' };
  }
  if (err.kind === 'timeout') {
    return {
      status: 'error',
      message: '처리 시간이 초과됐어요. 잠시 후 다시 시도해주세요.',
      code: 'server_error',
    };
  }
  if (status !== undefined && status >= 500) {
    return {
      status: 'error',
      message: err.detail ?? '분석 서버에 연결하지 못했어요. 다시 시도해주세요.',
      code: 'server_error',
    };
  }
  // 400/404 등 — 재시도해도 소용없는 요청/구성 문제.
  return {
    status: 'error',
    message: err.detail ?? '텍스트 추출에 실패했어요. 잠시 후 다시 시도해주세요.',
    code: 'request_failed',
  };
}

// Google Vision 의 images:annotate/files:annotate 는 HEIC/HEIF 원본 바이트를 디코드하지
// 못한다(JPEG/PNG/WEBP/BMP/GIF/RAW/ICO/PDF/TIFF 만 지원). iPhone 사진 보관함 기본 형식이
// HEIC 라, 압축 없이 원본을 그대로 첨부하면(예: 파일 선택기로 사진을 고를 때) 서버가
// 업스트림 오류를 돌려주고 원인이 형식 미지원인데도 "사진 상태 확인" 문구로만 보이게
// 된다. 파일을 읽거나 서버를 호출하기 전에 걸러 정확한 안내로 대체할 수 있도록 이 함수는
// 여기(순수, RN 비의존)에 둔다 — analyzeContract.ts는 visionOcr 경유로 RN(파일시스템)에
// 결합돼 있어 이 판정 로직만은 분리해야 node:test 로 단독 검증할 수 있다.
export function isUnsupportedOcrMimeType(mimeType: string): boolean {
  const lower = mimeType.toLowerCase();
  return lower === 'image/heic' || lower === 'image/heif';
}
