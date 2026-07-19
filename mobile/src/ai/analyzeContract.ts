import { extractTextFromDocument } from '../ocr/visionOcr';
import { summarizeContractText } from './geminiSummary';
import type { EvidenceKind } from '../types';

/**
 * 첨부 파일(이미지/PDF)에서 OCR로 텍스트를 뽑고 이어서 AI로 요약한다.
 * 근무지 등록 화면과 증빙 보관함이 공통으로 쓰는 계약서 분석 파이프라인.
 *
 * OCR 단계와 요약 단계를 각각 구분해 결과를 돌려주므로, 호출 측에서
 * "텍스트는 뽑혔지만 요약만 실패" 같은 부분 성공도 자연스럽게 다룰 수 있다.
 */
export type AnalyzeResult =
  | { status: 'ocr_not_configured' }
  | { status: 'ocr_error'; message: string }
  | { status: 'summary_not_configured'; ocrText: string }
  | { status: 'summary_error'; ocrText: string; message: string }
  | { status: 'success'; ocrText: string; summary: string };

/** 저장된 증빙 파일 종류를 Vision이 기대하는 MIME 타입으로 변환한다. */
export function mimeTypeForKind(kind: EvidenceKind, name?: string): string {
  if (kind === 'pdf') return 'application/pdf';
  const lower = (name ?? '').toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.heic')) return 'image/heic';
  return 'image/jpeg';
}

export async function analyzeContract(uri: string, mimeType: string): Promise<AnalyzeResult> {
  const ocr = await extractTextFromDocument(uri, mimeType);
  if (ocr.status === 'not_configured') return { status: 'ocr_not_configured' };
  if (ocr.status === 'error') return { status: 'ocr_error', message: ocr.message };

  const summary = await summarizeContractText(ocr.text);
  if (summary.status === 'not_configured') {
    return { status: 'summary_not_configured', ocrText: ocr.text };
  }
  if (summary.status === 'error') {
    return { status: 'summary_error', ocrText: ocr.text, message: summary.message };
  }
  return { status: 'success', ocrText: ocr.text, summary: summary.summary };
}
