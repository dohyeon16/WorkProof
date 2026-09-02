// 이미지/PDF 에서 텍스트를 추출한다 — Phase 4C-2 부터는 Google Vision 을 직접 호출하지
// 않고 backend 프록시(POST /ai/ocr)를 통해서만 호출한다. Vision 키/URL 은 서버에만 있고
// 앱에는 없다. 파일 읽기(→base64)만 클라이언트에서 하고, 인식/오류 매핑은 서버가 한다.
//
// 인증(401→refresh→1회 재시도, 실패 시 SessionExpiredError)은 remote(runAuthorized)가
// 담당한다. 키/오류 원문은 로그로 남기지 않고 사용자에겐 짧은 한국어 문구만 노출한다.
import { readFileBase64 } from '../files/fileStore';
import { ApiError } from '../api/errors';
import { SessionExpiredError } from '../../features/auth/state/session';
import type { AiRemote } from '../api/aiProxyApi';
import { mapOcrApiError } from './ocrError';
import type { OcrResult } from './ocr.types';

// 저장된 URI가 만료됐거나 파일이 사라져 읽을 수 없을 때 쓰는 사용자 안내 문구.
// 호출부에서 이 문구인지 비교해 별도 처리할 수 있도록 상수로 노출한다.
export const FILE_UNREADABLE_MESSAGE = '원본 파일을 찾을 수 없어요. 파일을 다시 추가해주세요.';

/** uri에서 스킴만 뽑는다(로그용). 예: "file:///a" → "file". */
function uriScheme(uri: string): string {
  const i = uri.indexOf(':');
  return i > 0 ? uri.slice(0, i) : '(none)';
}

/**
 * 첨부 파일(이미지/PDF)에서 텍스트를 추출한다. 파일을 base64 로 읽어 서버 프록시로 보낸다.
 * 인증 만료로 refresh 까지 실패하면 SessionExpiredError 를 그대로 던져 상위가 로그인
 * 게이팅으로 변환하게 한다.
 */
export async function extractTextFromDocument(
  remote: AiRemote,
  uri: string,
  mimeType: string,
  debug?: { name?: string; size?: number | null }
): Promise<OcrResult> {
  const isPdf = mimeType === 'application/pdf';
  const scheme = uriScheme(uri);

  // 파일 읽기(→base64). 실패/빈 값이면 만료된 임시 URI일 가능성이 크다.
  let base64: string | null;
  try {
    base64 = await readFileBase64(uri);
  } catch (e) {
    console.warn('[visionOcr] 파일 읽기 예외', {
      name: debug?.name,
      mimeType,
      scheme,
      size: debug?.size ?? null,
      branch: isPdf ? 'pdf' : 'image',
      error: e instanceof Error ? e.message : String(e),
    });
    return { status: 'error', message: FILE_UNREADABLE_MESSAGE, code: 'file_unreadable' };
  }
  if (!base64) {
    console.warn('[visionOcr] base64 없음(만료/삭제 추정)', {
      name: debug?.name,
      mimeType,
      scheme,
      size: debug?.size ?? null,
      branch: isPdf ? 'pdf' : 'image',
    });
    return { status: 'error', message: FILE_UNREADABLE_MESSAGE, code: 'file_unreadable' };
  }

  // 진단용(키/내용은 절대 로그하지 않는다): 어떤 파일을 어떻게 보냈는지.
  console.warn('[visionOcr] OCR 요청', {
    name: debug?.name,
    mimeType,
    scheme,
    size: debug?.size ?? null,
    branch: isPdf ? 'pdf' : 'image',
    base64Length: base64.length,
  });

  try {
    const text = (await remote.ocr(base64, mimeType)).trim();
    if (!text) {
      return {
        status: 'error',
        message: isPdf
          ? '텍스트를 인식하지 못했어요. 더 선명한 파일로 다시 시도해주세요.'
          : '텍스트를 인식하지 못했어요. 더 선명한 사진으로 다시 시도해주세요.',
        code: 'empty',
      };
    }
    return { status: 'success', text };
  } catch (e) {
    if (e instanceof SessionExpiredError) throw e; // 상위(analyzeEvidenceFile)에서 로그인 게이팅으로 변환
    if (e instanceof ApiError) return mapOcrApiError(e);
    console.warn('[visionOcr] 알 수 없는 OCR 예외:', e instanceof Error ? e.message : String(e));
    return { status: 'error', message: '네트워크 오류로 텍스트 추출에 실패했어요.', code: 'network' };
  }
}
