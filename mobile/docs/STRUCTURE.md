# 프로젝트 구조

```
WorkProof/
├─ .claude/             Claude Code 개인 설정 — gitignore 대상, 커밋 안 됨
├─ .github/workflows/   mobile-ci.yml · backend-ci.yml
├─ .vscode/settings.json  Explorer 표시 규칙(생성물 숨김 + File Nesting) — 빌드에 영향 없음
├─ .gitignore           저장소 전체 무시 규칙 (root 유지 필요)
├─ CLAUDE.md            Claude Code 가 root 에서 읽는 작업 지침
├─ README.md            GitHub 저장소 첫 화면
└─ mobile/
   ├─ frontend/         React Native(Expo) 앱 — Expo/Metro 프로젝트 루트
   ├─ backend/          FastAPI 서버 — Python/Render 프로젝트 루트
   ├─ docs/             설계·설정 문서 (setup/ 도구 가이드, references/ PDF)
   └─ archive/          로컬 보존 자료 — gitignore 대상, 커밋 안 됨
                        worktrees/ 는 Git worktree 라 일반 폴더처럼 옮기지 않는다
```

## root 설정 파일은 옮기지 않는다

`package.json` · `app.config.ts` · `eas.json` · `tsconfig*.json` · `main.py` ·
`alembic.ini` · `conftest.py` · `requirements*.txt` · `.env*` 는 npm · Expo · EAS ·
TypeScript · uvicorn/Render · Alembic · pytest 가 **각 런타임 루트에서 이름으로 찾는**
파일이다. 보기 좋게 하려고 하위 폴더로 옮기면 도구가 깨진다.

대신 `.vscode/settings.json` 의 `explorer.fileNesting` 으로 Explorer 에서만 대표 파일
아래로 접어 보여준다(파일은 그대로 있다):

| 접히는 위치 | 아래로 들어가는 파일 |
| --- | --- |
| `package.json` | `package-lock.json` · `tsconfig.json` · `tsconfig.tests.json` · `app.config.ts` · `eas.json` |
| `App.tsx` | `index.ts` |
| `README.md` | `CLAUDE.md` · `AGENTS.md` · `LICENSE` |
| `.env` | `.env.example` |
| `requirements.txt` | `requirements-dev.txt` |
| `main.py` | `conftest.py` |

같은 파일의 `files.exclude` 는 `node_modules` · `.expo` · `dist` · `dist-tests` ·
`__pycache__` · `.pytest_cache` · `.venv` 를 Explorer 에서 숨긴다 — **숨김이지 삭제가 아니다.**

`frontend/` 와 `backend/` 는 각각 **자기 런타임의 루트**다. Metro 의 projectRoot 는
`mobile/frontend`, Render 의 Root Directory 는 `mobile/backend` 이며, 두 런타임은
서로의 파일을 import 하지 않는다. 그래서 `metro.config.js` 도, `PYTHONPATH`/`sys.path`
조작도 필요 없다.

## OCR 과 AI 요약은 별개 영역이다

두 기능은 자주 같이 쓰이지만 책임이 다르다.

| | 입력 | 출력 | provider |
| --- | --- | --- | --- |
| **OCR** | 이미지 · PDF | 텍스트 | Google Cloud Vision |
| **AI Summary** | 텍스트 | 요약 · 구조화 JSON | Gemini |

OCR 은 이미지를 다루고 문서를 해석하지 않는다. AI Summary 는 텍스트만 받고 이미지·MIME 을
알지 못한다. 두 영역은 **서로를 import 하지 않는다** — 연결은 항상 바깥의 오케스트레이터가 한다.

```
mobile/frontend/src/
├─ app/navigation/       RootNavigator · MainTabs
├─ features/             화면 + 그 화면의 로직 (auth · workplace · work_schedule · attendance ·
│                        payroll · payslip · pay_comparison · evidence · settings · sync ...)
├─ ui/                   components/(forms·feedback·display) · design_system/(토큰 3계층)
├─ services/
│  ├─ ocr/               visionOcr · ocrError · readAsBase64(.web) · ocr.types
│  ├─ ai_summary/        geminiSummary · useAiAnalysis · aiAccess
│  ├─ api/               client · errors · config · aiProxyApi  ← 두 영역이 함께 쓰는 전송 계층
│  ├─ storage/ files/ backup/ notifications/
├─ hooks/ types/ utils/

오케스트레이터(두 영역을 잇는 곳):
  features/evidence/services/analyzeContract.ts   (근로계약서)
  features/payslip/services/analyzePayslip.ts     (급여명세서)

mobile/backend/app/services/
├─ ocr/                  vision.py (Vision 호출)
├─ ai_summary/           gemini.py (호출) · prompts.py (시스템 프롬프트)
├─ auth/                 auth_service · token_service · social_verify · oauth_bridge
├─ work_data_service.py  근무지 · 근무예정 · 출퇴근 기록 처리
└─ google_provider.py    예외 5종 · require_key · post_json  ← 두 영역이 함께 쓰는 공용 계층
```

`aiProxyApi`(프론트) 와 `google_provider`(백엔드) 가 각 런타임에서 같은 역할을 한다:
두 영역이 공유하는 것을 한쪽에 두면 다른 쪽이 그쪽에 의존하게 되므로, 공용 위치로 뺐다.

## 데이터 흐름

```
Frontend                              Backend                         Provider
─────────────────────────────────────────────────────────────────────────────────
VaultScreen / WorkplaceFormScreen
  └ features/evidence/services/analyzeContract.ts
      ├→ services/ocr/visionOcr ──────→ POST /api/v1/ai/ocr ──────────→ Vision
      │                               services/ocr/vision.py
      └→ services/ai_summary/gemini ──→ POST /api/v1/ai/summarize ───→ Gemini
                                      services/ai_summary/gemini.py

PayslipListScreen
  └ features/payslip/services/analyzePayslip.ts
      ├→ services/ocr/visionOcr ──────→ POST /api/v1/ai/ocr ──────────→ Vision
      └→ payslipStructuring ──────→ POST /api/v1/ai/extract-payslip → Gemini
            └→ payslipExtraction.parsePayslipRaw()   ← 파싱·검증은 클라이언트
```

급여명세서 파싱(`features/payslip/services/payslipExtraction.ts`)은 OCR 도 AI 도 아니다 —
모델이 낸 JSON 원문을 정규화·합계 대조하는 **급여 도메인 로직**이라 payslip feature 에 있다.

## 시크릿

Vision/Gemini 키는 **서버에만** 있다(`GOOGLE_VISION_API_KEY`, `GEMINI_API_KEY`, `GEMINI_MODEL`
— `backend/app/core/config.py` 의 settings 로만 읽고 `x-goog-api-key` 헤더로 전송). 앱 번들에는
provider 키가 없고, 클라이언트는 인증된 `/api/v1/ai/*` 프록시로만 호출한다. `.env` 는 양쪽 모두
gitignore 대상이다.

## 검증

| 대상 | 명령 |
| --- | --- |
| Frontend | `cd mobile/frontend && npx tsc --noEmit && npm test` |
| Expo 설정 | `cd mobile/frontend && npx expo config --type public` |
| Backend | `cd mobile/backend && pytest -q` |
| 마이그레이션 | `cd mobile/backend && alembic heads` |

OCR·AI Summary 는 각 런타임 안에 있으므로 별도 CI job 없이 위 명령에 함께 검증된다.
