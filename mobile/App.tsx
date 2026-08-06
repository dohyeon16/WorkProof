import { useEffect, type ReactNode } from 'react';
import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import {
  useFonts,
  NotoSansKR_400Regular,
  NotoSansKR_500Medium,
  NotoSansKR_700Bold,
} from '@expo-google-fonts/noto-sans-kr';
import RootNavigator from './src/app/navigation/RootNavigator';
import { AuthProvider } from './src/features/auth/state/AuthContext';
import { SyncProvider } from './src/features/sync/SyncContext';
import { AppLockGate } from './src/features/security/components/AppLockGate';
import { AlertHost } from './src/shared/components/alert';
import { colors } from './src/shared/theme';
import { resumeNaverRedirectIfPending } from './src/features/auth/services/naverIdentityWeb';
import type { RootStackParamList } from './src/app/navigation/types';

function AppShell({ children }: { children: ReactNode }) {
  const { width } = useWindowDimensions();
  if (Platform.OS !== 'web') return <>{children}</>;
  // Real phone browsers already have a phone-sized viewport, so only show
  // the desktop preview mockup when the browser window is wider than that.
  if (width < 500) return <>{children}</>;
  return (
    <View style={styles.webBackdrop}>
      <View style={styles.phoneFrame}>{children}</View>
    </View>
  );
}

export default function App() {
  const [fontsLoaded] = useFonts({
    NotoSansKR_400Regular,
    NotoSansKR_500Medium,
    NotoSansKR_700Bold,
  });
  const navigationRef = useNavigationContainerRef<RootStackParamList>();

  // 네이버 로그인/회원가입은 전체 페이지 리다이렉트라 앱이 재부팅된다.
  // 돌아왔을 때(정상적인 재로드는 onReady로, 뒤로가기로 인한 bfcache 복원은
  // pageshow로) 대기 중이던 리다이렉트가 있으면 원래 화면으로 결과를 전달한다.
  const resumeNaverRedirect = async () => {
    if (Platform.OS !== 'web') return;
    const resume = await resumeNaverRedirectIfPending();
    const nav = navigationRef.current;
    if (!resume || !nav?.isReady()) return;
    const params = { naverResume: { mode: resume.mode, result: resume.result } };
    if (nav.getCurrentRoute()?.name === resume.screen) {
      nav.setParams(params);
    } else {
      nav.reset({ index: 0, routes: [{ name: resume.screen, params }] });
    }
  };

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onPageShow = (event: Event) => {
      if ((event as { persisted?: boolean }).persisted) resumeNaverRedirect();
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!fontsLoaded) {
    return <View style={styles.loadingGate} />;
  }

  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <AppShell>
        <AuthProvider>
          <SyncProvider>
            <AppLockGate>
              <NavigationContainer ref={navigationRef} onReady={resumeNaverRedirect}>
                <RootNavigator />
              </NavigationContainer>
            </AppLockGate>
          </SyncProvider>
        </AuthProvider>
        <StatusBar style="auto" />
        <AlertHost />
      </AppShell>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loadingGate: { flex: 1, backgroundColor: colors.background },
  webBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#DCEEEA',
    // @ts-expect-error web-only CSS property
    minHeight: '100vh',
  },
  phoneFrame: {
    width: 430,
    height: 900,
    // @ts-expect-error web-only CSS property
    maxHeight: '95vh',
    borderRadius: 40,
    overflow: 'hidden',
    borderWidth: 8,
    borderColor: '#134E4A',
    boxShadow: '0 24px 60px rgba(15, 23, 42, 0.28)',
  },
});
