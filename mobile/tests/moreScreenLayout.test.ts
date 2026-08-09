import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// DV-47 회귀 방지용 "구조 가드" 테스트.
//
// 이 프로젝트의 테스트 인프라는 순수 로직용(node --test, React 렌더러 없음)이라
// 실제 스크롤 동작을 렌더링해 검증할 수 없다(react-test-renderer/@testing-library =
// 신규 dependency 필요 → 금지). 대신 소스 구조를 검사해, 더보기 화면의 root 가
// 다시 스크롤 불가한 bare <View> 로 되돌아가는 회귀를 막는다.
//
// 배경: MoreScreen 은 로그인 상태에서 행이 늘어 화면 높이를 넘기면 하단(로그아웃·
// 앱 초기화)에 접근할 수 없었다(실기기 DV-47 FAIL @ 9aadb0e). root 를 세로 스크롤
// 컨테이너로 유지해야 한다.
const src = readFileSync(
  join(process.cwd(), 'src/features/settings/screens/MoreScreen.tsx'),
  'utf8'
);

test('MoreScreen: root 가 세로 스크롤 컨테이너다 (DV-47 회귀 방지)', () => {
  // react-native 에서 ScrollView 를 import 한다.
  assert.match(
    src,
    /import\s*\{[^}]*\bScrollView\b[^}]*\}\s*from\s*'react-native'/,
    'MoreScreen 이 react-native 의 ScrollView 를 import 해야 한다'
  );
  // 렌더 return 의 최상위 엘리먼트가 ScrollView 여야 한다.
  assert.match(
    src,
    /return\s*\(\s*<ScrollView/,
    '렌더 root 가 <ScrollView> 여야 한다'
  );
  // 회귀 감지: root 를 다시 bare <View> 로 되돌리면 실패한다.
  assert.doesNotMatch(
    src,
    /return\s*\(\s*<View/,
    '렌더 root 를 bare <View> 로 되돌리면 하단 항목 접근 불가 회귀'
  );
});

test('MoreScreen: 하단 항목이 tab bar/홈 인디케이터에 가리지 않도록 bottom inset 여백을 준다', () => {
  // contentContainerStyle 에 insets.bottom 기반 하단 패딩이 있어야 한다.
  assert.match(
    src,
    /contentContainerStyle/,
    'ScrollView 에 contentContainerStyle 이 있어야 한다'
  );
  assert.match(
    src,
    /paddingBottom:\s*insets\.bottom/,
    '마지막 항목이 하단 안전영역/탭바 뒤로 숨지 않도록 paddingBottom 에 insets.bottom 을 더해야 한다'
  );
});

test('MoreScreen: 앱 초기화가 로컬 세션(SecureStore 토큰)까지 정리한다 (자동로그인 잔존 회귀 방지)', () => {
  // 앱 초기화(handleResetApp)는 clearAllData(AsyncStorage) 뒤에 세션 로그아웃까지
  // 호출해야 한다. 이걸 빼면 SecureStore refresh 토큰이 남아 재시작 시 자동
  // 로그인으로 복원된다("모든 데이터 삭제"와 불일치). handleResetApp 는 파일 마지막
  // 핸들러라, 그 선언 이후에 등장하는 logout()/clearAllData 는 이 핸들러 안에 있다.
  const idx = src.indexOf('handleResetApp');
  assert.ok(idx >= 0, 'handleResetApp 핸들러가 있어야 한다');
  const after = src.slice(idx);
  assert.match(after, /clearAllData\(\)/, '앱 초기화는 clearAllData 로 로컬 데이터를 지워야 한다');
  assert.match(after, /\blogout\(\)/, '앱 초기화는 logout() 으로 세션/SecureStore 토큰까지 정리해야 한다');
});
