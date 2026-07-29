import { readFileBase64 } from '../shared/utils/fileStore';
import type { OcrResult } from './types';

const API_KEY = process.env.EXPO_PUBLIC_GOOGLE_VISION_API_KEY;

// 저장된 URI가 만료됐거나 파일이 사라져 읽을 수 없을 때 쓰는 사용자 안내 문구.
// 호출부에서 이 문구인지 비교해 별도 처리할 수 있도록 상수로 노출한다.
export const FILE_UNREADABLE_MESSAGE = '원본 파일을 찾을 수 없어요. 파일을 다시 추가해주세요.';

/** uri에서 스킴만 뽑는다(로그용). 예: "file:///a" → "file". */
function uriScheme(uri: string): string {
  const i = uri.indexOf(':');
  return i > 0 ? uri.slice(0, i) : '(none)';
}

// Cloud Vision 동기 요청은 PDF 최대 5페이지까지만 처리한다(그 이상은 GCS 기반
// 비동기 batch API가 필요). 근로계약서는 대부분 이 범위 안에 들어온다.
const MAX_PDF_PAGES = 5;

// 403/401 등 요청 자체가 거부되면 Vision은 responses 배열이 아니라 최상위
// error 객체로 사유를 돌려준다(예: API 미활성, 결제 미설정, 키 제한). 이 필드를
// 읽어야 "요청 실패 (403)" 대신 실제 원인이 사용자에게 노출된다.
interface VisionTopLevelError {
  error?: { message?: string; status?: string };
}

interface VisionAnnotateResponse extends VisionTopLevelError {
  responses?: { fullTextAnnotation?: { text?: string }; error?: { message?: string } }[];
}

interface VisionFilesResponse extends VisionTopLevelError {
  responses?: {
    error?: { message?: string };
    responses?: { fullTextAnnotation?: { text?: string } }[];
  }[];
}

/**
 * Vision 요청 실패를 사용자용 한국어 메시지로 바꾼다.
 * 원본(주로 영문) 사유는 개발자 콘솔에만 남기고, 사용자에게는 원인별로
 * 짧은 한국어 안내만 노출한다. billing/키 제한 등은 코드가 아니라 Google
 * Cloud 콘솔 설정 문제라 앱에서 자동 복구할 수 없다.
 */
function describeVisionError(status: number, apiMessage?: string): string {
  // 개발용: 원본 에러 전문을 콘솔에만 남긴다(사용자 화면에는 노출하지 않음).
  console.warn(`[visionOcr] Vision 요청 실패 (${status}): ${apiMessage ?? '(메시지 없음)'}`);

  const lower = (apiMessage ?? '').toLowerCase();
  if (lower.includes('billing')) {
    return '텍스트 추출에 실패했어요. OCR API의 결제(빌링) 설정을 확인해주세요.';
  }
  if (status === 401 || status === 403) {
    return '텍스트 추출에 실패했어요. OCR API 설정(Cloud Vision 사용 설정 / 결제 / API 키 제한)을 확인해주세요.';
  }
  if (status === 429) {
    return '요청이 많아 잠시 후 다시 시도해주세요.';
  }
  return '텍스트 추출에 실패했어요. 잠시 후 다시 시도해주세요.';
}

export async function extractTextFromDocument(
  uri: string,
  mimeType: string,
  debug?: { name?: string; size?: number | null }
): Promise<OcrResult> {
  if (!API_KEY) return { status: 'not_configured' };

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

  // 진단용(키는 절대 로그하지 않는다): 어떤 파일을 어떻게 보냈는지.
  console.warn('[visionOcr] OCR 요청', {
    name: debug?.name,
    mimeType,
    scheme,
    size: debug?.size ?? null,
    branch: isPdf ? 'pdf' : 'image',
    base64Length: base64.length,
  });

  try {
    if (isPdf) {
      const res = await fetch(`https://vision.googleapis.com/v1/files:annotate?key=${API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [
            {
              inputConfig: { content: base64, mimeType: 'application/pdf' },
              features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
              pages: Array.from({ length: MAX_PDF_PAGES }, (_, i) => i + 1),
            },
          ],
        }),
      });
      const json = (await res.json()) as VisionFilesResponse;
      const first = json.responses?.[0];
      if (!res.ok || json.error || first?.error) {
        const apiMessage = json.error?.message ?? first?.error?.message;
        return { status: 'error', message: describeVisionError(res.status, apiMessage), code: 'request_failed' };
      }
      const text = (first?.responses ?? [])
        .map((p) => p.fullTextAnnotation?.text?.trim())
        .filter(Boolean)
        .join('\n\n');
      if (!text) return { status: 'error', message: '텍스트를 인식하지 못했어요. 더 선명한 파일로 다시 시도해주세요.', code: 'empty' };
      return { status: 'success', text };
    }

    const res = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [
          {
            image: { content: base64 },
            features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
          },
        ],
      }),
    });
    const json = (await res.json()) as VisionAnnotateResponse;
    const first = json.responses?.[0];
    if (!res.ok || json.error || first?.error) {
      const apiMessage = json.error?.message ?? first?.error?.message;
      return { status: 'error', message: describeVisionError(res.status, apiMessage), code: 'request_failed' };
    }
    const text = first?.fullTextAnnotation?.text?.trim();
    if (!text) return { status: 'error', message: '텍스트를 인식하지 못했어요. 더 선명한 사진으로 다시 시도해주세요.', code: 'empty' };
    return { status: 'success', text };
  } catch {
    return { status: 'error', message: '네트워크 오류로 텍스트 추출에 실패했어요.', code: 'network' };
  }
}
