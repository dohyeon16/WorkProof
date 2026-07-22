import type { ExpoConfig } from 'expo/config';

// app.json couldn't stay static JSON once the Kakao/Naver native login config
// plugins needed build-time values (kakaoAppKey) — those only exist in `.env`,
// and only a JS/TS config file can read `process.env` while Expo resolves the
// config (Expo CLI loads `.env` into process.env before evaluating this file,
// same as it does for the app bundle's EXPO_PUBLIC_* vars).
const config: ExpoConfig = {
  name: 'WorkProof',
  slug: 'mobile',
  scheme: 'workproof',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  // 시스템 라이트/다크 설정을 따르도록 automatic. theme/semantic.ts가 시작 시 팔레트를 고른다.
  userInterfaceStyle: 'automatic',
  ios: {
    supportsTablet: true,
    // Required for the "iOS" (bundle-id-scoped) OAuth client types that
    // Google/Kakao/Naver each need for native login on iOS — see the Google/
    // Kakao/Naver sections in mobile/OAUTH_SETUP.md. Matches android.package
    // below so the same value can be registered across all three consoles.
    bundleIdentifier: 'com.workproof.app',
  },
  android: {
    package: 'com.workproof.app',
    adaptiveIcon: {
      backgroundColor: '#0D9488',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    permissions: [
      'android.permission.RECORD_AUDIO',
      'android.permission.ACCESS_COARSE_LOCATION',
      'android.permission.ACCESS_FINE_LOCATION',
    ],
  },
  web: {
    favicon: './assets/favicon.png',
  },
  plugins: [
    'expo-dev-client',
    'expo-notifications',
    'expo-image-picker',
    'expo-document-picker',
    'expo-font',
    'expo-web-browser',
    [
      'expo-location',
      {
        locationWhenInUsePermission: '근무지 위치를 등록하기 위해 현재 위치를 사용합니다.',
      },
    ],
    [
      'expo-build-properties',
      {
        android: {
          // Kakao's Android SDK artifacts aren't on Maven Central/Google's
          // repo — the Kakao-hosted repo below is required for the native
          // build to resolve them. See OAUTH_SETUP.md.
          extraMavenRepos: ['https://devrepo.kakao.com/nexus/content/groups/public/'],
        },
      },
    ],
    [
      '@react-native-seoul/kakao-login',
      {
        // Native App Key (Android), distinct from the REST API key used by
        // the web/iOS AuthSession flow — see mobile/OAUTH_SETUP.md. Empty at
        // prebuild time just means the native module has no key baked in;
        // src/auth/kakaoNative.ts surfaces that as a specific "설정 필요"
        // reason rather than crashing.
        kakaoAppKey: process.env.EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY ?? '',
        // Without this, the plugin force-writes android.kotlinVersion=1.5.10
        // into gradle.properties (its hardcoded default), which is below the
        // minimum Kotlin version this Expo SDK/RN pairing requires (2.1.20)
        // and fails the `expo-root-project` Gradle plugin during root
        // project evaluation.
        kotlinVersion: '2.1.20',
      },
    ],
    [
      '@react-native-seoul/naver-login',
      {
        urlScheme: 'workproof',
      },
    ],
  ],
  extra: {
    eas: {
      projectId: '29888dc2-5c61-4019-b39d-c215f3a0a6c1',
    },
  },
  owner: 'kdhun',
};

export default config;
