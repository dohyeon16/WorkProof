import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// 실기기 Issue 1(계약서 "텍스트 추출 실패") 회귀 방지 테스트.
//
// analyzeContract.ts / WorkplaceFormScreen.tsx / VaultScreen.tsx 는 visionOcr → fileStore
// 경유로 expo-file-system(RN 네이티브 모듈)에 결합돼 있어 node:test 에서 직접 import 하면
// 런타임에 죽는다. 순수 로직(mapOcrApiError, isUnsupportedOcrMimeType)은 aiProxy.test.ts 에서
// 실제 단위 테스트로 검증하고, 그 값들이 이 RN 결합 파일들 안에서 "올바르게 배선"돼 있는지는
// 소스 구조 검증(placePickerChip.test.ts 와 동일한 방식)으로 확인한다.
function readSrc(relPath: string): string {
  return readFileSync(join(process.cwd(), relPath), 'utf8');
}

const analyzeContractSrc = readSrc('src/features/evidence/services/ai/analyzeContract.ts');
const workplaceFormSrc = readSrc('src/features/workplace/screens/WorkplaceFormScreen.tsx');
const vaultScreenSrc = readSrc('src/features/evidence/screens/VaultScreen.tsx');
const aiProxyApiSrc = readSrc('src/features/evidence/services/ai/aiProxyApi.ts');
const reportScreenSrc = readSrc('src/features/payroll/screens/ReportScreen.tsx');

test('analyzeEvidenceFile: HEIC/HEIF 는 파일 읽기/서버 호출 전에 OCR_UNSUPPORTED_FORMAT 으로 즉시 반환한다', () => {
  const heicCheckIdx = analyzeContractSrc.indexOf('isUnsupportedOcrMimeType(mimeType)');
  const readableUriIdx = analyzeContractSrc.indexOf('resolveReadableUri(input.uri)');
  assert.ok(heicCheckIdx >= 0, 'HEIC/HEIF 사전 차단 호출이 있어야 한다');
  assert.ok(readableUriIdx >= 0, '파일 읽기(resolveReadableUri) 호출이 있어야 한다');
  assert.ok(heicCheckIdx < readableUriIdx, 'HEIC 차단은 파일 읽기보다 먼저 실행돼야 한다(왕복 낭비 방지)');
  assert.match(
    analyzeContractSrc,
    /isUnsupportedOcrMimeType\(mimeType\)\)\s*\{\s*[^}]*errorCode:\s*'OCR_UNSUPPORTED_FORMAT'/,
    'HEIC 판정 시 OCR_UNSUPPORTED_FORMAT 을 반환해야 한다'
  );
});

test('mapOcrErrorToAnalyzeCode: ocr.code 가 AnalyzeErrorCode 로 원인별로 갈라진다(뭉뚱그리지 않음)', () => {
  const fnMatch = analyzeContractSrc.match(/export function mapOcrErrorToAnalyzeCode[\s\S]*?\r?\n\}\r?\n/);
  assert.ok(fnMatch, 'mapOcrErrorToAnalyzeCode 함수가 있어야 한다');
  const body = fnMatch[0];
  assert.match(body, /case 'empty':\s*\r?\n\s*return 'OCR_EMPTY'/, "empty → OCR_EMPTY(사진 화질 문제)");
  assert.match(body, /case 'rate_limit':\s*\r?\n\s*return 'OCR_RATE_LIMIT'/, "rate_limit → OCR_RATE_LIMIT(429, 사진 문제 아님)");
  assert.match(body, /case 'network':\s*\r?\n\s*return 'OCR_NETWORK_ERROR'/, "network → OCR_NETWORK_ERROR(사진 문제 아님)");
  assert.match(body, /case 'server_error':\s*\r?\n\s*return 'OCR_SERVER_ERROR'/, "server_error → OCR_SERVER_ERROR(5xx/timeout, 사진 문제 아님)");
  assert.match(body, /file_unreadable[\s\S]*?return 'FILE_NOT_READY'/, "file_unreadable → FILE_NOT_READY");
});

test('OCR 성공 + Gemini 실패(SessionExpiredError 제외) 시 ocrText 를 보존해 ocr_only 로 돌려준다', () => {
  assert.match(
    analyzeContractSrc,
    /summary\.status === 'error'\)\s*\{[\s\S]*?return \{ status: 'ocr_only', ocrText: extractedText, analyzedAt, errorCode: summary\.code \}/,
    'Gemini 요약 실패해도 OCR 텍스트는 ocr_only 로 보존돼야 한다'
  );
});

test('요약 단계 인증 만료(SessionExpiredError)도 OCR 텍스트를 보존한 채 로그인 게이팅으로 넘긴다', () => {
  assert.match(
    analyzeContractSrc,
    /stage: 'summary' \}\);\s*\n\s*return \{ status: 'ocr_only', ocrText: extractedText, analyzedAt, errorCode: 'AUTH_REQUIRED' \}/,
    '요약 단계 인증 만료 시에도 ocrText 를 잃지 않아야 한다'
  );
});

for (const [label, src] of [
  ['WorkplaceFormScreen', workplaceFormSrc],
  ['VaultScreen', vaultScreenSrc],
] as const) {
  test(`${label}: OCR 실패 사용자 문구가 원인별로 분리돼 있다(HEIC/429/네트워크·서버 vs 사진 화질)`, () => {
    assert.match(src, /OCR_UNSUPPORTED_FORMAT/, `${label} 에 OCR_UNSUPPORTED_FORMAT 분기가 있어야 한다`);
    assert.match(src, /HEIC 형식의 사진은 아직 지원하지 않아요/, `${label} 이 HEIC 전용 안내 문구를 보여줘야 한다`);
    assert.match(src, /OCR_RATE_LIMIT/, `${label} 에 OCR_RATE_LIMIT 분기가 있어야 한다`);
    assert.match(
      src,
      /OCR_NETWORK_ERROR' \|\| .*errorCode === 'OCR_SERVER_ERROR'/,
      `${label} 이 네트워크/서버 오류를 함께 "분석 서버에 연결하지 못했어요"로 안내해야 한다`
    );
    assert.match(src, /분석 서버에 연결하지 못했어요/, `${label} 에 서버 연결 실패 문구가 있어야 한다`);
  });
}

test('AI_TIMEOUT_MS 는 실측 Render 콜드스타트(~53s)보다 넉넉한 여유를 둔다(45s 로 되돌아가는 회귀 방지)', () => {
  const m = aiProxyApiSrc.match(/const AI_TIMEOUT_MS = (\d+);/);
  assert.ok(m, 'AI_TIMEOUT_MS 상수가 있어야 한다');
  const value = Number(m![1]);
  assert.ok(value >= 60000, `AI_TIMEOUT_MS(${value}ms)는 콜드스타트를 견디도록 60s 이상이어야 한다`);
});

test('ReportScreen: 웹에서 저장한 리포트는 HTML로 정확히 표시된다(kind/mimeType 이 PDF로 오표기되지 않음)', () => {
  const webSaveMatch = reportScreenSrc.match(
    /name: `WorkProof_\$\{yearMonth\}_\$\{docLabel\}\.html`,\s*\n\s*uri: toHtmlDataUri\(html\),\s*\n\s*kind: '([^']+)',\s*\n\s*mimeType: '([^']+)'/
  );
  assert.ok(webSaveMatch, '웹 저장 경로의 addEvidenceFile 호출을 찾을 수 없다');
  assert.equal(webSaveMatch![1], 'file', '웹에서 생성한 HTML 리포트는 kind:"pdf" 로 오표기하면 안 된다');
  assert.equal(webSaveMatch![2], 'text/html', '웹에서 생성한 리포트는 mimeType:"text/html" 을 명시해야 한다');
});

test('ReportScreen: 네이티브에서 저장한 리포트는 실제 PDF 로 mimeType 이 명시된다', () => {
  const nativeSaveMatch = reportScreenSrc.match(
    /name: fileName,\s*\n\s*uri: destination\.uri,\s*\n\s*kind: '([^']+)',\s*\n\s*mimeType: '([^']+)'/
  );
  assert.ok(nativeSaveMatch, '네이티브 저장 경로의 addEvidenceFile 호출을 찾을 수 없다');
  assert.equal(nativeSaveMatch![1], 'pdf');
  assert.equal(nativeSaveMatch![2], 'application/pdf');
});

test('VaultScreen: isAnalyzable 은 jpg/png/pdf 를 지원하고 report HTML 은 제외한다', () => {
  const fnMatch = vaultScreenSrc.match(/function isAnalyzable[\s\S]*?\r?\n\}\r?\n/);
  assert.ok(fnMatch, 'isAnalyzable 함수가 있어야 한다');
  const body = fnMatch[0];
  assert.match(body, /mime === 'text\/html'/, 'text/html 은 명시적으로 제외해야 한다');
  assert.match(body, /endsWith\('\.html'\)/, '.html 파일명도 방어적으로 제외해야 한다');
  assert.match(body, /startsWith\('image\/'\) \|\| mime === 'application\/pdf'/, '이미지와 PDF 는 분석 가능해야 한다');
});

test('VaultScreen: ⋮ 메뉴 순서는 열기 → AI 액션 → 이름 변경 → 공유하기 → 삭제 → 취소다', () => {
  const menuMatch = vaultScreenSrc.match(/Alert\.alert\(item\.name, undefined, \[[\s\S]*?\]\);/);
  assert.ok(menuMatch, 'handleMenu 의 Alert.alert 액션 배열을 찾을 수 없다');
  const body = menuMatch[0];
  const openIdx = body.indexOf("text: '열기'");
  const aiActionsIdx = body.indexOf('...aiActions');
  const renameIdx = body.indexOf("text: '이름 변경'");
  const shareIdx = body.indexOf("text: '공유하기'");
  const deleteIdx = body.indexOf("text: '삭제'");
  const cancelIdx = body.indexOf("text: '취소'");
  assert.ok(
    openIdx < aiActionsIdx &&
      aiActionsIdx < renameIdx &&
      renameIdx < shareIdx &&
      shareIdx < deleteIdx &&
      deleteIdx < cancelIdx,
    '메뉴 순서가 열기 → AI 액션 → 이름 변경 → 공유하기 → 삭제 → 취소 이어야 한다'
  );
});
