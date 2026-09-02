import { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../../../shared/components/Text';
import { Alert } from '../../../shared/components/alert';
import { Ionicons } from '@expo/vector-icons';
import type { RootScreenProps } from '../../../app/navigation/types';
import { getWorkplaces } from '../../../core/data/storage';
import { rescheduleAllPaydayReminders } from '../../../core/notifications/notifications';
import { isExpoGo } from '../../../shared/utils/expoGo';
import { colors, radius, shadow, spacing } from '../../../shared/theme';

type Props = RootScreenProps<'NotifPermission'>;

export default function NotifPermissionScreen({ navigation, route }: Props) {
  const fromSettings = route.params?.fromSettings ?? false;
  const [requesting, setRequesting] = useState(false);

  const proceed = () => {
    if (fromSettings) {
      navigation.goBack();
    } else {
      navigation.navigate('WorkplacePrompt');
    }
  };

  const handleAllow = async () => {
    setRequesting(true);
    let status: string | undefined;
    if (Platform.OS === 'android' && isExpoGo()) {
      console.log('[notifications] Remote push skipped in Expo Go');
    } else {
      try {
        const Notifications = await import('expo-notifications');
        status = (await Notifications.requestPermissionsAsync()).status;
        if (status === 'granted') {
          const workplaces = await getWorkplaces();
          await rescheduleAllPaydayReminders(workplaces);
        }
      } catch {
        // 웹 등 미지원 환경에서는 조용히 넘어감
      }
    }
    setRequesting(false);

    if (status && status !== 'granted') {
      Alert.alert('알림 권한이 거부됐어요', '설정에서 언제든지 다시 허용할 수 있어요.', [{ text: '확인', onPress: proceed }]);
    } else {
      proceed();
    }
  };

  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.lg }]}>
      <View style={styles.illustrationWrap}>
        <View style={styles.blob} />
        <Ionicons name="sparkles" size={16} color={colors.accent} style={styles.sparkleTopLeft} />
        <Ionicons name="sparkles" size={12} color={colors.primary} style={styles.sparkleBottomRight} />
        <View style={styles.iconCircle}>
          <Ionicons name="notifications" size={40} color={colors.primary} />
          <View style={styles.badge}>
            <Ionicons name="checkmark" size={12} color="#fff" />
          </View>
        </View>
      </View>

      <Text style={styles.title}>알림 권한이 필요해요</Text>
      <Text style={styles.subtitle}>
        급여일, 출퇴근 기록 등 알림을 받으려면{'\n'}권한 허용이 필요해요.
      </Text>

      <View style={styles.spacer} />

      <Pressable
        style={styles.button}
        onPress={handleAllow}
        disabled={requesting}
        accessibilityRole="button"
        accessibilityLabel="권한 허용"
      >
        <Text style={styles.buttonText}>권한 허용</Text>
      </Pressable>
      <Pressable
        style={styles.skipButton}
        onPress={proceed}
        accessibilityRole="button"
        accessibilityLabel={fromSettings ? '닫기' : '나중에 할게요'}
      >
        <Text style={styles.skipButtonText}>{fromSettings ? '닫기' : '나중에 할게요'}</Text>
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
    width: 140,
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  blob: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: colors.primaryLight,
    opacity: 0.7,
  },
  sparkleTopLeft: { position: 'absolute', top: 4, left: 12 },
  sparkleBottomRight: { position: 'absolute', bottom: 8, right: 8 },
  iconCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.raised,
  },
  badge: {
    position: 'absolute',
    right: -2,
    top: -2,
    backgroundColor: colors.primary,
    borderRadius: 999,
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.background,
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
