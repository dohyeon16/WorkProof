import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../../../ui/components/display/Text';
import { Confetti } from '../../../ui/components/feedback/Confetti';
import { Ionicons } from '@expo/vector-icons';
import type { RootScreenProps } from '../../../app/navigation/types';
import { getWorkplace, setOnboardingDone } from '../../../services/storage/storage';
import { colors, radius, shadow, spacing } from '../../../ui/design_system';

type Props = RootScreenProps<'WorkplaceRegistered'>;

export default function WorkplaceRegisteredScreen({ navigation, route }: Props) {
  const [name, setName] = useState('');

  useEffect(() => {
    getWorkplace(route.params.id).then((w) => setName(w?.name ?? ''));
  }, [route.params.id]);

  const handleConfirm = async () => {
    await setOnboardingDone();
    navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
  };

  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.lg }]}>
      <View style={styles.celebrationWrap}>
        <Confetti size={220} />
        <View style={styles.iconCircle}>
          <Ionicons name="checkmark" size={48} color="#fff" />
        </View>
      </View>
      <Text style={styles.title}>{name} 등록 완료</Text>
      <Text style={styles.subtitle}>
        근무지 등록이 완료되었어요.{'\n'}이제 근무 기록을 시작해볼까요?
      </Text>

      <View style={styles.spacer} />

      <Pressable
        style={styles.button}
        onPress={handleConfirm}
        accessibilityRole="button"
        accessibilityLabel="확인"
      >
        <Text style={styles.buttonText}>확인</Text>
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
