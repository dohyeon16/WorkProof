# 소셜 로그인(Google/Kakao/Naver) 연동 설정

로그인 화면의 세 버튼은 실제 OAuth 코드(`src/auth/`)로 동작합니다. 다만 각 플랫폼 개발자 콘솔에서 발급받은 **Client ID(및 필요 시 Secret)**가 없으면 "준비 중" 안내만 뜹니다. 아래 값을 채우면 바로 동작합니다.

## 1. 환경 변수 설정

```bash
cp .env.example .env
```

`.env`에 발급받은 값을 채워 넣으세요. 비워둔 provider는 자동으로 건너뛰고 안내 메시지만 표시됩니다.

```
EXPO_PUBLIC_GOOGLE_CLIENT_ID=...

EXPO_PUBLIC_KAKAO_CLIENT_ID=...      # REST API 키
EXPO_PUBLIC_KAKAO_CLIENT_SECRET=...  # 카카오 콘솔에서 "Client Secret" 사용 설정한 경우만

EXPO_PUBLIC_NAVER_CLIENT_ID=...  # 웹 전용, Client Secret 불필요
```

`.env`는 `.gitignore`에 등록돼 있어 커밋되지 않습니다.

## 2. 리다이렉트 URI 확인

앱은 `expo-auth-session`의 `makeRedirectUri({ scheme: 'workproof' })`로 리다이렉트 주소를 만듭니다 (`app.json`에 `"scheme": "workproof"` 등록됨).

- **웹(`npm run web`)**: `package.json`에서 포트를 `8081`로 고정해뒀습니다 (`expo start --web --port 8081`). 즉 origin은 항상 `http://localhost:8081`이며, 각 콘솔에는 이 주소만 등록하면 됩니다.
  - 만약 터미널에 "Port 8081 is running this app in another window. Use port XXXX instead?" 같은 프롬프트가 뜨면 **절대 다른 포트로 넘어가지 마세요.** 그대로 진행하면 origin이 바뀌어서 콘솔에 등록한 주소와 달라지고 OAuth가 전부 에러 납니다. 대신 아래 명령으로 8081을 점유 중인 프로세스를 찾아 종료한 뒤 다시 실행하세요.
    ```powershell
    netstat -ano | findstr :8081
    taskkill /PID <위에서 나온 PID> /F
    ```
- **휴대폰 브라우저로 테스트**: `localhost:8081`은 휴대폰에서 못 엽니다. `npm run web:tunnel` (`expo start --web --tunnel`)로 실행하면 `https://xxxx.exp.direct` 같은 공개 https 주소가 생기고, 이 주소를 휴대폰 브라우저에서 그대로 열면 됩니다 (Expo Go 앱 필요 없음).
  - Google 로그인(GIS)은 `localhost` 또는 **https**가 아니면 아예 동작하지 않아서, 휴대폰 테스트에는 반드시 이 tunnel 방식(또는 다른 https 방식)이 필요합니다. LAN IP(`http://192.168.x.x:8081`)로는 Google 로그인이 안 됩니다.
  - **주의**: 이 tunnel 주소는 매번 껐다 켤 때마다 랜덤하게 바뀝니다. 즉, 재실행할 때마다 Google Cloud Console의 승인된 자바스크립트 원본과 Kakao Developers의 Redirect URI를 새 주소로 다시 등록해야 합니다. 등록 안 하면 다시 "8081/8082" 때와 같은 origin 불일치 에러가 납니다.
- **네이티브(iOS/Android)**: Expo Go에서는 커스텀 스킴(`workproof://`)이 동작하지 않습니다. `npx expo run:ios` / `npx expo run:android`로 빌드하거나 EAS 개발 빌드를 사용해야 실제 테스트가 가능합니다. 이 경우 리다이렉트 URI는 `workproof://`입니다.

## 3. 플랫폼별 발급 절차

### Google

1. [Google Cloud Console](https://console.cloud.google.com/apis/credentials) → 프로젝트 생성
2. "OAuth 동의 화면" 설정 (테스트 중이면 "테스트 사용자"에 본인 이메일 추가)
3. "사용자 인증 정보 만들기" → **OAuth 클라이언트 ID** → 애플리케이션 유형 "웹 애플리케이션" → **승인된 자바스크립트 원본**에 위 2번 주소 등록 (`http://localhost:8081`처럼 리디렉션 URI가 아니라 origin만 등록)
4. 발급된 클라이언트 ID를 `EXPO_PUBLIC_GOOGLE_CLIENT_ID`에 입력 (Client Secret은 사용하지 않음)
5. 웹에서는 Client Secret 없이 [Google Identity Services](https://developers.google.com/identity/gsi/web)의 **ID Token(Credential) 방식**으로 로그인합니다 (`src/auth/googleIdentityWeb.ts`). Authorization Code 교환이 아니라 브라우저에서 직접 서명된 ID Token(JWT)을 받아 그 안의 `sub`/`email`/`name` 클레임을 사용하므로 서버나 Secret이 필요 없습니다.
6. 네이티브 빌드(iOS/Android)에서는 기존처럼 `expo-auth-session`의 PKCE 플로우를 사용합니다. 이 경우 Google Cloud Console에서 별도로 "iOS"/"Android" 유형 클라이언트를 만들어야 하며(패키지명/번들ID 필요), 이 유형들은 public client라 Secret이 없습니다.

### Kakao

1. [Kakao Developers](https://developers.kakao.com) → 애플리케이션 추가
2. "카카오 로그인" 활성화, Redirect URI에 위 2번 주소 등록
3. "동의항목"에서 닉네임(`profile_nickname`)을 "사용함"으로 설정. 이메일(`account_email`)은 앱이 요청하지 않습니다 — 비즈니스 앱 검수 없이는 활성화가 안 되는 경우가 많아, 코드에서 아예 요청하지 않고 이메일 없이 로그인/가입이 완료되도록 처리했습니다.
4. "앱 키" 중 **REST API 키**를 `EXPO_PUBLIC_KAKAO_CLIENT_ID`에 입력
5. (선택) 보안 강화를 위해 "Client Secret" 활성화했다면 `EXPO_PUBLIC_KAKAO_CLIENT_SECRET`에도 입력

### Naver

**현재 웹(Expo Web)에서만 지원합니다.** 네이티브(iOS/Android) 빌드에서는 "준비 중" 안내만 뜹니다.

1. [네이버 개발자센터](https://developers.naver.com/apps) → 애플리케이션 등록
2. 사용 API "네이버 로그인" 추가, 서비스 URL/Callback URL에 위 2번 주소 등록
3. 발급된 **Client ID**만 `EXPO_PUBLIC_NAVER_CLIENT_ID`에 입력 (Client Secret은 만들 필요도, 입력할 필요도 없음)
4. 웹에서는 [네이버 아이디로 로그인 JavaScript SDK](https://developers.naver.com/docs/login/javascript-sdk/javascript-sdk.md)를 사용합니다 (`src/auth/naverIdentityWeb.ts`). 브라우저가 직접 네이버로부터 access token을 받아오는 client-side 방식이라 Client Secret이나 서버가 필요 없습니다. 대신 서버 측 authorization-code 교환(Client Secret 필수)을 쓰는 기존 방식은 native 빌드에서만 의미가 있는데, 아직 구현하지 않았습니다.

## 4. 동작 방식 (참고)

이 앱은 백엔드 서버가 없는 완전 로컬 저장 구조입니다(`src/storage.ts`, AsyncStorage 기반). 소셜 로그인도 같은 방식을 따릅니다:

1. `src/auth/socialLogin.ts`가 `expo-auth-session`으로 OAuth 인가 코드를 받고 토큰과 교환합니다.
2. 발급받은 액세스 토큰으로 각 플랫폼의 사용자 정보 API를 호출해 이메일/이름을 가져옵니다.
3. 그 정보를 기존 `saveAccount()`로 로컬에 저장하고 로그인 처리합니다.

즉, 자체 백엔드 인증 서버 없이 "각 플랫폼에서 프로필을 받아와 로컬 계정으로 사용"하는 구조입니다. 여러 기기 간 계정 동기화나 서버 측 세션 검증이 필요해지면 별도 백엔드 연동이 추가로 필요합니다.
