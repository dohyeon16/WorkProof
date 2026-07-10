import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../components/Text';
import { Alert } from '../alert';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import type { MainTabScreenProps } from '../navigation/types';
import { clearAllData, getAccount, setLoggedIn } from '../storage';
import { Account } from '../types';
import { colors, radius, shadow, spacing } from '../theme';

type Props = MainTabScreenProps<'More'>;

const MENU: { icon: keyof typeof Ionicons.glyphMap; label: string; action: (nav: Props['navigation']) => void }[] = [
  { icon: 'business-outline', label: '근무지 관리', action: (nav) => nav.navigate('WorkplaceSwitch') },
  {
    icon: 'notifications-outline',
    label: '알림 설정',
    action: (nav) => nav.navigate('NotifPermission', { fromSettings: true }),
  },
  {
    icon: 'document-text-outline',
    label: '이용약관',
    action: (nav) => nav.navigate('LegalDocument', { doc: 'terms' }),
  },
  {
    icon: 'shield-checkmark-outline',
    label: '개인정보 처리방침',
    action: (nav) => nav.navigate('LegalDocument', { doc: 'privacy' }),
  },
];

export default function MoreScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const [account, setAccount] = useState<Account | null>(null);

  useFocusEffect(
    useCallback(() => {
      getAccount().then(setAccount);
    }, [])
  );

  const handleLogout = () => {
    Alert.alert('로그아웃', '로그아웃 하시겠어요?', [
      { text: '취소', style: 'cancel' },
      {
        text: '로그아웃',
        style: 'destructive',
        onPress: async () => {
          await setLoggedIn(false);
          navigation.getParent()?.reset({ index: 0, routes: [{ name: 'Login' }] });
        },
      },
    ]);
  };

  const handleResetApp = () => {
    Alert.alert(
      '앱 초기화',
      '계정, 근무지, 근태 기록 등 이 기기에 저장된 모든 데이터가 삭제되고 로그인 화면으로 돌아가요. 계속할까요?',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '초기화',
          style: 'destructive',
          onPress: async () => {
            await clearAllData();
            navigation.getParent()?.reset({ index: 0, routes: [{ name: 'Login' }] });
          },
        },
      ]
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.md }]}>
      <View style={styles.profileCard}>
        <View style={styles.avatar}>
          <Ionicons name="person" size={24} color={colors.primaryDark} />
        </View>
        <View>
          <Text style={styles.name}>{account?.name ?? '사용자'}</Text>
          <Text style={styles.email}>{account?.email ?? ''}</Text>
        </View>
      </View>

      {MENU.map((m) => (
        <Pressable
          key={m.label}
          style={styles.row}
          onPress={() => m.action(navigation)}
          accessibilityRole="button"
          accessibilityLabel={m.label}
        >
          <View style={styles.rowIconWrap}>
            <Ionicons name={m.icon} size={18} color={colors.primaryDark} />
          </View>
          <Text style={styles.rowText}>{m.label}</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.subtext} />
        </Pressable>
      ))}

      <Pressable
        style={styles.logoutButton}
        onPress={handleLogout}
        accessibilityRole="button"
        accessibilityLabel="로그아웃"
      >
        <Ionicons name="log-out-outline" size={16} color={colors.danger} />
        <Text style={styles.logoutButtonText}>로그아웃</Text>
      </Pressable>

      <Pressable
        style={styles.resetButton}
        onPress={handleResetApp}
        accessibilityRole="button"
        accessibilityLabel="앱 초기화"
      >
        <Ionicons name="refresh-outline" size={16} color={colors.subtext} />
        <Text style={styles.resetButtonText}>앱 초기화 (모든 데이터 삭제)</Text>
      </Pressable>

      <Text style={styles.version}>WorkProof v1.0.0</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.md },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.lg,
    ...shadow.card,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { fontSize: 16, fontWeight: '800', color: colors.text },
  email: { fontSize: 12, color: colors.subtext, marginTop: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm + 4,
    marginBottom: spacing.sm,
  },
  rowIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, fontSize: 14, color: colors.text, fontWeight: '600' },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.lg,
    paddingVertical: spacing.sm,
  },
  logoutButtonText: { color: colors.danger, fontWeight: '700', fontSize: 14 },
  resetButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
    paddingVertical: spacing.sm,
  },
  resetButtonText: { color: colors.subtext, fontWeight: '600', fontSize: 12 },
  version: { textAlign: 'center', color: colors.subtext, fontSize: 12, marginTop: spacing.md },
});
