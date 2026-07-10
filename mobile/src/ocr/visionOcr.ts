import { readAsBase64 } from './readAsBase64';
import type { OcrResult } from './types';

const API_KEY = process.env.EXPO_PUBLIC_GOOGLE_VISION_API_KEY;

// Cloud Vision 동기 요청은 PDF 최대 5페이지까지만 처리한다(그 이상은 GCS 기반
// 비동기 batch API가 필요). 근로계약서는 대부분 이 범위 안에 들어온다.
const MAX_PDF_PAGES = 5;

interface VisionAnnotateResponse {
  responses?: { fullTextAnnotation?: { text?: string }; error?: { message?: string } }[];
}

interface VisionFilesResponse {
  responses?: {
    error?: { message?: string };
    responses?: { fullTextAnnotation?: { text?: string } }[];
  }[];
}

export async function extractTextFromDocument(uri: string, mimeType: string): Promise<OcrResult> {
  if (!API_KEY) return { status: 'not_configured' };

  const isPdf = mimeType === 'application/pdf';
  let base64: string;
  try {
    base64 = await readAsBase64(uri);
  } catch {
    return { status: 'error', message: '파일을 읽지 못했어요.' };
  }

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
      if (!res.ok || first?.error) {
        return { status: 'error', message: first?.error?.message ?? `요청 실패 (${res.status})` };
      }
      const text = (first?.responses ?? [])
        .map((p) => p.fullTextAnnotation?.text?.trim())
        .filter(Boolean)
        .join('\n\n');
      if (!text) return { status: 'error', message: '텍스트를 인식하지 못했어요. 더 선명한 파일로 다시 시도해주세요.' };
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
    if (!res.ok || first?.error) {
      return { status: 'error', message: first?.error?.message ?? `요청 실패 (${res.status})` };
    }
    const text = first?.fullTextAnnotation?.text?.trim();
    if (!text) return { status: 'error', message: '텍스트를 인식하지 못했어요. 더 선명한 사진으로 다시 시도해주세요.' };
    return { status: 'success', text };
  } catch {
    return { status: 'error', message: '네트워크 오류로 텍스트 추출에 실패했어요.' };
  }
}
