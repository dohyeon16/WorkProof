import type { ReactNode } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  useFonts,
  NotoSansKR_400Regular,
  NotoSansKR_500Medium,
  NotoSansKR_700Bold,
} from '@expo-google-fonts/noto-sans-kr';
import RootNavigator from './src/navigation/RootNavigator';
import { AlertHost } from './src/alert';
import { colors } from './src/theme';

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

  if (!fontsLoaded) {
    return <View style={styles.loadingGate} />;
  }

  return (
    <SafeAreaProvider>
      <AppShell>
        <NavigationContainer>
          <RootNavigator />
        </NavigationContainer>
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
