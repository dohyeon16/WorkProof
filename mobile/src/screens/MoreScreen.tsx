import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../components/Text';
import { Alert } from '../alert';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import type { MainTabScreenProps } from '../navigation/types';
import { clearAllData, getAccount, setLoggedIn } from '../storage';
import { createBackup, restoreBackup } from '../backup';
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
  const [busy, setBusy] = useState<null | 'backup' | 'restore'>(null);

  useFocusEffect(
    useCallback(() => {
      getAccount().then(setAccount);
    }, [])
  );

  const handleBackup = async () => {
    if (busy) return;
    setBusy('backup');
    try {
      const result = await createBackup();
      if (result.status === 'unavailable') {
        Alert.alert('내보내기를 사용할 수 없어요', '이 기기에서 파일 공유가 지원되지 않아요.');
      }
    } catch (e) {
      console.warn('[More] 백업 실패:', e);
      Alert.alert('백업 실패', '데이터를 내보내지 못했어요. 다시 시도해주세요.');
    } finally {
      setBusy(null);
    }
  };

  const handleRestore = () => {
    if (busy) return;
    Alert.alert(
      '백업에서 복원',
      '백업 파일의 데이터로 지금 기기의 근무지·근태·급여 기록이 모두 교체됩니다. 계속할까요?\n\n(계약서 사진 등 첨부 파일 원본은 백업에 포함되지 않아요.)',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '복원',
          style: 'destructive',
          onPress: async () => {
            setBusy('restore');
            try {
              const result = await restoreBackup();
              if (result.status === 'done') {
                Alert.alert('복원 완료', '백업 데이터를 불러왔어요.', [
                  {
                    text: '확인',
                    onPress: () =>
                      navigation.getParent()?.reset({ index: 0, routes: [{ name: 'Splash' }] }),
                  },
                ]);
              } else if (result.status === 'error') {
                Alert.alert('복원 실패', result.message);
              }
            } catch (e) {
              console.warn('[More] 복원 실패:', e);
              Alert.alert('복원 실패', '백업 파일을 불러오지 못했어요.');
            } finally {
              setBusy(null);
            }
          },
        },
      ]
    );
  };

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
      <Text style={styles.title}>더보기</Text>
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
        style={styles.row}
        onPress={handleBackup}
        disabled={!!busy}
        accessibilityRole="button"
        accessibilityLabel="데이터 백업 내보내기"
      >
        <View style={styles.rowIconWrap}>
          <Ionicons name="cloud-upload-outline" size={18} color={colors.primaryDark} />
        </View>
        <Text style={styles.rowText}>데이터 백업 (내보내기)</Text>
        {busy === 'backup' ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <Ionicons name="chevron-forward" size={18} color={colors.subtext} />
        )}
      </Pressable>

      <Pressable
        style={styles.row}
        onPress={handleRestore}
        disabled={!!busy}
        accessibilityRole="button"
        accessibilityLabel="백업에서 복원"
      >
        <View style={styles.rowIconWrap}>
          <Ionicons name="cloud-download-outline" size={18} color={colors.primaryDark} />
        </View>
        <Text style={styles.rowText}>백업에서 복원</Text>
        {busy === 'restore' ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <Ionicons name="chevron-forward" size={18} color={colors.subtext} />
        )}
      </Pressable>

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
  title: { fontSize: 18, fontWeight: '800', color: colors.text, marginBottom: spacing.md },
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
