import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// 2026-09-03 실기기 회귀 감사에서 확인된 3가지를 구조 가드로 고정한다.
// 이 저장소의 테스트 인프라는 순수 로직용(node:test, React 렌더러 없음)이라
// 렌더링 대신 소스 구조를 검사한다 — moreScreenLayout/navigatorScreenIdentity 와 같은 방식.
const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const alertSrc = read('src/ui/components/feedback/Alert.tsx');
const configSrc = read('src/services/api/config.ts');
const authApiSrc = read('src/features/auth/services/authApi.ts');
const loginSrc = read('src/features/auth/screens/LoginScreen.tsx');
const signupSrc = read('src/features/auth/screens/SignupScreen.tsx');
const aiAccessSrc = read('src/services/ai_summary/aiAccess.ts');
const useAiSrc = read('src/services/ai_summary/useAiAnalysis.ts');

// ── 증상 C: 공용 Alert 이 실기기에서 OS 기본 알림으로 뜨던 문제 ────────────────
test('Alert: 모든 플랫폼에서 앱 디자인 시스템 다이얼로그로 렌더한다 (OS Alert 위임 금지)', () => {
  assert.doesNotMatch(
    alertSrc,
    /RNAlert\.alert|Alert as RNAlert/,
    'Alert 이 react-native 의 OS Alert 로 위임하면 실기기에서 앱 디자인과 다른 알림이 뜬다'
  );
  assert.doesNotMatch(
    alertSrc,
    /Platform\.OS\s*!==\s*'web'/,
    'AlertHost/alertImpl 이 웹에서만 동작하도록 분기하면 네이티브에서 다이얼로그가 사라지거나 OS 알림이 된다'
  );
  // 디자인 토큰을 쓰는 커스텀 모달이어야 한다.
  assert.match(alertSrc, /from '\.\.\/\.\.\/design_system'/);
  assert.match(alertSrc, /<Modal/);
});

test('Alert: 모달이 안전영역과 접근성 라벨을 지킨다', () => {
  assert.match(alertSrc, /useSafeAreaInsets/, '모달 카드가 노치/홈 인디케이터에 물리지 않아야 한다');
  assert.match(alertSrc, /insets\.top/);
  assert.match(alertSrc, /insets\.bottom/);
  assert.match(alertSrc, /accessibilityRole="button"/, '버튼에 screen reader 역할이 있어야 한다');
});

// ── 증상 A: 콜드 스타트로 백엔드 세션 교환이 끊겨 AI 게이트가 잘못 뜨던 문제 ──
test('auth: 인증 요청은 Render 콜드 스타트를 견디는 타임아웃을 쓴다', () => {
  const m = configSrc.match(/AUTH_TIMEOUT_MS\s*=\s*(\d+)/);
  assert.ok(m, 'AUTH_TIMEOUT_MS 가 정의돼야 한다');
  assert.ok(
    Number(m[1]) >= 60000,
    `인증 타임아웃이 ${m[1]}ms 다 — Render Free 콜드 스타트(실측 30~60초)보다 길어야 세션 교환이 끊기지 않는다`
  );
});

test('auth: 로그인/가입/브릿지교환/갱신이 인증 타임아웃을 적용한다', () => {
  assert.match(authApiSrc, /import \{ AUTH_TIMEOUT_MS \}/);
  for (const path of ['/auth/register', '/auth/login', '/auth/bridge/exchange', '/auth/refresh']) {
    const block = authApiSrc.slice(authApiSrc.indexOf(`'${path}'`));
    const head = block.slice(0, 200);
    assert.match(head, /timeoutMs: AUTH_TIMEOUT_MS/, `${path} 가 AUTH_TIMEOUT_MS 를 쓰지 않는다`);
  }
});

test('auth: 브릿지 세션 교환 실패를 삼키지 않고 사용자에게 알린다', () => {
  for (const [name, src] of [['LoginScreen', loginSrc], ['SignupScreen', signupSrc]] as const) {
    assert.match(
      src,
      /backendSessionReady\s*=\s*false/,
      `${name}: 교환 실패를 상태로 남겨야 한다`
    );
    assert.match(
      src,
      /SOCIAL_BACKEND_SESSION_FAILED/,
      `${name}: 실패 시 "로그인 완료" 대신 원인을 설명하는 안내를 띄워야 한다`
    );
  }
});

// ── OCR 과 AI Summary 의 게이트 분리 (구조 정리 이후 유지 확인) ────────────────
test('AI 게이트: 저장된 분석 결과 열람은 로그인을 요구하지 않는다', () => {
  assert.match(
    aiAccessSrc,
    /VIEW_SAVED_ANALYSIS_REQUIRES_LOGIN\s*=\s*false/,
    '기존 결과 열람까지 게이팅하면 회귀다'
  );
});

test('AI 게이트: 새 분석 시작만 로그인 세션을 요구한다', () => {
  assert.match(aiAccessSrc, /requiresLoginForNewAnalysis/);
  assert.match(useAiSrc, /ensureCanAnalyze/);
  // 게이트는 백엔드 세션(isAuthenticated) 하나만 본다 — 로컬 isLoggedIn 플래그로 대체 금지.
  assert.match(useAiSrc, /isAuthenticated/);
  assert.doesNotMatch(useAiSrc, /getAccount\(|setLoggedIn\(/);
});

test('OCR 은 AI Summary 를 import 하지 않는다 (영역 분리 유지)', () => {
  const ocrFiles = ['visionOcr.ts', 'ocrError.ts', 'readAsBase64.ts', 'ocr.types.ts'];
  for (const f of ocrFiles) {
    const src = read(`src/services/ocr/${f}`);
    assert.doesNotMatch(src, /ai_summary/, `${f} 가 ai_summary 를 참조하면 영역이 다시 합쳐진 것이다`);
  }
});
