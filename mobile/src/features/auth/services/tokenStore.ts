// refresh 토큰 저장소. 네이티브(iOS Keychain / Android Keystore)에는 expo-secure-store,
// 웹에는 SecureStore가 없으므로 메모리 폴백을 쓴다.
//
// 정책(보안):
//  - refresh 토큰은 SecureStore에만 저장한다. AsyncStorage(평문)에 저장하지 않는다.
//  - access 토큰은 저장하지 않는다(session 계층의 메모리에만 존재).
//  - 토큰 전체 값을 절대 로그로 남기지 않는다.
//  - 웹은 안전 저장소가 없어 세션을 메모리에만 유지한다(새로고침 시 재로그인).
//    웹은 이 앱에서 개발 프리뷰 용도이며, 실제 배포 타깃은 네이티브다.
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import type { RefreshTokenStore } from '../types';

const REFRESH_TOKEN_KEY = 'workproof.auth.refreshToken';

// 웹 전용 메모리 폴백(영속성 없음). AsyncStorage/localStorage 평문 저장을 피한다.
let webMemoryToken: string | null = null;
const isWeb = Platform.OS === 'web';

export const refreshTokenStore: RefreshTokenStore = {
  async get(): Promise<string | null> {
    if (isWeb) return webMemoryToken;
    return (await SecureStore.getItemAsync(REFRESH_TOKEN_KEY)) ?? null;
  },
  async set(token: string): Promise<void> {
    if (isWeb) {
      webMemoryToken = token;
      return;
    }
    await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED,
    });
  },
  async clear(): Promise<void> {
    if (isWeb) {
      webMemoryToken = null;
      return;
    }
    await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
  },
};
