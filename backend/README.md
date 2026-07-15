# WorkProof Auth Bridge (Expo Go 전용)

`mobile/`을 Expo Go(무료 Apple Developer 계정, 커스텀 URL 스킴/네이티브 SDK 없이)로
실행할 때만 쓰는 FastAPI 서버입니다. Expo Go는 `workproof://` 커스텀 스킴과
Kakao/Naver 네이티브 모듈을 쓸 수 없어서, 이 서버가 대신 OAuth authorization
code 교환을 서버 사이드에서 처리하고, 앱은 짧은 polling으로 결과를 받아갑니다.

- **web / Android·iOS Development Build**: 이 서버를 쓰지 않습니다. 기존
  방식(웹 OAuth, 네이티브 SDK) 그대로 동작합니다 — `mobile/OAUTH_SETUP.md` 참고.
- **iOS/Android Expo Go**: 이 서버가 필요합니다.

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
cd backend
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
2. **Root Directory**: `backend` (반드시 지정 — 지정하지 않으면 Render가
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
   `mobile/.env`의 `EXPO_PUBLIC_AUTH_API_URL`에 입력합니다.

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
  기존 `mobile/OAUTH_SETUP.md`의 웹용 클라이언트(`EXPO_PUBLIC_GOOGLE_CLIENT_ID`)와는
  별개로, 여기서는 `GOOGLE_CLIENT_SECRET`이 실제로 필요합니다(서버 전용).
- **Kakao**: [Kakao Developers](https://developers.kakao.com) → 해당 앱 →
  "카카오 로그인" → **Redirect URI**에 위 주소를 웹/네이티브용과 별개 항목으로 추가.
- **Naver**: [네이버 개발자센터](https://developers.naver.com/apps) → 해당 앱 →
  "API 설정" → **Callback URL**에 위 주소 추가.

## Expo Go 테스트 순서

1. 위 Render 배포를 완료하고 각 콘솔에 callback URL을 등록합니다.
2. `mobile/.env`에 `EXPO_PUBLIC_AUTH_API_URL=<BASE_URL>`을 채웁니다.
3. `mobile`에서 `npm run start` (또는 `npm run web:tunnel`과 동일하게 터널이
   필요하면 `expo start --tunnel`)로 실행하고, iPhone Expo Go 앱으로 QR을
   스캔합니다.
4. 로그인/회원가입 화면에서 소셜 로그인 버튼을 누르면 인앱 브라우저가
   `<BASE_URL>/auth/{provider}/...`로 열립니다. 실제 계정으로 로그인하면
   "로그인 완료" 안내가 뜨고, 앱이 자동으로 로그인을 이어서 처리합니다.
