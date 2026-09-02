import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLACE_CATEGORY_CHIPS } from '../src/features/workplace/services/places/placeCategories';

// DV-06b 회귀 방지용 "구조 가드" 테스트.
//
// 카테고리 칩(음식점/카페 등)을 누르면 검색 결과는 바뀌지만, 눌린 칩의 선택
// 색상이 표시되지 않던 UI 버그(FAIL @ 436448a)의 회귀를 막는다. 렌더러가 없는
// 순수 로직 테스트 인프라라 소스 구조로 검증한다(신규 dependency 불필요).
const src = readFileSync(
  join(process.cwd(), 'src/features/workplace/screens/WorkplacePlacePickerScreen.tsx'),
  'utf8'
);

test('WorkplacePlacePicker: 카테고리 칩 선택 state 가 있고 active style 을 조건부 적용한다', () => {
  // 활성 칩 state 존재.
  assert.match(src, /activeChip/, 'activeChip 선택 state 가 있어야 한다');
  assert.match(src, /setActiveChip/, 'setActiveChip 로 선택 칩을 갱신해야 한다');
  // 칩 Pressable 에 조건부 active 스타일이 적용돼야 한다.
  assert.match(
    src,
    /activeChip === chip\.label && styles\.chipActive/,
    '선택된 칩에만 styles.chipActive 를 조건부로 적용해야 한다'
  );
  // active 스타일이 실제로 정의돼 있어야 한다(정의만 하고 미적용 회귀 방지).
  assert.match(src, /chipActive:\s*\{[^}]*backgroundColor/, 'styles.chipActive 가 배경색을 정의해야 한다');
});

test('WorkplacePlacePicker: 직접 상호명 검색 시 칩 선택색을 해제한다', () => {
  // handleSearchSubmit(직접 검색)은 setActiveChip(null) 로 칩 선택을 해제해야 한다.
  const idx = src.indexOf('handleSearchSubmit');
  assert.ok(idx >= 0, 'handleSearchSubmit 이 있어야 한다');
  const region = src.slice(idx, idx + 300);
  assert.match(region, /setActiveChip\(null\)/, '직접 검색 시 setActiveChip(null) 로 칩 선택을 해제해야 한다');
});

test('WorkplacePlacePicker: Kakao Places 검색 API 호출은 그대로 유지된다', () => {
  // 검색 로직/엔드포인트 호출부(searchPlaces via runSearch)는 변경하지 않는다.
  assert.match(src, /searchPlaces/, 'searchPlaces 호출이 유지돼야 한다');
});

test('WorkplacePlacePicker: 칩에 accessibilityState.selected 를 실제로 배선한다', () => {
  assert.match(
    src,
    /accessibilityState=\{\{ selected: activeChip === chip\.label \}\}/,
    'accessibilityState.selected 가 activeChip 과 실제로 연동돼야 한다(스크린리더/자동화 테스트용 신호)'
  );
});

// 회귀 배경: 실기기에서 "칩을 눌러도 선택색이 안 보인다"는 신고가 재발했다. 코드 자체는
// 이미 올바르게 구현돼 있었고(activeChip state + 조건부 style + accessibilityState 모두
// 정상) 원인은 앱/Metro 캐시로 추정된다. 다만 라벨이 우연히 중복되면 activeChip을
// label로 비교하는 현재 구현에서 서로 다른 칩이 동시에 활성으로 보일 수 있으므로,
// 데이터 자체의 무결성도 함께 가드한다.
test('PLACE_CATEGORY_CHIPS: 라벨이 모두 고유하다(activeChip을 label로 비교하므로 중복 시 여러 칩이 동시에 활성화된다)', () => {
  const labels = PLACE_CATEGORY_CHIPS.map((c) => c.label);
  assert.equal(new Set(labels).size, labels.length, '카테고리 칩 라벨은 중복되면 안 된다');
  assert.ok(labels.length >= 5, '카테고리 칩이 비어있거나 비정상적으로 적으면 안 된다');
});
