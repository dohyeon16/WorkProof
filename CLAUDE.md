## 프로젝트

- WorkProof: 아르바이트 근무 기록과 예상 급여를 관리하는 React Native(Expo) 앱
- 실제 코드는 전부 `mobile/` 안에 있음. 백엔드 없음 — `AsyncStorage` 기반 완전 로컬 저장 구조
- 패키지 매니저는 npm만 사용 (`mobile/package-lock.json` 기준)
- `mobile/AGENTS.md` 참고: Expo 버전이 자주 바뀌므로, 코드 작성 전 해당 버전 공식 문서를 확인할 것

## 규칙

- 작업은 항상 `mobile/` 안에서 진행한다
- 커밋 메시지는 영어 conventional commits 스타일 (`feat:`, `fix:`, `chore:` ...)
- 소셜 로그인(Google/Kakao/Naver), 카카오 장소 검색(`src/places/`) 관련 작업은 `mobile/OAUTH_SETUP.md`를 먼저 확인한다
- 네이티브(.ts/.tsx)와 웹(.web.ts/.web.tsx) 플랫폼별 파일이 갈리는 곳은 두 버전 다 확인한다
- UI/기능을 바꾼 뒤에는 가능하면 실제로 앱을 띄워 눌러보고 확인한다

## 금지

- `mobile/.env`, `mobile/.env.local` 읽기/수정/커밋 금지 (실제 API 키 포함, `.env.example`은 예외)
- `rm -rf`, `git push --force`, `git reset --hard` 등 파괴적 명령 금지
- `.claude/`는 개인 설정이라 이 저장소에서 gitignore 대상 — 커밋 대상 아님

## 검증

- `.ts`/`.tsx` 수정 후에는 `cd mobile && npx tsc --noEmit`이 에러 없이 통과해야 한다
- 이 프로젝트엔 lint/test 스크립트가 없다 — typecheck가 사실상 유일한 자동 검증 수단이다
- UI 변경은 `npm run web`으로 띄워서 실제 동작을 확인한 뒤에만 완료로 보고한다
