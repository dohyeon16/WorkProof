// OCR 실패 원인 분류. 상위(analyzeEvidenceFile)에서 사용자용 문구/재시도 여부를
// 정하는 데 쓴다. 'file_unreadable'=파일 없음/만료, 'empty'=인식된 텍스트 없음,
// 'request_failed'=Vision 요청 거부(권한/결제/한도 등), 'network'=네트워크 오류.
export type OcrErrorCode = 'file_unreadable' | 'empty' | 'request_failed' | 'network';

export type OcrResult =
  | { status: 'success'; text: string }
  | { status: 'not_configured' }
  | { status: 'error'; message: string; code: OcrErrorCode };
