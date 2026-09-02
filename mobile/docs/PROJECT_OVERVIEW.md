# WorkProof — 전체 시스템 개요

아르바이트 근무 기록과 예상 급여를 관리하는 React Native(Expo) 앱. 백엔드는
"인증 브리지"(선택적) 하나만 존재하고, 나머지 모든 데이터는 기기 로컬
(`AsyncStorage`)에 저장되는 **local-first** 구조다.

```
mobile/   React Native(Expo) 앱 — 실제 기능이 전부 여기 있음
backend/  FastAPI 서버 — Expo Go에서 소셜 로그인을 쓸 때만 필요한 OAuth 중계
```

## 1. 기술 스택

| 영역 | 사용 기술 |
| --- | --- |
| 프레임워크 | React Native `0.81.5` + Expo SDK `~54.0.2` |
| 언어 | TypeScript |
| 네비게이션 | `@react-navigation` (native-stack + bottom-tabs) |
| 로컬 저장 | `@react-native-async-storage/async-storage` |
| 웹 지원 | `react-native-web` (Next.js 아님 — `.web.ts/.web.tsx` 플랫폼 분기) |
| 소셜 로그인 | Google(`expo-auth-session`), Kakao/Naver(`@react-native-seoul/*`) |
| 위치 | `expo-location`(GPS), Kakao 장소 검색(`src/places/`) |
| OCR/AI | Google Cloud Vision(OCR) + Gemini(요약/구조화) — 서버 프록시 경유 |
| 알림 | `expo-notifications` |
| 생체인증/앱 잠금 | `expo-local-authentication` |
| 백엔드(선택) | FastAPI (`backend/`) — Expo Go 전용 OAuth 세션 중계 |

## 2. 데이터 저장 구조 (local-first)

모든 도메인 데이터는 `mobile/src/storage.ts`를 통해 `AsyncStorage`에 저장된다.
백엔드 DB가 아니라 **기기 자체가 유일한 저장소**다. 주요 엔티티(`src/types.ts`):

- **Workplace** — 근무지(시급/주휴수당 여부/5인 이상 여부/공제 유형/근로계약서 사본/GPS 위치)
- **AttendanceRecord** — 출퇴근 기록(시간, 휴게시간, 출퇴근 시점 GPS 좌표 — 근무지 증빙용)
- **ScheduledShift** — 예정 근무(출근 리마인더 알림의 근거)
- **PayRecord** — 월별 예상급여 vs 실입금액 + 자동 체크리스트(주휴수당/연장근로 등 위험 항목)
- **EvidenceFile** — 증빙 자료함(계약서 외 파일, OCR 텍스트 + AI 요약 포함)
- **Account** — 로그인 계정(로컬/Google/Kakao/Naver)

## 3. 인증 흐름

- **로컬 계정**: 이메일/비밀번호로 자체 가입·로그인, 비밀번호 재설정 지원.
- **소셜 로그인 (Google/Kakao/Naver)**:
  - **Web / Dev Build(네이티브)**: 각 provider SDK로 직접 로그인 (`mobile/docs/OAUTH_SETUP.md` 참고).
  - **Expo Go(iOS/Android)**: 네이티브 SDK·커스텀 URL 스킴을 쓸 수 없어 `backend/`의
    FastAPI Auth Bridge가 대신 처리한다.
    1. 앱 → `POST /auth/session/{provider}` → `login_url` 수신
    2. 인앱 브라우저로 `login_url` 오픈 → 사용자가 실제 provider 로그인
    3. provider → 서버 `/auth/{provider}/callback` 리다이렉트 → 서버가 코드 교환·프로필 조회 후 세션에 저장
    4. 앱이 `GET /auth/session/{id}`를 polling → 성공 시 프로필 수신 → 세션 삭제
  - 서버는 세션을 메모리에만 10분간 보관(재시작 시 소멸) — 인증만 중계할 뿐 사용자 데이터는 저장하지 않음.
- **앱 잠금**: 로그인 이후 `expo-local-authentication` 기반 생체인증/PIN으로 앱 재진입을 잠글 수 있음(`AppLockGate`).

## 4. 온보딩 → 근무지 등록 흐름

1. `OnboardingIntro` → `OnboardingValues`(가치관/사용 목적 소개) → `NotifPermission`(알림 권한 요청)
2. `WorkplacePrompt` → `WorkplaceForm`
   - 근무지명, 시급, 급여일, 주휴수당/5인 이상 여부, 휴게시간, 세후 공제 유형 입력
   - 위치: `WorkplacePlacePicker`(Kakao 장소 검색) 또는 지도에서 직접 선택 → GPS 좌표 + 역지오코딩 주소 저장
   - 근로계약서 사본 첨부(사진/PDF) → **OCR(Vision) → AI 요약(Gemini)** 자동 처리(`src/ai/analyzeContract.ts`)
3. `WorkplaceRegistered` 완료 화면 → 여러 근무지 등록 시 `WorkplaceSwitch`/`AllWorkplaces`에서 전환·관리

## 5. 출퇴근 기록

- `AttendanceCheckScreen`: 실시간 출근/퇴근 버튼 — 누르는 시점의 GPS 좌표를 함께 저장해
  "실제 근무지에서 기록됨"을 증빙 자료로 남김.
- `AttendanceFormScreen`: 수기 입력/수정(시간, 휴게시간, 휴일근로 여부, 메모).
- `ScheduleFormScreen`: 예정 근무 등록 → 지정 시간 전 출근 리마인더 알림(`notifications.ts`).
- `RecordsCalendarScreen`: 월간 캘린더 뷰로 기록/예정 근무 확인.

## 6. 급여 계산 & 비교 (`src/payCalc.ts`)

법정 기준을 반영한 예상 급여 자동 계산:

- 최저임금 하한 체크(연도별 갱신 값 사용)
- 1일 8시간 / 1주 40시간 초과분 연장근로 가산(5인 이상 사업장만)
- 휴게시간 의무(4시간 이상 근무 시 자동 차감)
- 주휴수당 반영 여부
- 공제 유형(무공제 / 원천징수 3.3% / 4대보험 약 9.4%)에 따른 세후 실수령 추정

**PayCompareScreen**에서 3-way 비교:

| 축 | 출처 |
| --- | --- |
| Expected(예상) | 출퇴근 기록 + 근무지 정책으로 자동 계산 |
| Payslip(급여명세서) | 사용자가 업로드한 급여명세서 사진 → OCR/AI로 구조화한 값 |
| Actual(실입금) | 통장에 실제로 들어온 금액(수기 입력) |

차이가 나면 `buildChecklist()`가 주휴수당/연장근로/휴게시간 차감/지각·조퇴/세금공제
항목별로 위험(risk)/정상(ok)을 자동 표시 → `ChecklistDetailScreen`에서 상세 확인.
(법적 판정이 아니라 참고용 체크리스트.)

## 7. 증빙 자료함 & 리포트

- `VaultScreen`: 계약서 외 증빙 파일(사진/PDF) 보관. 각 파일도 OCR+AI 요약 가능.
- `ReportScreen` → `ShareComplete`: 특정 월의 근무 기록 + 급여 비교 결과를 리포트로
  생성해 저장(`expo-print`, `expo-file-system`) 또는 공유(`expo-sharing`).
- 임금체불 등 분쟁 시 제출할 근거 자료를 한 곳에 모으는 것이 목적.

## 8. AI/OCR 파이프라인

```
파일(이미지/PDF) → Google Cloud Vision OCR → 텍스트 추출
                → Gemini 요약/구조화 → 계약서 핵심 조건 or 급여명세서 항목
```

- 인증된 사용자만 사용 가능(로그인 게이팅) — API 키는 클라이언트에 없고 백엔드 프록시가 보유.
- 실패 시 원인별(네트워크/요청 제한/설정 오류/빈 결과) 한국어 안내 메시지 제공.
- 텍스트는 성공하고 요약만 실패해도 OCR 결과는 보존(부분 성공 허용).

## 9. 알림

- 출근 리마인더(예정 근무 기준)
- 미퇴근 알림(퇴근 기록을 깜빡한 경우)
- 주간 근무시간 안내
- `NotificationsScreen`에서 알림 피드 확인(`notificationsFeed.ts`)

## 10. 화면/네비게이션 구조 (`src/navigation/`)

```
RootStack
├─ Splash
├─ Login / Signup / ResetPassword
├─ OnboardingIntro / OnboardingValues / NotifPermission
├─ WorkplacePrompt / WorkplaceForm / WorkplacePlacePicker / WorkplaceRegistered
├─ Main (BottomTabs)
│   ├─ Home           — 오늘 근무 상태, 빠른 출퇴근
│   ├─ Records        — 캘린더 기반 근무 기록
│   ├─ Analysis        — 급여 분석
│   ├─ Vault          — 증빙 자료함
│   └─ More           — 설정, 근무지 관리, 앱 잠금, 약관 등
├─ AllWorkplaces / WorkplaceSwitch
├─ AttendanceCheck / AttendanceForm / Schedule
├─ PayInput / PayCompare / ChecklistDetail / Report / ShareComplete
├─ Notifications
└─ LegalDocument (약관/개인정보처리방침)
```

## 11. 백엔드(`backend/`)와의 관계

- 오직 **Expo Go에서의 소셜 로그인 중계**와 **AI(Vision/Gemini) API 프록시** 두 가지만
  서버를 거친다. 그 외 모든 도메인 데이터(근무지, 출퇴근, 급여 등)는 서버로 전송되지 않고
  기기에만 저장된다.
- Render 무료 플랜에 배포되어 있으며, 트래픽 없으면 슬립 상태로 들어가 첫 요청이 느릴 수 있음.
