import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function read(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

const signup = read('src/features/auth/screens/SignupScreen.tsx');
const packageJson = read('package.json');
const easConfig = read('eas.json');
const appConfig = read('app.config.ts');

test('이메일 회원가입 완료는 로그인 화면으로 이동하고 authenticated route를 열지 않는다', () => {
  const emailFlow = signup.slice(signup.indexOf('// ---- 이메일 회원가입'));
  assert.match(emailFlow, /name: 'Login', params: \{ prefillEmail: signupEmail \}/);
  assert.doesNotMatch(emailFlow, /name: 'OnboardingIntro'/);
});

test('OAuth와 Kakao 장소 검색은 Expo가 정적으로 치환 가능한 정확한 public key를 사용한다', () => {
  const contracts: Array<[string, RegExp]> = [
    ['src/features/auth/services/social/googleIdentityWeb.ts', /process\.env\.EXPO_PUBLIC_GOOGLE_CLIENT_ID/],
    ['src/features/auth/services/social/providers.ts', /process\.env\.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID/],
    ['src/features/auth/services/social/providers.ts', /process\.env\.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID/],
    ['src/features/auth/services/social/providers.ts', /process\.env\.EXPO_PUBLIC_KAKAO_CLIENT_ID/],
    ['src/features/auth/services/social/naverIdentityWeb.ts', /process\.env\.EXPO_PUBLIC_NAVER_CLIENT_ID/],
    ['src/features/auth/services/social/naverNative.ts', /process\.env\.EXPO_PUBLIC_NAVER_CLIENT_ID/],
    ['src/features/auth/services/social/kakaoNative.ts', /process\.env\.EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY/],
    ['src/features/workplace/services/places/kakaoPlaces.ts', /process\.env\.EXPO_PUBLIC_KAKAO_CLIENT_ID/],
    ['src/features/workplace/services/places/kakaoPlaces.web.ts', /process\.env\.EXPO_PUBLIC_KAKAO_JS_KEY/],
  ];

  for (const [file, expected] of contracts) {
    assert.match(read(file), expected, `${file} 환경 변수 계약이 변경됨`);
  }
});

test('일반 실행/build 설정은 dotenv 로딩을 영구 차단하지 않는다', () => {
  for (const [name, source] of [
    ['package.json', packageJson],
    ['eas.json', easConfig],
    ['app.config.ts', appConfig],
  ] as const) {
    assert.doesNotMatch(source, /EXPO_NO_DOTENV|EXPO_NO_CLIENT_ENV_VARS/, `${name}이 Expo env 로딩을 차단함`);
  }
});
