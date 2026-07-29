import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../../../shared/components/Text';
import { Ionicons } from '@expo/vector-icons';
import type { RootScreenProps } from '../../../app/navigation/types';
import { colors, radius, shadow, spacing } from '../../../shared/theme';

type Props = RootScreenProps<'OnboardingIntro'>;

const FEATURES = [
  '근무 시간 자동 기록',
  '예상 급여 계산 및 비교',
  '차액 원인 항목 안내',
  '증빙 자료 관리 & 리포트',
];

export default function OnboardingIntroScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.lg }]}>
      <View style={styles.illustrationWrap}>
        <View style={styles.blob} />
        <Ionicons name="leaf-outline" size={22} color={colors.primary} style={styles.leafLeft} />
        <Ionicons name="leaf-outline" size={18} color={colors.primary} style={styles.leafRight} />

        <View style={styles.iconCard}>
          <Ionicons name="clipboard-outline" size={52} color={colors.primary} />
          <View style={styles.badge}>
            <Ionicons name="add" size={16} color="#fff" />
          </View>
        </View>

        <View style={styles.floatTop}>
          <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
        </View>
        <View style={styles.floatBottom}>
          <Ionicons name="document-text" size={18} color={colors.primaryDark} />
        </View>
      </View>

      <Text style={styles.title}>WorkProof란?</Text>
      <Text style={styles.subtitle}>근무와 급여, 증빙까지 한 번에.</Text>

      <View style={styles.list}>
        {FEATURES.map((f) => (
          <View key={f} style={styles.listRow}>
            <Ionicons name="checkmark-circle" size={18} color={colors.primary} />
            <Text style={styles.listText}>{f}</Text>
          </View>
        ))}
      </View>

      <View style={styles.spacer} />

      <View style={styles.dots}>
        <View style={[styles.dot, styles.dotActive]} />
        <View style={styles.dot} />
        <View style={styles.dot} />
      </View>

      <Pressable
        style={styles.button}
        onPress={() => navigation.navigate('OnboardingValues')}
        accessibilityRole="button"
        accessibilityLabel="시작하기"
      >
        <Text style={styles.buttonText}>시작하기</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.lg, paddingTop: spacing.xl },
  illustrationWrap: {
    alignSelf: 'center',
    width: 180,
    height: 150,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  blob: {
    position: 'absolute',
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: colors.primaryLight,
    opacity: 0.7,
  },
  leafLeft: { position: 'absolute', left: 4, bottom: 18, opacity: 0.7, transform: [{ rotate: '-20deg' }] },
  leafRight: { position: 'absolute', right: 8, top: 8, opacity: 0.7, transform: [{ rotate: '25deg' }] },
  iconCard: {
    width: 96,
    height: 96,
    borderRadius: radius.xl,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.raised,
  },
  badge: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    backgroundColor: colors.primary,
    borderRadius: 999,
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.background,
  },
  floatTop: {
    position: 'absolute',
    top: 4,
    right: 24,
    backgroundColor: colors.card,
    borderRadius: 999,
    padding: 6,
    ...shadow.card,
  },
  floatBottom: {
    position: 'absolute',
    bottom: 8,
    left: 16,
    backgroundColor: colors.card,
    borderRadius: 999,
    padding: 6,
    ...shadow.card,
  },
  title: { fontSize: 22, fontWeight: '800', color: colors.text, textAlign: 'center' },
  subtitle: { fontSize: 14, color: colors.subtext, textAlign: 'center', marginTop: spacing.xs },
  list: { marginTop: spacing.xl, gap: spacing.sm + 2 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  listText: { fontSize: 14, color: colors.text },
  spacer: { flex: 1 },
  dots: { flexDirection: 'row', alignSelf: 'center', gap: 6, marginBottom: spacing.lg },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.border },
  dotActive: { backgroundColor: colors.primary, width: 18 },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 6,
    alignItems: 'center',
    ...shadow.card,
  },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
