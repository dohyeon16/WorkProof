# WorkProof Auth Bridge (Expo Go 전용)

`mobile/frontend/`를 Expo Go(무료 Apple Developer 계정, 커스텀 URL 스킴/네이티브 SDK 없이)로
실행할 때만 쓰는 FastAPI 서버입니다. Expo Go는 `workproof://` 커스텀 스킴과
Kakao/Naver 네이티브 모듈을 쓸 수 없어서, 이 서버가 대신 OAuth authorization
code 교환을 서버 사이드에서 처리하고, 앱은 짧은 polling으로 결과를 받아갑니다.

- **web / Android·iOS Development Build**: 이 서버를 쓰지 않습니다. 기존
  방식(웹 OAuth, 네이티브 SDK) 그대로 동작합니다 — `mobile/docs/OAUTH_SETUP.md` 참고.
- **iOS/Android Expo Go**: 이 서버가 필요합니다.

## app/ 구성 — 폴더 이름이 곧 역할이다

FastAPI 표준 레이어 구조다. "무슨 기능인가"는 각 레이어 안의 **파일 이름**이 말해준다 —
`workplaces` 를 찾으려면 api·schemas·models 세 곳의 같은 이름 파일을 보면 된다.

```
app/
├─ main.py            앱 팩토리 · CORS · 예외 핸들러 · 라우터 등록
│
├─ api/v1/            ← HTTP 엔드포인트 (파일 하나 = 기능 하나)
│  ├─ auth.py             회원가입 · 로그인 · 토큰 재발급 · 소셜 로그인
│  ├─ oauth_bridge.py     Expo Go 전용 OAuth 브릿지 (접두사 없는 레거시 경로)
│  ├─ users.py            내 정보 조회·수정 · 근무 데이터 초기화
│  ├─ workplaces.py       근무지 CRUD
│  ├─ work_schedules.py   근무 예정 CRUD
│  ├─ attendance_records.py 출퇴근 기록 CRUD
│  ├─ ai_proxy.py         OCR · AI 요약 프록시 (/api/v1/ai/*)
│  ├─ health.py           상태 확인
│  └─ work_data_deps.py   근무 데이터 목록 공통 의존성(페이지네이션·날짜/근무지 필터)
│
├─ services/          ← 비즈니스 로직 (라우터는 얇게 유지)
│  ├─ auth/               auth_service · token_service · social_verify · oauth_bridge
│  ├─ ocr/                vision.py — 이미지·PDF → 텍스트 (Google Vision)
│  ├─ ai_summary/         gemini.py(호출) · prompts.py — 텍스트 → 요약·급여명세서 JSON
│  ├─ work_data_service.py 근무지·근무예정·출퇴근 기록 처리(소유권·멱등성·GPS 재계산)
│  └─ google_provider.py  OCR·AI 가 함께 쓰는 Google 호출 공용 계층(예외·키·POST)
│
├─ schemas/           요청/응답 Pydantic 모델 = API 계약
│                     auth · user · workplace · work_schedule · attendance_record · ai
├─ models/            SQLAlchemy ORM 테이블
│                     user · oauth_account · refresh_token · workplace · work_schedule · attendance_record
├─ repositories/      DB 쿼리와 소유권 필터 캡슐화
│                     users · oauth_accounts · refresh_tokens · work_data
├─ database/          엔진·세션(session.py) · ORM 베이스(base.py)
└─ core/              config(설정) · security(해시·JWT) · deps(의존성) · logging · geo(좌표 거리)
```

그 밖에: `alembic/` 마이그레이션, `tests/` pytest, `main.py`(= `uvicorn main:app` 진입점,
`app/main.py` 재export), `conftest.py`(테스트 DB/의존성 오버라이드).

OCR(`services/ocr`)과 AI 요약(`services/ai_summary`)은 서로를 import 하지 않는다.
공통 규칙만 `services/google_provider.py` 에 있고, 둘을 잇는 것은 `api/v1/ai_proxy.py` 다.

## 동작 방식

1. 앱이 `POST /auth/session/{provider}`로 세션을 만들고 `login_url`을 받습니다.
2. 앱이 `login_url`을 인앱 브라우저로 엽니다. 사용자가 실제 provider 로그인을 마칩니다.
3. provider가 이 서버의 `GET /auth/{provider}/callback`으로 리다이렉트합니다.
   서버가 state를 검증하고, code를 provider 토큰과 교환하고, 프로필을 조회해
   세션에 저장한 뒤 "앱으로 돌아가세요" 안내 페이지를 보여줍니다.
4. 앱은 `GET /auth/session/{session_id}`를 반복 조회(polling)하다가 `success`가
   되면 정규화된 프로필을 받고, `DELETE /auth/session/{session_id}`로 세션을
   정리합니다.

세션은 메모리에만 저장되고 10분 뒤 자동 만료됩니다 — 서버가 재시작되면 진행
중이던 로그인은 모두 무효화됩니다(테스트/개발 용도로 충분한 트레이드오프).

## 로컬 실행

```bash
cd mobile/backend
python -m venv .venv
.venv/Scripts/activate   # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env     # 값 채우기
uvicorn main:app --reload --port 8000
```

로컬 실행만으로는 휴대폰(Expo Go)에서 접근할 수 없습니다. provider가 리다이렉트로
이 서버를 호출해야 하므로, 공개적으로 접근 가능한 https 주소가 필요합니다 —
아래 Render 배포를 사용하거나, `ngrok http 8000` 같은 터널을 임시로 씁니다.

## Render 배포

1. Render 대시보드 → **New** → **Web Service** → 이 저장소 연결
2. **Root Directory**: `mobile/backend` (반드시 지정 — 지정하지 않으면 Render가
   저장소 루트에서 `requirements.txt`/`main.py`를 찾다가 실패합니다)
3. **Build Command**: `pip install -r requirements.txt`
4. **Start Command**: `uvicorn main:app --host 0.0.0.0 --port $PORT`
5. **Environment** 탭에서 아래 값을 채웁니다 (`.env.example` 참고):
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
   - `KAKAO_REST_API_KEY`, `KAKAO_CLIENT_SECRET`
   - `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`
   - `FRONTEND_ALLOWED_ORIGIN`
   - `SESSION_SIGNING_SECRET`
6. 배포 후 발급되는 주소(예: `https://workproof-auth.onrender.com`)를
   `mobile/frontend/.env`의 `EXPO_PUBLIC_AUTH_API_URL`에 입력합니다.

Render 무료 플랜은 트래픽이 없으면 슬립 상태로 들어갑니다 — 첫 요청(세션 생성)이
평소보다 느릴 수 있습니다(콜드 스타트).

## 각 콘솔에 등록할 Callback URL

배포된 base URL을 `<BASE_URL>`이라 하면 (예: `https://workproof-auth.onrender.com`):

| Provider | Redirect/Callback URI |
| --- | --- |
| Google | `<BASE_URL>/auth/google/callback` |
| Kakao | `<BASE_URL>/auth/kakao/callback` |
| Naver | `<BASE_URL>/auth/naver/callback` |

- **Google**: [Google Cloud Console](https://console.cloud.google.com/apis/credentials) →
  OAuth 클라이언트(웹 애플리케이션 타입) → **승인된 리디렉션 URI**에 위 주소 등록.
  기존 `mobile/docs/OAUTH_SETUP.md`의 웹용 클라이언트(`EXPO_PUBLIC_GOOGLE_CLIENT_ID`)와는
  별개로, 여기서는 `GOOGLE_CLIENT_SECRET`이 실제로 필요합니다(서버 전용).
- **Kakao**: [Kakao Developers](https://developers.kakao.com) → 해당 앱 →
  "카카오 로그인" → **Redirect URI**에 위 주소를 웹/네이티브용과 별개 항목으로 추가.
- **Naver**: [네이버 개발자센터](https://developers.naver.com/apps) → 해당 앱 →
  "API 설정" → **Callback URL**에 위 주소 추가.

## Expo Go 테스트 순서

1. 위 Render 배포를 완료하고 각 콘솔에 callback URL을 등록합니다.
2. `mobile/frontend/.env`에 `EXPO_PUBLIC_AUTH_API_URL=<BASE_URL>`을 채웁니다.
3. `mobile/frontend`에서 `npm run start` (또는 `npm run web:tunnel`과 동일하게 터널이
   필요하면 `expo start --tunnel`)로 실행하고, iPhone Expo Go 앱으로 QR을
   스캔합니다.
4. 로그인/회원가입 화면에서 소셜 로그인 버튼을 누르면 인앱 브라우저가
   `<BASE_URL>/auth/{provider}/...`로 열립니다. 실제 계정으로 로그인하면
   "로그인 완료" 안내가 뜨고, 앱이 자동으로 로그인을 이어서 처리합니다.

## Work data API (Phase 3A)

근무지·근무예정·출퇴근 기록을 다루는 인증 기반 REST API입니다. 아직 **모바일 앱과
연동되지 않았습니다**. **Preview 환경 검증(Neon Preview DB `0003_work_data`,
live verification 55/55 PASS)에 이어 Production 배포도 완료했습니다**(Neon Production DB
`0003_work_data`, commit `e6bb6a0`, live smoke verification PASS).
스키마는 모바일 로컬 저장 모델(`mobile/frontend/src/types/domain.ts`)의 실제 필드를 기준으로 정했습니다.

### 리소스와 엔드포인트

모든 엔드포인트는 `Authorization: Bearer <access_token>`이 필요합니다(미인증 → 401).
모든 데이터는 토큰의 사용자 소유이며, 요청 본문으로 `user_id`를 받지 않습니다.

| 리소스 | 경로 |
| --- | --- |
| 근무지 | `POST/GET /api/v1/workplaces`, `GET/PATCH/DELETE /api/v1/workplaces/{id}` |
| 근무 예정 | `POST/GET /api/v1/work-schedules`, `GET/PATCH/DELETE /api/v1/work-schedules/{id}` |
| 출퇴근 기록 | `POST/GET /api/v1/attendance-records`, `GET/PATCH/DELETE /api/v1/attendance-records/{id}` |

### 필드 요약

- **workplaces**: `name`(필수, trim 후 빈 문자열 금지), `hourly_wage`(원 단위 정수 ≥ 0),
  `address`, `latitude`/`longitude`(선택, 둘 다 있거나 둘 다 없음).
  - **급여 정책(Phase 3C)**: `pay_day`(매월 며칠, 1~31 정수 — DATE 아님),
    `weekly_allowance`(bool), `five_or_more_employees`(bool),
    `income_deduction_type`(`none`|`withholding`|`insurance`),
    `break_minutes_per_shift`(≥ 0). 근무지당 1:1 정책이라 별도 리소스가 아니라 workplaces
    확장입니다. 전부 NOT NULL + 기본값이 있어 생략하면 기본값이 들어갑니다. PATCH 에서는
    생략=유지이고, 명시적 `null` 은 거부합니다(422).
  - 근로계약서 원본/파일/OCR 텍스트·요약은 기기 로컬 파일 참조라 서버 동기화 대상이
    아닙니다(파일 저장·OCR 은 별도 contracts 단계).
- **work-schedules**: `workplace_id`(본인 활성 근무지), `work_date`(DATE), `start_time`,
  `end_time`(선택), `reminder_minutes`(출근 N분 전 알림, 0=없음).
- **attendance-records**: `workplace_id`, `work_date`, `clock_in`(필수), `clock_out`(선택,
  진행 중 근무), `break_minutes`(≥ 0), `note`, `is_holiday`, 출근/퇴근 GPS 좌표(각 선택).

### 날짜·시간

- `work_date`는 **DATE**(타임존/시각 없음) — 로컬 날짜를 UTC로 변환하지 않습니다.
- `start_time`/`end_time`/`clock_in`/`clock_out`은 `"HH:mm"` 문자열(모바일과 동일).
- **자정 넘김**: 종료 시각이 시작 시각보다 이르면 다음 날 종료로 해석합니다. 별도 종료
  날짜 컬럼을 두지 않으며 서버는 시작/종료 대소를 강제하지 않습니다.
- `created_at`/`updated_at`은 timezone-aware UTC.

### client_id / 멱등성

- 모바일 로컬 ID(`client_id`)는 사용자 범위에서 유일합니다(`unique(user_id, client_id)`).
- 같은 `client_id`로 재요청(오프라인 재전송): 활성 레코드가 있으면 **새로 만들지 않고
  기존 레코드를 200으로** 반환합니다. 이미 **삭제된** `client_id`로 재생성하면 **409**
  (삭제분이 동기화로 부활하는 것을 막습니다). `client_id`가 없으면 매번 새로 생성됩니다.

### 삭제 정책

- 모두 **soft delete**(`deleted_at`) — 목록/조회에서 삭제분은 제외됩니다.
- 근무지를 삭제해도 그 근무지의 근무예정/출퇴근은 **삭제하지 않습니다**(과거 기록 보존).
- 새 근무예정/출퇴근은 **삭제된 근무지를 참조할 수 없습니다**(→ 422).

### GPS 거리 계산

- 출퇴근 응답의 `clock_in_proximity`/`clock_out_proximity`는 저장값이 아니라, 근무지
  좌표와 기록 좌표로 **서버가 하버사인 공식으로 재계산**한 값입니다(`app/core/geo.py`).
  클라이언트가 보낸 거리는 받지도 신뢰하지도 않습니다.
- `{ "distance_m": <미터, 정수>, "verified": <반경 200m 이내 여부> }`. 근무지나 기록에
  좌표가 없으면 `null`입니다. 반경 판정은 반올림 전 실제 거리로 하여 모바일과 일치시킵니다.

### 목록 · 필터 · 페이지네이션

- `limit`(기본 50, 1~200), `offset`(기본 0).
- 근무예정/출퇴근: `workplace_id`, `date_from`, `date_to` 필터. `date_from > date_to` → 422.
- 정렬은 결정적입니다(근무지: 생성 최신순 / 예정·출퇴근: `work_date` 내림차순 + 시각 + id).
- 응답에는 내부 필드(`user_id`, `deleted_at`)를 노출하지 않습니다.

### 오류 코드

| 상황 | 코드 |
| --- | --- |
| 미인증 / 잘못된 토큰 | 401 |
| 본인 소유 아님 · 미존재 · 삭제됨(조회/수정/삭제) | 404 |
| 삭제된 `client_id` 재생성 | 409 |
| 유효성 실패(형식·범위·좌표 짝) · 잘못된 근무지 참조 · `date_from>date_to` | 422 |

### 마이그레이션

- Alembic revision `0003_work_data`(← `0002_auth_tables`). 세 테이블 + FK +
  `unique(user_id, client_id)` + check 제약 + 인덱스를 만듭니다.
- **Neon Preview DB와 Production DB 모두 적용을 마쳤습니다**(revision `0003_work_data`).
  로컬/CI에서 upgrade→downgrade→upgrade 라운드트립을
  검증했습니다(다운그레이드 시 auth 테이블은 보존).
- Alembic revision `0004_workplace_policy`(← `0003_work_data`). workplaces 에 급여 정책
  컬럼 5개를 추가합니다(순수 additive, `batch_alter_table` 로 SQLite/PostgreSQL 양쪽 호환).
  전부 NOT NULL + `server_default` 라 3B 이전에 동기화된 **기존 행도 기본값으로 백필**되어
  데이터 손실이 없습니다. CI 에서 오프라인 SQL·SQLite 백필·다운그레이드를 검증했습니다.
