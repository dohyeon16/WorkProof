import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../components/Text';
import { Ionicons } from '@expo/vector-icons';
import type { RootScreenProps } from '../navigation/types';
import { colors, radius, shadow, spacing } from '../theme';

type Props = RootScreenProps<'WorkplacePrompt'>;

export default function WorkplacePromptScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.lg }]}>
      <View style={styles.illustrationWrap}>
        <View style={styles.mapCard}>
          <Ionicons name="map-outline" size={64} color={colors.primaryLight} />
          <Ionicons name="sparkles" size={14} color={colors.accent} style={styles.sparkle1} />
          <Ionicons name="sparkles" size={10} color={colors.primary} style={styles.sparkle2} />
        </View>
        <View style={styles.pinBadge}>
          <Ionicons name="location" size={28} color="#fff" />
        </View>
      </View>

      <Text style={styles.title}>근무지를 등록해볼까요?</Text>
      <Text style={styles.subtitle}>
        근무지를 등록하면 기록과{'\n'}급여 비교가 더 정확해져요.
      </Text>

      <View style={styles.spacer} />

      <Pressable
        style={styles.button}
        onPress={() => navigation.navigate('WorkplaceForm', { fromOnboarding: true })}
        accessibilityRole="button"
        accessibilityLabel="근무지 등록하기"
      >
        <Text style={styles.buttonText}>근무지 등록하기</Text>
      </Pressable>
      <Pressable
        style={styles.skipButton}
        onPress={() => navigation.reset({ index: 0, routes: [{ name: 'Main' }] })}
        accessibilityRole="button"
        accessibilityLabel="나중에 할게요"
      >
        <Text style={styles.skipButtonText}>나중에 할게요</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.lg,
    paddingTop: spacing.xl * 2,
    alignItems: 'center',
  },
  illustrationWrap: {
    width: 160,
    height: 140,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  mapCard: {
    width: 140,
    height: 110,
    borderRadius: radius.xl,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.raised,
  },
  sparkle1: { position: 'absolute', top: 10, right: 16 },
  sparkle2: { position: 'absolute', bottom: 14, left: 14 },
  pinBadge: {
    position: 'absolute',
    bottom: -8,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: colors.background,
    ...shadow.card,
  },
  title: { fontSize: 20, fontWeight: '800', color: colors.text, textAlign: 'center' },
  subtitle: {
    fontSize: 14,
    color: colors.subtext,
    textAlign: 'center',
    marginTop: spacing.sm,
    lineHeight: 20,
  },
  spacer: { flex: 1 },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 6,
    alignItems: 'center',
    width: '100%',
    ...shadow.card,
  },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  skipButton: { marginTop: spacing.md, alignItems: 'center' },
  skipButtonText: { color: colors.subtext, fontSize: 13 },
});
