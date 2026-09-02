import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// 실기기 회귀: 상세 화면(급여 비교/입력/근태 기록/근무지 등록 등)을 열었다 뒤로 나갔다가
// 다시 여는 걸 반복하면, 헤더의 "< 홈"/"< 분석" 뒤로가기가 눌러도 반응이 없는 것처럼
// 보이는 현상이 다수 보고됐다.
//
// 원인: React Navigation 7부터 navigate()는 같은 이름의 화면이 스택에 이미 있어도
// 기존 인스턴스로 점프하지 않고 항상 새 인스턴스를 push한다(v6은 점프했다 — 이 저장소도
// 예전엔 그 동작에 의존했다, WorkplacePlacePickerScreen의 popTo+merge 코멘트 참고).
// 이 앱은 Home/Analysis 탭에서 같은 상세 화면(같은 workplaceId+yearMonth 등)을 여러 번
// 열 수 있는 구조라, 스택에 같은 화면이 계속 쌓인다 — "< 홈"을 눌러도 바로 위에 쌓인
// 또 다른 상세 화면 인스턴스로만 이동해, 사용자에게는 버튼이 안 눌리는 것처럼 보인다.
//
// 수정: 대상을 식별하는 파라미터로 getId를 지정해, 같은 대상이면 기존 스택 인스턴스를
// 재사용하게 한다(React Navigation 7 공식 메커니즘 — node_modules/@react-navigation/core
// 의 ScreenOptions.getId). RootNavigator.tsx는 RN 내비게이션에 결합돼 있어 node:test에서
// 직접 import할 수 없으므로(기존 placePickerChip.test.ts와 동일한 이유), 소스 구조로
// 각 화면에 getId가 실제로 배선돼 있는지 검증한다.
const src = readFileSync(
  join(process.cwd(), 'src/app/navigation/RootNavigator.tsx'),
  'utf8'
);

function screenBlock(name: string): string {
  const re = new RegExp(`name="${name}"[\\s\\S]*?/>`);
  const m = src.match(re);
  assert.ok(m, `<Stack.Screen name="${name}" .../> 블록을 찾을 수 없다`);
  return m[0];
}

test('반복 재진입 가능한 상세 화면들은 대상 식별 파라미터로 getId를 지정해 중복 push를 막는다', () => {
  const expectations: [string, RegExp][] = [
    ['WorkplaceForm', /getId=\{\(\{ params \}\) => params\?\.id \?\? 'new'\}/],
    ['AttendanceCheck', /getId=\{\(\{ params \}\) => params\.workplaceId\}/],
    ['AttendanceForm', /getId=\{\(\{ params \}\) => `\$\{params\.workplaceId\}:\$\{params\.id \?\? params\.date \?\? 'new'\}`\}/],
    ['Schedule', /getId=\{\(\{ params \}\) => `\$\{params\.workplaceId\}:\$\{params\.id \?\? 'new'\}`\}/],
    ['PayInput', /getId=\{\(\{ params \}\) => `\$\{params\.workplaceId\}:\$\{params\.yearMonth\}`\}/],
    ['PayCompare', /getId=\{\(\{ params \}\) => `\$\{params\.workplaceId\}:\$\{params\.yearMonth\}`\}/],
    ['PayComparisonDetail', /getId=\{\(\{ params \}\) => `\$\{params\.workplaceId\}:\$\{params\.yearMonth\}`\}/],
    ['PayslipList', /getId=\{\(\{ params \}\) => params\.workplaceId\}/],
    ['PayslipReview', /getId=\{\(\{ params \}\) => params\.payslipId\}/],
    ['ChecklistDetail', /getId=\{\(\{ params \}\) => `\$\{params\.workplaceId\}:\$\{params\.yearMonth\}`\}/],
    ['Report', /getId=\{\(\{ params \}\) => `\$\{params\.workplaceId\}:\$\{params\.yearMonth\}`\}/],
  ];
  for (const [name, pattern] of expectations) {
    const block = screenBlock(name);
    assert.match(block, pattern, `${name} 화면에 예상한 getId가 배선돼 있어야 한다`);
  }
});

test('파라미터가 없는(사실상 단일 인스턴스인) 화면들은 getId로 항상 같은 인스턴스를 재사용한다', () => {
  for (const name of ['AllWorkplaces', 'Notifications', 'WorkplaceSwitch']) {
    const block = screenBlock(name);
    assert.match(block, /getId=\{\(\) => 'singleton'\}/, `${name} 화면에 singleton getId가 있어야 한다`);
  }
});
