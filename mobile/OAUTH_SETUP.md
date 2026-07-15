# 소셜 로그인(Google/Kakao/Naver) 연동 설정

로그인 화면의 세 버튼은 실제 OAuth 코드(`src/auth/`)로 동작합니다. 다만 각 플랫폼 개발자 콘솔에서 발급받은 **Client ID(및 필요 시 Secret)**가 없으면 "준비 중" 안내만 뜹니다. 아래 값을 채우면 바로 동작합니다.

## 1. 환경 변수 설정

```bash
cp .env.example .env
```

`.env`에 발급받은 값을 채워 넣으세요. 비워둔 provider는 자동으로 건너뛰고 안내 메시지만 표시됩니다.

```
EXPO_PUBLIC_GOOGLE_CLIENT_ID=...
EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=...  # Android 네이티브 전용, 아래 Google 섹션 참고
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=...      # iOS 네이티브 전용, 아래 Google 섹션 참고

EXPO_PUBLIC_KAKAO_CLIENT_ID=...        # REST API 키 (웹 전용)
EXPO_PUBLIC_KAKAO_CLIENT_SECRET=...    # 카카오 콘솔에서 "Client Secret" 사용 설정한 경우만
EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY=...   # iOS/Android 네이티브 전용, REST API 키와 다른 값 — 아래 Kakao 섹션 참고

EXPO_PUBLIC_NAVER_CLIENT_ID=...      # 웹은 Client Secret 불필요, iOS/Android 네이티브는 아래 SECRET도 필요
EXPO_PUBLIC_NAVER_CLIENT_SECRET=...  # iOS/Android 네이티브 전용 — 앱 바이너리에 임베딩됨, 아래 Naver 섹션의 트레이드오프 설명 참고
```

`.env`는 `.gitignore`에 등록돼 있어 커밋되지 않습니다.

**참고**: Kakao/Naver 네이티브 로그인 모듈이 빌드타임에 `.env` 값을 읽어 Android 네이티브
프로젝트(AndroidManifest/strings.xml)에 심어야 해서, 설정 파일이 `app.json`(정적 JSON)이 아니라
`app.config.ts`(코드)로 되어 있습니다. `app.config.ts`의 `plugins` 배열 안에서
`process.env.EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY` 등을 직접 읽습니다 — Expo CLI가 `.env`를 먼저
로드한 뒤 이 파일을 평가하기 때문에 EXPO_PUBLIC_* 변수와 동일하게 동작합니다.

## 2. 리다이렉트 URI 확인

앱은 `expo-auth-session`의 `makeRedirectUri({ scheme: 'workproof' })`로 리다이렉트 주소를 만듭니다 (`app.config.ts`에 `scheme: "workproof"` 등록됨).

- **웹(`npm run web`)**: `package.json`에서 포트를 `8081`로 고정해뒀습니다 (`expo start --web --port 8081`). 즉 origin은 항상 `http://localhost:8081`이며, 각 콘솔에는 이 주소만 등록하면 됩니다.
  - 만약 터미널에 "Port 8081 is running this app in another window. Use port XXXX instead?" 같은 프롬프트가 뜨면 **절대 다른 포트로 넘어가지 마세요.** 그대로 진행하면 origin이 바뀌어서 콘솔에 등록한 주소와 달라지고 OAuth가 전부 에러 납니다. 대신 아래 명령으로 8081을 점유 중인 프로세스를 찾아 종료한 뒤 다시 실행하세요.
    ```powershell
    netstat -ano | findstr :8081
    taskkill /PID <위에서 나온 PID> /F
    ```
- **휴대폰 브라우저로 테스트**: `localhost:8081`은 휴대폰에서 못 엽니다. `npm run web:tunnel` (`expo start --web --tunnel`)로 실행하면 `https://xxxx.exp.direct` 같은 공개 https 주소가 생기고, 이 주소를 휴대폰 브라우저에서 그대로 열면 됩니다 (Expo Go 앱 필요 없음).
  - Google 로그인(GIS)은 `localhost` 또는 **https**가 아니면 아예 동작하지 않아서, 휴대폰 테스트에는 반드시 이 tunnel 방식(또는 다른 https 방식)이 필요합니다. LAN IP(`http://192.168.x.x:8081`)로는 Google 로그인이 안 됩니다.
  - **주의**: 이 tunnel 주소는 매번 껐다 켤 때마다 랜덤하게 바뀝니다. 즉, 재실행할 때마다 Google Cloud Console의 승인된 자바스크립트 원본과 Kakao Developers의 Redirect URI를 새 주소로 다시 등록해야 합니다. 등록 안 하면 다시 "8081/8082" 때와 같은 origin 불일치 에러가 납니다.
- **네이티브(iOS/Android)**: Expo Go에서는 커스텀 스킴(`workproof://`)이 동작하지 않습니다. `npx expo run:ios` / `npx expo run:android`로 빌드하거나 EAS 개발 빌드를 사용해야 실제 테스트가 가능합니다. 이 경우 리다이렉트 URI는 `workproof://`입니다(`AuthSession.makeRedirectUri({ scheme: 'workproof' })`가 dev-client/standalone 빌드에서 반환하는 값 — Expo Go에서는 대신 `exp://...` 형태가 나옵니다).
  - 이 리다이렉트 URI는 **Google(모든 플랫폼)과 Kakao/Naver의 웹 플로우**에만 해당합니다. **Kakao/Naver의 iOS·Android 플로우는 브라우저 리다이렉트를 아예 쓰지 않고 네이티브 SDK**(`src/auth/kakaoNative.ts`, `src/auth/naverNative.ts`)로 동작하므로, `workproof://` 리다이렉트 URI 등록이 필요 없는 대신 각 콘솔에 패키지명/Bundle ID + 키 해시(Kakao, Android만) / iOS·Android 플랫폼(Naver) 등록이 필요합니다 — 아래 3절 참고. (Naver 네이티브 SDK는 iOS에서도 `serviceUrlSchemeIOS`로 `workproof` 스킴을 쓰지만, 이건 Naver 앱에서 돌아올 때 OS가 라우팅하는 용도이지 `expo-auth-session`의 리다이렉트 URI 등록과는 무관합니다.)

## 3. 플랫폼별 발급 절차

### Google

1. [Google Cloud Console](https://console.cloud.google.com/apis/credentials) → 프로젝트 생성
2. "OAuth 동의 화면" 설정 (테스트 중이면 "테스트 사용자"에 본인 이메일 추가)
3. "사용자 인증 정보 만들기" → **OAuth 클라이언트 ID** → 애플리케이션 유형 "웹 애플리케이션" → **승인된 자바스크립트 원본**에 위 2번 주소 등록 (`http://localhost:8081`처럼 리디렉션 URI가 아니라 origin만 등록)
4. 발급된 클라이언트 ID를 `EXPO_PUBLIC_GOOGLE_CLIENT_ID`에 입력 (Client Secret은 사용하지 않음)
5. 웹에서는 Client Secret 없이 [Google Identity Services](https://developers.google.com/identity/gsi/web)의 **ID Token(Credential) 방식**으로 로그인합니다 (`src/auth/googleIdentityWeb.ts`). Authorization Code 교환이 아니라 브라우저에서 직접 서명된 ID Token(JWT)을 받아 그 안의 `sub`/`email`/`name` 클레임을 사용하므로 서버나 Secret이 필요 없습니다.
6. **Android 개발 빌드**에서는 `expo-auth-session`의 PKCE 플로우를 씁니다(`src/auth/providers.ts`). 이때는 위 "웹 애플리케이션" 클라이언트를 재사용할 수 없습니다 — Google이 그 타입에는 `http(s)` 리디렉션 URI만 허용하고 `workproof://` 같은 커스텀 스킴은 거부하기 때문입니다. 별도로 **애플리케이션 유형 "Android"** 클라이언트를 새로 만들어야 합니다:
   - **패키지 이름**: `com.workproof.app` (`app.json`의 `android.package`)
   - **SHA-1 인증서 지문**: 개발 빌드를 최소 한 번 만든 뒤에만 얻을 수 있습니다(아래 "SHA-1 확인 방법" 참고) — 로컬 빌드/EAS 빌드/팀원 각자의 머신마다 값이 다르므로, 새로운 환경에서 빌드할 때마다 이 항목에 추가로 등록해야 합니다.
   - 클라이언트 생성 후 **고급 설정(Advanced settings)** 에서 **"Custom URI scheme"(커스텀 URI 스킴)** 를 반드시 활성화하세요. 안 하면 로그인 시 `Error 400: Custom URI scheme is not enabled for your Android client`가 납니다. (Google 콘솔 UI는 자주 바뀌므로 문구가 다르면 "Android"/"맞춤 URI"류 항목을 찾아보세요.)
   - 발급된 클라이언트 ID를 `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID`에 입력. (`EXPO_PUBLIC_GOOGLE_CLIENT_ID`와는 다른 별개의 값입니다.)
   - **SHA-1 확인 방법**:
     - 로컬 빌드(`npx expo run:android`): 최초 빌드 후 생성되는 `android/app/debug.keystore`에 대해 `keytool -list -v -keystore android/app/debug.keystore -alias androiddebugkey -storepass android -keypass android` 실행 → `SHA1:` 라인 복사
     - EAS 개발 빌드: `eas credentials` → Android → 해당 프로필 → Keystore 조회 → SHA-1 확인 (또는 EAS 빌드 로그/대시보드에 표시됨)
7. **iOS 개발 빌드**에서도 마찬가지 이유로 별도 클라이언트가 필요합니다 — "Web application" 클라이언트는 `workproof://` 커스텀 스킴을 거부하기 때문에, iOS에서 그대로 쓰면 `invalid_request`가 납니다. 별도로 **애플리케이션 유형 "iOS"** 클라이언트를 만드세요:
   - **Bundle ID**: `com.workproof.app` (`app.config.ts`의 `ios.bundleIdentifier`)
   - Android의 SHA-1처럼 빌드마다 달라지는 값이 없습니다 — Bundle ID만 일치하면 되므로 로컬/EAS/팀원 환경 구분 없이 한 번만 등록하면 됩니다.
   - 발급된 클라이언트 ID를 `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`에 입력. (`EXPO_PUBLIC_GOOGLE_CLIENT_ID`/`_ANDROID_CLIENT_ID`와는 다른 별개의 값입니다.)
   - iOS 클라이언트는 리디렉션에 `expo-auth-session`이 만드는 `workproof://` 커스텀 스킴을 그대로 쓰며(Android처럼 "Custom URI scheme" 토글이 없고, iOS 클라이언트 유형 자체가 Bundle ID 기반이라 기본 허용됩니다), `src/auth/providers.ts`가 `Platform.OS === 'ios'`일 때 이 클라이언트 ID를 사용하도록 이미 분기돼 있습니다.

### Kakao

1. [Kakao Developers](https://developers.kakao.com) → 애플리케이션 추가
2. "카카오 로그인" 활성화, Redirect URI에 위 2번 주소 등록
3. "동의항목"에서 닉네임(`profile_nickname`)을 "사용함"으로 설정. 이메일(`account_email`)은 앱이 요청하지 않습니다 — 비즈니스 앱 검수 없이는 활성화가 안 되는 경우가 많아, 코드에서 아예 요청하지 않고 이메일 없이 로그인/가입이 완료되도록 처리했습니다.
4. "앱 키" 중 **REST API 키**를 `EXPO_PUBLIC_KAKAO_CLIENT_ID`에 입력
5. (선택) 보안 강화를 위해 "Client Secret" 활성화했다면 `EXPO_PUBLIC_KAKAO_CLIENT_SECRET`에도 입력
6. **웹**: 위 REST API 키(`EXPO_PUBLIC_KAKAO_CLIENT_ID`)로 브라우저 기반 AuthSession/PKCE
   플로우를 그대로 씁니다(`src/auth/socialLogin.ts`). "카카오 로그인" → Redirect URI 목록에
   **`workproof://`** 를 웹 주소와 별개 항목으로 추가 등록하세요. (이 REST API 키 + AuthSession
   플로우를 iOS에서 그대로 쓰면 `KOE006`이 납니다 — Kakao REST API 플로우가 등록되지 않은 iOS
   플랫폼의 커스텀 스킴 리다이렉트를 거부하기 때문입니다. 그래서 iOS는 아래 7번의 네이티브 SDK를
   씁니다.)
7. **iOS/Android 개발 빌드(네이티브 SDK)**: iOS/Android는 브라우저 리다이렉트 대신
   [`@react-native-seoul/kakao-login`](https://github.com/crossplatformkorea/react-native-kakao-login)
   네이티브 SDK를 씁니다(`src/auth/kakaoNative.ts`) — Kakao 앱이 설치돼 있으면 브라우저를 거치지 않고
   카카오톡으로 바로 로그인 화면이 뜹니다. Expo Go에서는 동작하지 않으며, EAS 개발 빌드 또는
   `npx expo run:ios` / `npx expo run:android`로 만든 네이티브 빌드가 반드시 필요합니다.
   - [Kakao Developers](https://developers.kakao.com) → 해당 앱 → "플랫폼" → **Android** 플랫폼 추가:
     패키지명 `com.workproof.app`, 키 해시(아래 방법으로 확인) 등록. 이 등록은 REST API 방식과 달리
     **필수**입니다 — 없으면 네이티브 로그인 자체가 실패합니다.
   - 같은 화면에서 **iOS** 플랫폼도 추가: **Bundle ID** `com.workproof.app` 등록. iOS는 Android의
     키 해시 같은 빌드별 값이 없어 한 번만 등록하면 됩니다.
   - **키 해시 확인 방법** (Android, 디버그 빌드 기준):
     ```powershell
     keytool -exportcert -alias androiddebugkey -keystore android/app/debug.keystore -storepass android | openssl sha1 -binary | openssl base64
     ```
     EAS 개발 빌드의 경우 `eas credentials` → Android → 해당 프로필의 Keystore를 다운로드해서 같은
     명령을 돌리거나, EAS 대시보드에 표시되는 키스토어 정보를 이용합니다.
   - "앱 키" 중 **네이티브 앱 키**(REST API 키와는 다른 값)를 `EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY`에 입력.
     같은 값을 iOS/Android 양쪽에 씁니다. 이 값은 `app.config.ts`의 `@react-native-seoul/kakao-login`
     플러그인 설정을 통해 빌드타임에 두 플랫폼 모두에 심어집니다 — Android는
     AndroidManifest/strings.xml, iOS는 Info.plist의 `KAKAO_APP_KEY` 및 `kakao{NATIVE_APP_KEY}://oauth`
     URL 스킴(`CFBundleURLTypes`)입니다. **값을 바꾸면 네이티브 프로젝트를 다시 생성해야 하므로
     EAS 재빌드가 필요합니다.**
   - Kakao SDK 아티팩트는 Maven Central에 없어서 `expo-build-properties`로 카카오 전용 Maven
     저장소(`https://devrepo.kakao.com/nexus/content/groups/public/`)를 추가로 등록해뒀습니다
     (`app.config.ts` 참고, 별도 설정 불필요, iOS는 CocoaPods라 해당 없음).

### Naver

**웹**은 JS SDK로, **iOS/Android**는 공식 네이티브 SDK([`@react-native-seoul/naver-login`](https://github.com/crossplatformkorea/react-native-naver-login))로 동작합니다(`src/auth/naverNative.ts`, `src/auth/socialLogin.ts`의 `loginWithNaver()`가 플랫폼별로 라우팅).

1. [네이버 개발자센터](https://developers.naver.com/apps) → 애플리케이션 등록
2. 사용 API "네이버 로그인" 추가, 서비스 URL/Callback URL에 위 2번 주소 등록
3. 발급된 **Client ID**를 `EXPO_PUBLIC_NAVER_CLIENT_ID`에 입력
4. 웹에서는 [네이버 아이디로 로그인 JavaScript SDK](https://developers.naver.com/docs/login/javascript-sdk/javascript-sdk.md)를 사용합니다(`src/auth/naverIdentityWeb.ts`). 브라우저가 직접 네이버로부터 access token을 받아오는 client-side 방식이라 Client Secret이나 서버가 필요 없습니다.

**iOS/Android 네이티브 SDK 연동과 보안 트레이드오프 (중요):**

이 프로젝트는 원래 "Secret을 앱/EXPO_PUBLIC 환경변수에 넣지 않는다"는 원칙 때문에 iOS/Android 네이버
로그인을 보류해왔습니다. 네이버 오픈API의 정식 서버 인증 플로우는 토큰 교환 시 `client_id` +
**`client_secret`** + `code`를 함께 보내야 하고, 네이버 공식 [Android SDK](https://github.com/naver/naveridlogin-sdk-android)/[iOS SDK](https://github.com/naver/naveridlogin-sdk-ios)도
`NaverLogin.initialize({ consumerKey, consumerSecret, ... })`처럼 **Client Secret을
앱 코드에 그대로 넣도록** 설계돼 있어서입니다 — 시크릿을 노출하지 않으려면 원래는 토큰 교환을
대신해주는 백엔드(프록시 서버)가 필요합니다.

**이후 이 프로젝트는 그 원칙을 의도적으로 깨고, client secret을 앱 바이너리에 임베딩하는 트레이드오프를
감수하기로 결정했습니다** — 백엔드 없이 지금 바로 iOS/Android 네이버 로그인을 동작시키기 위해서입니다.
이 결정의 의미를 이해하고 있어야 합니다:

- `EXPO_PUBLIC_NAVER_CLIENT_SECRET`은 EAS 빌드 시 `@react-native-seoul/naver-login`의
  `NaverLogin.initialize()` 호출부(`src/auth/naverNative.ts`)를 통해 **네이티브 앱 바이너리 안에 그대로
  포함**됩니다(iOS/Android 둘 다). 앱 바이너리를 디컴파일/분석하면 이 값을 추출할 수 있습니다 —
  Google/Kakao의 REST API 키(공개돼도 안전하도록 설계된 값)와는 성격이 다른, 진짜 시크릿이 노출되는
  것입니다.
- 악용 시나리오는 "제3자가 이 secret + client_id로 자기 서버 인증 코드 교환에 흉내낼 수 있는가"
  정도로 제한적이지만(사용자 비밀번호나 세션 자체가 털리는 건 아님), 원칙적으로는 secret 유출입니다.
- 나중에 백엔드를 두게 되면: (1) 서버에 `NAVER_CLIENT_SECRET`을 서버 전용 환경변수로 옮기고,
  (2) 앱은 `AuthSession`으로 `response_type=code`만 받아 서버의 `/auth/naver/exchange` 같은
  엔드포인트로 code를 전달, (3) 서버가 시크릿으로 토큰 교환 후 프로필을 앱에 반환하는 구조로
  전환해서 이 트레이드오프를 없앨 수 있습니다.

**설정 절차:**

1. [네이버 개발자센터](https://developers.naver.com/apps) → 해당 앱 → "API 설정"에서 **Android** 플랫폼
   추가: 패키지명 `com.workproof.app`, 다운로드 URL(플레이스토어 등록 전이면 아무 값이나 임시 입력
   가능한 경우가 많음 — 콘솔 안내 참고)
2. 같은 화면에서 **iOS** 플랫폼도 추가: **Bundle ID** `com.workproof.app`, **URL Scheme**에
   `workproof` 등록(`src/auth/naverNative.ts`의 `serviceUrlSchemeIOS: 'workproof'`와 반드시 일치해야
   합니다 — `app.config.ts`의 `@react-native-seoul/naver-login` 플러그인 `urlScheme` 값과도 동일).
3. "네이버 로그인" 설정에서 발급된 **Client Secret**을 `EXPO_PUBLIC_NAVER_CLIENT_SECRET`에 입력
   (iOS/Android 공통, `EXPO_PUBLIC_NAVER_CLIENT_ID`도 공통)
4. Expo config plugin(`app.config.ts`의 `@react-native-seoul/naver-login`)이 `urlScheme: "workproof"`로
   iOS/Android 네이티브 프로젝트를 모두 설정합니다 — 이 값을 바꾸면 EAS 재빌드가 필요합니다.
5. `src/auth/naverNative.ts`가 `NaverLogin.initialize()` → `NaverLogin.login()` → `NaverLogin.getProfile()`
   순서로 로그인과 프로필 조회를 모두 처리합니다(별도 REST 호출 불필요, SDK가 감싸줌). iOS에서는
   `initialize()`가 내부적으로 `serviceUrlSchemeIOS`를 함께 전달합니다 — 코드에서 이미 처리돼 있어
   추가 분기가 필요 없습니다.

## 3-1. 근무지 장소 검색 (카카오맵)

근무지 등록 화면에서 실제 업체(카페/식당/편의점/PC방 등)를 검색해 선택하는
기능은 [카카오 로컬 API](https://developers.kakao.com/docs/latest/ko/local/dev-guide)를
씁니다. 다만 카카오 로컬 REST API는 브라우저 CORS를 지원하지 않아 웹에서는
직접 호출이 막히므로, 플랫폼별로 다른 방식을 씁니다(`src/places/`):

- **네이티브(iOS/Android)**: 위 Kakao REST API 키(`EXPO_PUBLIC_KAKAO_CLIENT_ID`)를
  그대로 재사용해 `dapi.kakao.com`을 직접 호출합니다(`src/places/kakaoPlaces.ts`).
  네이티브 앱은 브라우저가 아니라서 CORS 제약이 없습니다. 추가 설정 불필요.
- **웹**: [카카오맵 JavaScript SDK](https://apis.map.kakao.com/web/guide/)를
  스크립트로 불러와 브라우저에서 직접 검색합니다(`src/places/kakaoPlaces.web.ts`).
  1. [Kakao Developers](https://developers.kakao.com) → 해당 앱 → "앱 키"에서
     **JavaScript 키** 복사
  2. "플랫폼" → **Web** 플랫폼 등록에 위 2번 주소(웹 origin) 등록 — 로그인용
     Redirect URI 등록과는 별개의 항목입니다.
  3. 복사한 값을 `EXPO_PUBLIC_KAKAO_JS_KEY`에 입력
  4. tunnel 주소가 바뀌면(재실행 시 랜덤 생성되는 경우) 이 플랫폼 등록도 새
     주소로 다시 해줘야 합니다.

## 3-2. 근로계약서 사본 OCR (Google Cloud Vision)

근무지 등록 화면에서 근로계약서 사본(사진 또는 PDF)을 첨부하면, 첨부와 동시에
[Google Cloud Vision API](https://cloud.google.com/vision/docs/ocr)로 글자를
추출합니다(`src/ocr/visionOcr.ts`). 이미지는 `images:annotate`, PDF는
`files:annotate`(동기 요청 기준 최대 5페이지)를 사용합니다.

1. [Google Cloud Console](https://console.cloud.google.com)에서 프로젝트 생성(또는 기존 프로젝트 사용)
2. "API 및 서비스" → **Cloud Vision API** 사용 설정
3. "사용자 인증 정보" → API 키 만들기. 키를 **Cloud Vision API로 제한**해두는 걸 권장(다른 API에 잘못 쓰이는 것 방지)
4. 발급된 키를 `EXPO_PUBLIC_GOOGLE_VISION_API_KEY`에 입력
5. 월 1,000건까지 무료이며, 첨부한 계약서 이미지는 Google 서버로 전송되어 처리됩니다(개인정보 포함 문서이니 참고)

키가 비어있으면 첨부 자체는 되지만 "OCR 준비 중" 안내만 뜨고 텍스트 추출은
건너뜁니다.

## 3-3. Expo Go 전용 소셜 로그인 (FastAPI OAuth Bridge)

유료 Apple Developer 계정이 없으면 iOS Development Build(`npx expo run:ios`, EAS 개발
빌드)를 만들 수 없어서, 위 3절의 네이티브 SDK 로그인을 iPhone에서 테스트할 방법이
없습니다. Expo Go 앱으로는 실행할 수 있지만, Expo Go는 다음 두 가지가 안 됩니다:

- 커스텀 URL 스킴(`workproof://`) 등록 — 그래서 `expo-auth-session`의 리다이렉트
  기반 플로우(`src/auth/providers.ts`)가 앱으로 돌아오지 못합니다.
- Kakao/Naver 네이티브 SDK 로드 — `@react-native-seoul/kakao-login`,
  `@react-native-seoul/naver-login`은 네이티브 빌드에만 링크되어 있어서 Expo Go에서
  호출하면 즉시 에러가 납니다.

그래서 **Expo Go에서만** 별도의 흐름을 씁니다: 저장소 루트의 `backend/`(FastAPI)가
OAuth authorization code 교환을 서버 사이드에서 대신 처리하고, 앱은
`src/auth/expoGoOAuth.ts`로 로그인 페이지를 인앱 브라우저로 띄운 뒤 결과를
polling으로 받아옵니다. web과 Android/iOS Development Build는 이 흐름을 전혀
타지 않고 기존 방식(웹 OAuth, 네이티브 SDK) 그대로 동작합니다 —
`src/auth/socialLogin.ts`의 `isExpoGo()` 분기가 실행 환경에 따라 자동으로
결정합니다.

**플랫폼별 로그인 방식 정리:**

| 환경 | Google | Kakao | Naver |
| --- | --- | --- | --- |
| web | Google Identity Services (`googleIdentityWeb.ts`) | AuthSession/PKCE | Naver JS SDK |
| Android/iOS Development Build | AuthSession/PKCE(네이티브 클라이언트) | 네이티브 SDK | 네이티브 SDK |
| **Expo Go(iOS/Android)** | **FastAPI 브리지** | **FastAPI 브리지** | **FastAPI 브리지** |

**설정 순서:**

1. `backend/README.md`를 따라 FastAPI 서버를 Render 등에 배포하고, 그 서버
   전용 환경변수(`GOOGLE_CLIENT_SECRET`, `KAKAO_CLIENT_SECRET`,
   `NAVER_CLIENT_SECRET` 등)를 채웁니다. **이 값들은 `mobile/.env`나
   `EXPO_PUBLIC_*`에 절대 넣지 않습니다** — 앱 번들에 노출되면 안 되는 진짜
   시크릿이기 때문입니다. (기존에 `EXPO_PUBLIC_NAVER_CLIENT_SECRET`이 iOS/Android
   네이티브 빌드용으로 앱 바이너리에 포함되는 것과는 별개입니다 — 그건 3절의
   "Naver 설정 절차와 보안 트레이드오프"에서 이미 감수하기로 한 값이고, Expo Go
   브리지는 그 값을 아예 쓰지 않습니다.)
2. 배포된 서버의 base URL(예: `https://workproof-auth.onrender.com`)을 각
   provider 콘솔에 `{base URL}/auth/{provider}/callback` 형식으로 등록합니다
   (`backend/README.md`의 "각 콘솔에 등록할 Callback URL" 참고).
3. `mobile/.env`에 `EXPO_PUBLIC_AUTH_API_URL=<base URL>`을 채웁니다.
4. `npm run start`로 실행하고 iPhone Expo Go 앱으로 QR을 스캔합니다. 로그인/
   회원가입 화면에서 소셜 로그인 버튼을 누르면 인앱 브라우저가 열리고, 실제
   계정으로 로그인하면 앱이 자동으로 로그인을 이어서 처리합니다.

## 4. 동작 방식 (참고)

이 앱은 백엔드 서버가 없는 완전 로컬 저장 구조입니다(`src/storage.ts`, AsyncStorage 기반). 소셜 로그인도 같은 방식을 따릅니다:

1. `src/auth/socialLogin.ts`가 `expo-auth-session`으로 OAuth 인가 코드를 받고 토큰과 교환합니다.
2. 발급받은 액세스 토큰으로 각 플랫폼의 사용자 정보 API를 호출해 이메일/이름을 가져옵니다.
3. 그 정보를 기존 `saveAccount()`로 로컬에 저장하고 로그인 처리합니다.

즉, 자체 백엔드 인증 서버 없이 "각 플랫폼에서 프로필을 받아와 로컬 계정으로 사용"하는 구조입니다. 여러 기기 간 계정 동기화나 서버 측 세션 검증이 필요해지면 별도 백엔드 연동이 추가로 필요합니다.

**예외**: Expo Go에서는 위 3-3절의 FastAPI 브리지가 OAuth 코드 교환을 대신
수행합니다 — 이 경우에도 브리지는 프로필만 앱에 전달하고 provider access
token은 넘기지 않으며, 앱은 그 프로필로 여전히 `saveAccount()`를 통해 로컬에
계정을 저장합니다. 브리지 서버 자체는 로그인 결과를 세션에 최대 10분만
임시 보관하고, 앱이 조회 후 즉시 삭제합니다 — 계정 데이터를 서버에 영구
저장하지 않습니다.
