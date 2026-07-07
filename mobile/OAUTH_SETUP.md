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

EXPO_PUBLIC_NAVER_CLIENT_ID=...
EXPO_PUBLIC_NAVER_CLIENT_SECRET=...  # 네이버는 필수
```

`.env`는 `.gitignore`에 등록돼 있어 커밋되지 않습니다.

## 2. 리다이렉트 URI 확인

앱은 `expo-auth-session`의 `makeRedirectUri({ scheme: 'workproof' })`로 리다이렉트 주소를 만듭니다 (`app.json`에 `"scheme": "workproof"` 등록됨).

- **웹(`npx expo start --web`)**: 실행 중인 origin(예: `http://localhost:8099`)이 자동으로 리다이렉트 URI가 됩니다. 각 콘솔에 이 주소를 등록하세요.
- **네이티브(iOS/Android)**: Expo Go에서는 커스텀 스킴(`workproof://`)이 동작하지 않습니다. `npx expo run:ios` / `npx expo run:android`로 빌드하거나 EAS 개발 빌드를 사용해야 실제 테스트가 가능합니다. 이 경우 리다이렉트 URI는 `workproof://`입니다.

## 3. 플랫폼별 발급 절차

### Google

1. [Google Cloud Console](https://console.cloud.google.com/apis/credentials) → 프로젝트 생성
2. "OAuth 동의 화면" 설정 (테스트 중이면 "테스트 사용자"에 본인 이메일 추가)
3. "사용자 인증 정보 만들기" → **OAuth 클라이언트 ID**
   - 웹 테스트: 애플리케이션 유형 "웹 애플리케이션" → 승인된 리디렉션 URI에 위 2번 주소 등록
   - 네이티브 빌드: 애플리케이션 유형 "iOS"/"Android" (패키지명/번들ID 필요, 이 경우 Secret 불필요)
4. 발급된 클라이언트 ID를 `EXPO_PUBLIC_GOOGLE_CLIENT_ID`에 입력

### Kakao

1. [Kakao Developers](https://developers.kakao.com) → 애플리케이션 추가
2. "카카오 로그인" 활성화, Redirect URI에 위 2번 주소 등록
3. "동의항목"에서 이메일(`account_email`), 닉네임(`profile_nickname`) 동의 설정 — 이메일은 비즈니스 앱 등록/검수가 필요할 수 있습니다 (검수 전에는 이메일이 비어 올 수 있음)
4. "앱 키" 중 **REST API 키**를 `EXPO_PUBLIC_KAKAO_CLIENT_ID`에 입력
5. (선택) 보안 강화를 위해 "Client Secret" 활성화했다면 `EXPO_PUBLIC_KAKAO_CLIENT_SECRET`에도 입력

### Naver

1. [네이버 개발자센터](https://developers.naver.com/apps) → 애플리케이션 등록
2. 사용 API "네이버 로그인" 추가, 서비스 URL/Callback URL에 위 2번 주소 등록
3. 발급된 Client ID/Client Secret을 각각 `EXPO_PUBLIC_NAVER_CLIENT_ID` / `EXPO_PUBLIC_NAVER_CLIENT_SECRET`에 입력 (네이버는 Secret이 필수입니다)

## 4. 동작 방식 (참고)

이 앱은 백엔드 서버가 없는 완전 로컬 저장 구조입니다(`src/storage.ts`, AsyncStorage 기반). 소셜 로그인도 같은 방식을 따릅니다:

1. `src/auth/socialLogin.ts`가 `expo-auth-session`으로 OAuth 인가 코드를 받고 토큰과 교환합니다.
2. 발급받은 액세스 토큰으로 각 플랫폼의 사용자 정보 API를 호출해 이메일/이름을 가져옵니다.
3. 그 정보를 기존 `saveAccount()`로 로컬에 저장하고 로그인 처리합니다.

즉, 자체 백엔드 인증 서버 없이 "각 플랫폼에서 프로필을 받아와 로컬 계정으로 사용"하는 구조입니다. 여러 기기 간 계정 동기화나 서버 측 세션 검증이 필요해지면 별도 백엔드 연동이 추가로 필요합니다.
