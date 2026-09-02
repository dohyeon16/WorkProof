# WorkProof

아르바이트 근무 기록과 예상 급여를 관리하는 모바일 앱입니다.

## 주요 기능

- 로그인 및 회원가입
- 근무지 등록
- 출퇴근 기록
- 예상 급여 계산
- 실제 입금액 비교
- 증빙 자료 및 리포트 관리

## 구조

코드는 `mobile/` 아래 두 런타임으로 나뉩니다. 각 폴더가 자기 런타임의 루트입니다.

| 경로 | 역할 |
| --- | --- |
| `mobile/frontend/` | React Native(Expo) 앱. 근무 기록·급여 화면과 로컬 저장(AsyncStorage) |
| `mobile/backend/` | FastAPI 서버. 소셜 로그인 중계와 근무 데이터 API, OCR·AI 요약 프록시 |
| `mobile/docs/` | 설계·설정 문서 |

앱의 문서 인식 기능은 두 영역으로 나뉘어 있고 서로를 import 하지 않습니다.

- **OCR** — 이미지·PDF에서 텍스트만 추출 (Google Cloud Vision). 문서를 해석하지 않습니다.
- **AI Summary** — 추출된 텍스트를 요약·구조화 (Gemini). 이미지를 다루지 않습니다.

Vision/Gemini 키는 서버에만 있고, 앱은 인증된 `/api/v1/ai/*` 프록시로만 호출합니다.

## 실행 방법

프론트엔드(Expo 앱):

```bash
cd mobile/frontend
npm install
npx expo start
```

백엔드(FastAPI 서버):

```bash
cd mobile/backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

## 배포

백엔드는 Render에 배포되어 있습니다 — 검증용 Preview와 운영용 Production 두 서비스가
모두 `mobile/backend`를 루트로 사용합니다. 배포 설정과 API 계약은
[`mobile/backend/README.md`](mobile/backend/README.md)를 참고하세요.

## 문서

- [`mobile/docs/README.md`](mobile/docs/README.md) — 문서 색인
- [`mobile/docs/STRUCTURE.md`](mobile/docs/STRUCTURE.md) — 폴더 구조와 데이터 흐름
- [`mobile/docs/PROJECT_OVERVIEW.md`](mobile/docs/PROJECT_OVERVIEW.md) — 기능 개요
- [`mobile/docs/OAUTH_SETUP.md`](mobile/docs/OAUTH_SETUP.md) — 소셜 로그인·카카오 장소 검색 키 설정

## Local development files

- 로컬 참고 문서, 디자인 자료, 외부 도구는 Git 저장소 밖에서 관리합니다.
- 저장소에는 앱 실행과 협업에 필요한 추적 파일만 유지합니다.
- `.env`, 개인 설정, PDF 자료, 외부 도구 복사본은 커밋하지 않습니다.
- 로컬 보관 경로는 개발자 환경마다 다를 수 있습니다.
