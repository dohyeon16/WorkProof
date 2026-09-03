import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// 실기기 회귀: 이메일/Google/Kakao/Naver 로그인이 전부 앱에는 "로그인됨"으로 보이는데,
// 증빙 보관함/근로계약서/급여명세서 등 모든 AI 진입점에서 "AI 분석은 로그인 후 사용할 수
// 있어요" 게이트가 떴다. 원인: 소셜 로그인(Expo Go OAuth 브릿지)이 로컬 Account/isLoggedIn
// 플래그만 세우고 useAuth().isAuthenticated(백엔드 JWT 세션)는 전혀 갱신하지 않았다 —
// useAiAnalysis의 ensureCanAnalyze는 오직 이 세션만 본다. 이 파일들은 RN(react-navigation/
// expo-auth-session 등)에 결합돼 있어 node:test에서 직접 import할 수 없으므로(기존
// placePickerChip.test.ts와 동일한 이유), 소스 구조로 배선을 검증한다. 실제 세션 로직
// (loginWithBridgeSession)의 동작 자체는 auth.test.ts에서 순수 단위 테스트로 검증한다.
function readSrc(relPath: string): string {
  return readFileSync(join(process.cwd(), relPath), 'utf8');
}

const expoGoOAuthSrc = readSrc('src/features/auth/services/social/expoGoOAuth.ts');
const socialLoginSrc = readSrc('src/features/auth/services/social/socialLogin.ts');
const loginScreenSrc = readSrc('src/features/auth/screens/LoginScreen.tsx');
const signupScreenSrc = readSrc('src/features/auth/screens/SignupScreen.tsx');
const authApiSrc = readSrc('src/features/auth/services/authApi.ts');
const authContextSrc = readSrc('src/features/auth/state/AuthContext.tsx');

test('SocialLoginResult: success에 bridgeSessionId를 실을 수 있다', () => {
  assert.match(
    socialLoginSrc,
    /status: 'success';\s*\r?\n\s*profile: SocialProfile;[\s\S]*?bridgeSessionId\?: string;/,
    'success variant에 bridgeSessionId 필드가 있어야 한다'
  );
});

test('expoGoOAuth: 성공 시 bridgeSessionId를 결과에 담아 돌려준다', () => {
  assert.match(
    expoGoOAuthSrc,
    /function toSocialLoginResult\(profile: BridgeProfile, sessionId: string\)/,
    'toSocialLoginResult가 sessionId를 받아야 한다'
  );
  assert.match(expoGoOAuthSrc, /bridgeSessionId: sessionId/, 'bridgeSessionId를 결과에 실어야 한다');
  assert.match(
    expoGoOAuthSrc,
    /toSocialLoginResult\(statusRes\.profile, sessionId\)/,
    '실제 호출부가 sessionId를 함께 넘겨야 한다'
  );
});

test('Kakao Web도 server-side OAuth bridge를 사용한다', () => {
  assert.match(
    socialLoginSrc,
    /provider === 'kakao' && Platform\.OS === 'web'[\s\S]*?loginWithProviderBridge\('kakao'\)/
  );
  assert.doesNotMatch(socialLoginSrc, /clientSecret:\s*config\.clientSecret/);
});

test('expoGoOAuth: 성공 결과는 세션을 먼저 지우지 않는다(교환 전 삭제 경합 방지)', () => {
  // finish()가 성공일 때도 무조건 deleteBridgeSession을 부르면, 호출부가
  // bridgeSessionId로 /auth/bridge/exchange를 하기도 전에 세션이 삭제될 수 있다
  // (exchange 자체가 서버에서 세션을 소비하므로 사후 delete는 안전한 no-op).
  const finishMatch = expoGoOAuthSrc.match(/const finish = \(result: SocialLoginResult\)[\s\S]*?\r?\n  \};/);
  assert.ok(finishMatch, 'finish 헬퍼를 찾을 수 없다');
  assert.match(
    finishMatch[0],
    /if \(result\.status !== 'success'\) deleteBridgeSession\(sessionId\);/,
    '성공이 아닐 때만 즉시 세션을 지워야 한다'
  );
});

test('authApi: POST /auth/bridge/exchange 로 실제 백엔드 세션을 교환한다', () => {
  assert.match(authApiSrc, /'\/auth\/bridge\/exchange'/, '/auth/bridge/exchange 호출이 있어야 한다');
  assert.match(
    authApiSrc,
    /bridge_session_id:\s*bridgeSessionId/,
    'bridge_session_id 를 요청 바디에 담아야 한다(서버 snake_case 계약)'
  );
});

test('AuthContext: loginWithBridgeSession 을 공개해 화면이 canonical 세션을 갱신할 수 있다', () => {
  assert.match(authContextSrc, /loginWithBridgeSession\(bridgeSessionId: string\): Promise<AuthUser>/);
  assert.match(authContextSrc, /loginWithBridgeSession:\s*\(bridgeSessionId\)\s*=>\s*\r?\n?\s*session\.loginWithBridgeSession/);
});

for (const [label, src] of [
  ['LoginScreen', loginScreenSrc],
  ['SignupScreen', signupScreenSrc],
] as const) {
  test(`${label}: 소셜 로그인 성공 시 bridgeSessionId가 있으면 loginWithBridgeSession으로 교환한다`, () => {
    assert.match(src, /loginWithBridgeSession/, `${label} 이 loginWithBridgeSession 을 사용해야 한다`);
    assert.match(
      src,
      /if \((?:result|socialProfile)\.bridgeSessionId\)/,
      `${label} 이 bridgeSessionId 존재 여부로 분기해야 한다`
    );
  });

  test(`${label}: bridge 교환 실패가 로컬 로그인/가입 성공 흐름을 막지 않는다(try/catch로 격리)`, () => {
    const idx = src.indexOf('loginWithBridgeSession(');
    assert.ok(idx >= 0);
    // loginWithBridgeSession 호출 지점 앞뒤 400자 안에 try/catch가 있어야 한다(격리 확인).
    const region = src.slice(Math.max(0, idx - 200), idx + 200);
    assert.match(region, /try\s*\{/, `${label} 의 bridge 교환 호출이 try 블록 안에 있어야 한다`);
    assert.match(region, /catch/, `${label} 의 bridge 교환 실패를 catch로 흡수해야 한다`);
  });
}
