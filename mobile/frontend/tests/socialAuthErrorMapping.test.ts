import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  classifySocialError,
  socialErrorMessage,
  describeForLog,
  type SocialAuthErrorCode,
} from '../src/features/auth/services/social/socialAuthErrors';

// 실기기 회귀: 카카오 회원가입 실패 시 OAuth 원문이 그대로 다이얼로그에 노출됐다.
//   "Client authentication failed", "Bad client credentials", "HTTP 401",
//   "WWW-Authenticate: Bearer realm=..."
// 원인은 provider 모듈이 err.message 를 그대로 싣고 화면이 그대로 표시한 것.

const KAKAO_RAW =
  'HTTP 401 Unauthorized: {"error":"invalid_client","error_description":"Client authentication failed. ' +
  'Bad client credentials.","www-authenticate":"Bearer realm=\\"kauth.kakao.com\\""}';

test('OAuth 원문은 사용자 문구에 한 글자도 섞이지 않는다', () => {
  const code = classifySocialError(KAKAO_RAW);
  const msg = socialErrorMessage('kakao', code);
  for (const leak of [
    'Client authentication',
    'Bad client credentials',
    'invalid_client',
    'www-authenticate',
    'WWW-Authenticate',
    'HTTP 401',
    'Bearer',
    'realm',
  ]) {
    assert.ok(!msg.includes(leak), `사용자 문구에 "${leak}" 가 노출된다: ${msg}`);
  }
});

test('카카오 401(client credentials)은 설정 오류로 분류된다', () => {
  assert.equal(classifySocialError(KAKAO_RAW), 'PROVIDER_CONFIG');
  assert.equal(classifySocialError(new Error('Bad client credentials')), 'PROVIDER_CONFIG');
  assert.equal(classifySocialError({ error: 'invalid_client' }), 'PROVIDER_CONFIG');
});

test('원인별로 서로 다른 사용자 문구를 만든다', () => {
  const codes: SocialAuthErrorCode[] = [
    'CANCELLED', 'NOT_CONFIGURED', 'PROVIDER_CONFIG', 'NETWORK',
    'TIMEOUT', 'SESSION_EXPIRED', 'ACCOUNT_CONFLICT', 'PROVIDER_UNAVAILABLE', 'UNKNOWN',
  ];
  const msgs = codes.map((c) => socialErrorMessage('kakao', c));
  assert.equal(new Set(msgs).size, codes.length, '서로 다른 원인이 같은 문구로 뭉뚱그려진다');
  // 취소/네트워크/만료는 원인이 분명히 구분돼야 한다.
  assert.match(socialErrorMessage('kakao', 'CANCELLED'), /취소/);
  assert.match(socialErrorMessage('kakao', 'NETWORK'), /네트워크/);
  assert.match(socialErrorMessage('kakao', 'SESSION_EXPIRED'), /만료/);
});

test('사용자 문구는 짧다 — 긴 원문이 모달을 가득 채우던 문제 방지', () => {
  for (const p of ['google', 'kakao', 'naver']) {
    for (const c of ['PROVIDER_CONFIG', 'UNKNOWN', 'NETWORK'] as SocialAuthErrorCode[]) {
      const msg = socialErrorMessage(p, c);
      assert.ok(msg.length <= 60, `${p}/${c} 문구가 너무 길다(${msg.length}자)`);
      assert.ok(msg.split('\n').length <= 2, `${p}/${c} 문구가 2줄을 넘는다`);
    }
  }
});

test('로그 요약에 credential/원문이 남지 않는다', () => {
  const line = describeForLog('kakao', 'token-exchange', KAKAO_RAW);
  for (const leak of ['Bad client credentials', 'invalid_client', 'Bearer', 'realm']) {
    assert.ok(!line.includes(leak), `로그에 "${leak}" 가 남는다: ${line}`);
  }
  assert.match(line, /code=PROVIDER_CONFIG/);
  assert.match(line, /rawLen=\d+/, '원문은 길이로만 남겨야 한다');
});

// ── 앱 전체에 raw 노출 경로가 남아 있지 않은지 구조로 고정 ──────────────────
const socialDir = 'src/features/auth/services/social';
test('social 모듈은 error 결과에 원문 message 를 싣지 않는다', () => {
  for (const f of readdirSync(socialDir).filter((f) => f.endsWith('.ts'))) {
    if (f === 'socialAuthErrors.ts') continue;
    const src = readFileSync(join(socialDir, f), 'utf8');
    assert.ok(
      !/status: 'error',\s*message:/.test(src),
      `${f} 가 아직 error 결과에 message 를 싣는다 — code 로 바꿔야 한다`
    );
  }
});

test('로그인/회원가입 화면은 원문 대신 매핑된 문구를 쓴다', () => {
  for (const f of ['LoginScreen.tsx', 'SignupScreen.tsx']) {
    const src = readFileSync(join('src/features/auth/screens', f), 'utf8');
    assert.ok(!src.includes('result.message'), `${f} 가 provider 원문을 그대로 표시한다`);
    assert.match(src, /socialErrorMessage\(/, `${f} 가 공통 매퍼를 쓰지 않는다`);
  }
});

test('authErrorMessage 는 알 수 없는 Error 원문을 사용자에게 넘기지 않는다', () => {
  const src = readFileSync('src/features/auth/services/authErrors.ts', 'utf8');
  assert.ok(
    !/if \(err instanceof Error && err\.message\) return err\.message;/.test(src),
    '임의 Error 의 message 를 그대로 반환하면 HTTP/SDK 원문이 노출된다'
  );
});

// ── AI 로그인 게이트 문구 중복 제거 ──────────────────────────────────────────
test('AI 로그인 다이얼로그는 제목과 본문이 같은 문장을 반복하지 않는다', () => {
  const src = readFileSync('src/services/ai_summary/aiAccess.ts', 'utf8');
  const title = src.match(/title: '([^']+)'/)?.[1] ?? '';
  const message = src.match(/message: '([^']+)'/)?.[1] ?? '';
  assert.ok(title.length > 0 && message.length > 0);
  assert.ok(!message.startsWith(title), `본문이 제목을 그대로 반복한다: ${message}`);
  assert.ok(message.length <= 60, '본문이 너무 길다');
});
