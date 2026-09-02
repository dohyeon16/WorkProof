import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../../../shared/components/Text';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import type { RootScreenProps } from '../../../app/navigation/types';
import { colors, radius, shadow, spacing } from '../../../shared/theme';

type Props = RootScreenProps<'OnboardingValues'>;

type IconSpec =
  | { set: 'ion'; name: keyof typeof Ionicons.glyphMap }
  | { set: 'mci'; name: keyof typeof MaterialCommunityIcons.glyphMap };

const VALUES: { icon: IconSpec; title: string; desc: string; tag?: string }[] = [
  { icon: { set: 'ion', name: 'time-outline' }, title: '정확한 기록', desc: '출퇴근 시간을 자동으로 기록해요.' },
  {
    icon: { set: 'mci', name: 'scale-balance' },
    title: '공정한 비교',
    desc: '예상 급여와 실제 입금액의 차이를 한눈에 확인해요.',
  },
  {
    icon: { set: 'ion', name: 'search-outline' },
    title: '핵심 원인 점검',
    desc: '차액의 원인이 되는 항목을 단계별로 알려드려요.',
  },
  {
    icon: { set: 'ion', name: 'document-text-outline' },
    title: '간편한 리포트',
    desc: '필요한 증빙을 모아 PDF 리포트로 정리해요.',
    tag: 'PDF',
  },
];

function ValueIcon({ icon }: { icon: IconSpec }) {
  if (icon.set === 'mci') {
    return <MaterialCommunityIcons name={icon.name} size={20} color={colors.primaryDark} />;
  }
  return <Ionicons name={icon.name} size={20} color={colors.primaryDark} />;
}

export default function OnboardingValuesScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.lg }]}>
      <View style={styles.logoRow}>
        <View style={styles.logoBadge}>
          <Ionicons name="checkmark-done" size={16} color="#fff" />
        </View>
        <Text style={styles.logo}>WorkProof</Text>
      </View>
      <Text style={styles.title}>WorkProof의 핵심 가치</Text>

      <View style={styles.list}>
        {VALUES.map((v) => (
          <View key={v.title} style={styles.card}>
            <View style={styles.iconCircle}>
              <ValueIcon icon={v.icon} />
            </View>
            <View style={{ flex: 1 }}>
              <View style={styles.cardTitleRow}>
                <Text style={styles.cardTitle}>{v.title}</Text>
                {v.tag && (
                  <View style={styles.tag}>
                    <Text style={styles.tagText}>{v.tag}</Text>
                  </View>
                )}
              </View>
              <Text style={styles.cardDesc}>{v.desc}</Text>
            </View>
          </View>
        ))}
      </View>

      <View style={styles.spacer} />

      <View style={styles.dots}>
        <View style={styles.dot} />
        <View style={[styles.dot, styles.dotActive]} />
        <View style={styles.dot} />
      </View>

      <Pressable
        style={styles.button}
        onPress={() => navigation.navigate('NotifPermission')}
        accessibilityRole="button"
        accessibilityLabel="다음"
      >
        <Text style={styles.buttonText}>다음</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.lg, paddingTop: spacing.xl },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'center',
    marginBottom: spacing.lg,
  },
  logoBadge: {
    width: 24,
    height: 24,
    borderRadius: 7,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: { fontSize: 17, fontWeight: '800', color: colors.primaryDark },
  title: { fontSize: 20, fontWeight: '800', color: colors.text, marginBottom: spacing.lg, textAlign: 'center' },
  list: { gap: spacing.sm + 4 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 4,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm + 4,
    ...shadow.card,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  cardTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  cardDesc: { fontSize: 12, color: colors.subtext, marginTop: 2 },
  tag: {
    backgroundColor: colors.accentLight,
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  tagText: { fontSize: 10, fontWeight: '800', color: colors.accent },
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
