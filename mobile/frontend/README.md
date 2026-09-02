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

## src 구성

| 경로 | 역할 |
| --- | --- |
| `src/ocr/` | 이미지·PDF → 텍스트 (Google Vision). 문서를 해석하지 않는다 |
| `src/ai_summary/` | 텍스트 → 요약·분석 (Gemini). 이미지·MIME 을 다루지 않는다 |
| `src/core/` | api 클라이언트·도메인 모델·저장소·알림 |
| `src/features/` | 화면과 feature 로직 |
| `src/shared/` | 재사용 컴포넌트·유틸·테마 |
| `src/app/` | 네비게이션 |

`src/ocr` 와 `src/ai_summary` 는 서로를 import 하지 않는다. 둘을 잇는 코드는
`src/features/evidence/services/analyzeContract.ts`(계약서)와
`src/features/payroll/services/analyzePayslip.ts`(급여명세서)에 있다.
두 영역이 함께 쓰는 백엔드 전송 계층은 `src/core/api/aiProxyApi.ts` 다.

전체 구조와 데이터 흐름은 `../docs/STRUCTURE.md` 참고.

## 환경변수

`.env`(gitignore 대상)에 `EXPO_PUBLIC_*` 값을 넣는다 — 키 이름은 `.env.example` 참고.
Vision/Gemini 키는 여기 없다. 서버가 쥐고 있고 앱은 인증된 프록시로만 호출한다.
소셜 로그인·카카오 장소 검색 설정은 `../docs/OAUTH_SETUP.md`.
