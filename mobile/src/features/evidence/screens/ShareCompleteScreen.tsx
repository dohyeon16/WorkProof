import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../../../shared/components/Text';
import { Confetti } from '../../../shared/components/Confetti';
import { Ionicons } from '@expo/vector-icons';
import type { RootScreenProps } from '../../../app/navigation/types';
import { colors, radius, shadow, spacing } from '../../../shared/theme';

type Props = RootScreenProps<'ShareComplete'>;

export default function ShareCompleteScreen({ navigation, route }: Props) {
  const isSave = route.params.intent === 'save';
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.lg }]}>
      <View style={styles.celebrationWrap}>
        <Confetti size={220} />
        <View style={styles.iconCircle}>
          <Ionicons name="checkmark" size={48} color="#fff" />
        </View>
      </View>
      <Text style={styles.title}>{isSave ? 'PDF 저장이 완료되었어요!' : '공유가 완료되었어요!'}</Text>
      <Text style={styles.subtitle}>
        {route.params.note ??
          (isSave
            ? 'PDF 리포트가 증빙 보관함에 저장됐어요.'
            : 'PDF 리포트를 저장하고 원하는 방법으로 공유했어요.')}
      </Text>

      <View style={styles.spacer} />

      <Pressable
        style={styles.button}
        onPress={() => navigation.reset({ index: 0, routes: [{ name: 'Main' }] })}
        accessibilityRole="button"
        accessibilityLabel="홈으로 이동"
      >
        <Text style={styles.buttonText}>홈으로 이동</Text>
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
  celebrationWrap: {
    width: 220,
    height: 140,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  iconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.raised,
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
});
