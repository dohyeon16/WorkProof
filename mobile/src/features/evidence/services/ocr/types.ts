// OCR 실패 원인 분류. 상위(analyzeEvidenceFile)에서 사용자용 문구/재시도 여부를
// 정하는 데 쓴다. 'file_unreadable'=파일 없음/만료, 'empty'=인식된 텍스트 없음,
// 'rate_limit'=요청 한도 초과(429), 'server_error'=서버/업스트림 지연·오류(5xx/timeout),
// 'request_failed'=그 외 요청 거부(지원 형식 아님 등), 'network'=네트워크 오류.
// 사진 화질 문제(empty)와 서버/네트워크 문제(rate_limit/server_error/network)를
// 구분해야 사용자에게 잘못된 원인("사진 상태 확인")을 안내하지 않는다.
export type OcrErrorCode = 'file_unreadable' | 'empty' | 'rate_limit' | 'server_error' | 'request_failed' | 'network';

export type OcrResult =
  | { status: 'success'; text: string }
  | { status: 'not_configured' }
  | { status: 'error'; message: string; code: OcrErrorCode };
