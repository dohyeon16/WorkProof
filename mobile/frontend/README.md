# WorkProof frontend

React Native(Expo SDK 54) 앱. 이 디렉터리가 **Expo/Metro 프로젝트 루트**다 —
`npm`·`expo`·`tsc` 명령은 전부 여기서 실행한다.

## 실행

```bash
npm ci
npm run start      # Expo dev server
npm run web        # 웹으로 확인
```

## 검증

```bash
npx tsc --noEmit                  # 0 errors 여야 한다
npm test                          # node:test (tests/**)
npx expo config --type public     # app.config.ts 해석 확인
```

## src 구성 — 폴더 이름이 곧 역할이다

기능(feature) 우선 구조다. 한 화면과 그 화면이 쓰는 로직은 같은 feature 폴더 안에 있고,
여러 feature 가 공유하는 것만 `ui/` · `services/` · `utils/` 로 뺐다.

```
src/
├─ app/navigation/    RootNavigator · MainTabs · 화면 파라미터 타입
│
├─ features/          ← 화면과 그 화면의 로직 (screens/ · services/ · state/ · components/)
│  ├─ auth/           로그인 · 회원가입 · 비밀번호 재설정 (services/social/ = 구글·카카오·네이버)
│  ├─ onboarding/     스플래시 · 인트로 · 알림 권한 · 근무지 등록 유도
│  ├─ home/           홈 대시보드
│  ├─ workplace/      근무지 등록·수정·전환·장소 검색
│  ├─ work_schedule/  근무 예정(스케줄) 등록·수정
│  ├─ attendance/     출퇴근 기록 · 근무 기록 달력 · GPS 검증 · 변경 이력
│  ├─ payroll/        예상 급여 계산(payCalc) · 실제 입금액 입력 · 급여 분석 · PDF 리포트
│  ├─ payslip/        급여명세서 목록·확인 · OCR→AI 구조화 파이프라인
│  ├─ pay_comparison/ 예상 vs 실제 급여 비교 · 항목별 차이
│  ├─ evidence/       증빙 보관함 · 근로계약서 분석 · 공유
│  ├─ insights/       주간 근로시간 계산과 안내(주휴·40시간)
│  ├─ notifications/  알림 목록 화면
│  ├─ settings/       더보기 · 계정
│  ├─ security/       앱 잠금(생체/PIN) 게이트
│  ├─ sync/           서버 동기화 엔진 · 큐 · 병합 · 매핑
│  └─ legal/          약관·개인정보처리방침 본문과 뷰어
│
├─ ui/                ← 화면에 종속되지 않는 UI 자산
│  ├─ components/     forms/ (입력·달력·휠) · feedback/ (Alert·로딩·컨페티) · display/ (Text·로고)
│  └─ design_system/  3계층 토큰: primitives → semantic(+dark) → components. `colors` 등의 진입점은 index.ts
│
├─ services/          ← 외부/플랫폼과 이야기하는 계층
│  ├─ api/            HTTP 클라이언트 · 엔드포인트 설정 · 에러 · AI 프록시 호출
│  ├─ ocr/            이미지·PDF → 텍스트 (Google Vision). 문서를 해석하지 않는다
│  ├─ ai_summary/     텍스트 → 요약·분석 (Gemini). 이미지·MIME 을 다루지 않는다
│  ├─ storage/        AsyncStorage 도메인 저장소와 키
│  ├─ files/          증빙 파일 저장/읽기 (네이티브 · 웹)
│  ├─ backup/         백업 내보내기·복원
│  └─ notifications/  로컬 알림 스케줄링과 알림 피드 생성
│
├─ hooks/             화면 간 공용 훅
├─ types/             도메인 모델 타입 (domain.ts — 근무지·기록·급여·명세서·증빙)
└─ utils/             날짜 · Expo Go 판별 · 웹 창 열기
```

화면을 찾을 때는 `features/<기능>/screens/` 를 보면 된다. 예: 로그인은
`features/auth/screens/LoginScreen.tsx`, 급여 비교는
`features/pay_comparison/screens/PayCompareScreen.tsx`.
파일명은 내비게이션 route 이름과 1:1로 맞춰 두었다(`RootNavigator.tsx` 참고).

`services/ocr` 와 `services/ai_summary` 는 서로를 import 하지 않는다. 둘을 잇는 코드는
`features/evidence/services/analyzeContract.ts`(계약서)와
`features/payslip/services/analyzePayslip.ts`(급여명세서)에 있다.
두 영역이 함께 쓰는 백엔드 전송 계층은 `services/api/aiProxyApi.ts` 다.

전체 구조와 데이터 흐름은 `../docs/STRUCTURE.md` 참고.

## 환경변수

`.env`(gitignore 대상)에 `EXPO_PUBLIC_*` 값을 넣는다 — 키 이름은 `.env.example` 참고.
Vision/Gemini 키는 여기 없다. 서버가 쥐고 있고 앱은 인증된 프록시로만 호출한다.
소셜 로그인·카카오 장소 검색 설정은 `../docs/OAUTH_SETUP.md`.
