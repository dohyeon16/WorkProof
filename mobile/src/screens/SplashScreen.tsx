import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../shared/components/Text';
import { Ionicons } from '@expo/vector-icons';
import type { RootScreenProps } from '../app/navigation/types';
import { isLoggedIn, isOnboardingDone } from '../core/data/storage';
import { colors, radius, shadow, spacing } from '../shared/theme';

type Props = RootScreenProps<'Splash'>;

export default function SplashScreen({ navigation }: Props) {
  useEffect(() => {
    const timer = setTimeout(async () => {
      const loggedIn = await isLoggedIn();
      if (!loggedIn) {
        navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
        return;
      }
      const onboardingDone = await isOnboardingDone();
      navigation.reset({
        index: 0,
        routes: [{ name: onboardingDone ? 'Main' : 'OnboardingIntro' }],
      });
    }, 900);
    return () => clearTimeout(timer);
  }, [navigation]);

  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.blob} />
      <View style={styles.logoCircle}>
        <Ionicons name="checkmark-done" size={40} color="#fff" />
      </View>
      <Text style={styles.title}>WorkProof</Text>
      <Text style={styles.subtitle}>내 근로 기록,{'\n'}확실한 증빙</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  blob: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: colors.primaryLight,
    opacity: 0.6,
  },
  logoCircle: {
    width: 84,
    height: 84,
    borderRadius: radius.xl,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.raised,
  },
  title: { fontSize: 28, fontWeight: '800', color: colors.primaryDark, marginTop: spacing.sm },
  subtitle: { fontSize: 14, color: colors.subtext, textAlign: 'center', lineHeight: 20 },
});
