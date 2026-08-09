import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../../../shared/components/Text';
import { Alert } from '../../../shared/components/alert';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import type { MainTabScreenProps } from '../../../app/navigation/types';
import { clearAllData, getAccount, getAppLockEnabled, setAppLockEnabled, setLoggedIn } from '../../../core/data/storage';
import { useAuth } from '../../auth/state/AuthContext';
import { useSync } from '../../sync/SyncContext';
import { isAppLockAvailable, authenticateAppLock } from '../../security/services/appLock';
import { createBackup, restoreBackup } from '../../../core/backup/backup';
import { Account } from '../../../core/domain/models/types';
import { colors, radius, shadow, spacing } from '../../../shared/theme';

type Props = MainTabScreenProps<'More'>;

// 서버 동기화 상태를 한 줄 안내 문구로. (토큰/서버 값은 노출하지 않는다.)
function syncStatusLabel(sync: ReturnType<typeof useSync>): string {
  if (sync.phase === 'syncing') return '동기화 중…';
  if (sync.failedCount > 0) return `동기화 실패 ${sync.failedCount}건 — 눌러서 재시도`;
  if (sync.phase === 'offline') return '오프라인 — 연결되면 자동으로 재시도해요';
  if (sync.pendingCount > 0) return `${sync.pendingCount}건 전송 대기 중`;
  if (sync.lastSyncedAt) return '최신 상태로 동기화됨';
  return '변경 사항 없음';
}

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
  // 백엔드 이메일 세션이 있으면 그 사용자를, 없으면(소셜/로컬) 기존 로컬 Account를 표시한다.
  const { isAuthenticated, user: authUser, logout } = useAuth();
  const sync = useSync();
  const [account, setAccount] = useState<Account | null>(null);
  const [busy, setBusy] = useState<null | 'backup' | 'restore'>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [appLock, setAppLock] = useState(false);
  const [lockAvailable, setLockAvailable] = useState(false);

  const displayName = isAuthenticated ? authUser?.name ?? '사용자' : account?.name ?? '사용자';
  const displayEmail = isAuthenticated ? authUser?.email ?? '' : account?.email ?? '';

  useFocusEffect(
    useCallback(() => {
      getAccount().then(setAccount);
      getAppLockEnabled().then(setAppLock);
      isAppLockAvailable().then(setLockAvailable);
    }, [])
  );

  const handleToggleAppLock = async (next: boolean) => {
    if (next) {
      if (!lockAvailable) {
        Alert.alert(
          '앱 잠금을 쓸 수 없어요',
          '이 기기에 생체인증이나 화면 잠금(PIN·패턴)이 설정돼 있지 않아요. 기기 설정에서 먼저 등록해주세요.'
        );
        return;
      }
      // 켤 때는 실제로 인증이 되는지 한 번 확인한 뒤에만 활성화한다.
      const ok = await authenticateAppLock();
      if (!ok) return;
      await setAppLockEnabled(true);
      setAppLock(true);
    } else {
      await setAppLockEnabled(false);
      setAppLock(false);
    }
  };

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
          if (loggingOut) return; // 중복 로그아웃 방지
          setLoggingOut(true);
          try {
            if (isAuthenticated) {
              // 서버 refresh 폐기 + 로컬 세션 정리(네트워크 장애가 있어도 로컬은 반드시 정리됨).
              await logout();
            } else {
              await setLoggedIn(false);
            }
          } finally {
            navigation.getParent()?.reset({ index: 0, routes: [{ name: 'Login' }] });
          }
        },
      },
    ]);
  };

  const handleResetApp = () => {
    Alert.alert(
      '앱 초기화',
      '이 기기에 저장된 근무지·근태·급여 데이터와 로그인 정보가 삭제되고 로그인 화면으로 돌아가요. 서버 계정은 삭제되지 않아요 — 다시 로그인하면 이어서 사용할 수 있어요. 계속할까요?',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '초기화',
          style: 'destructive',
          onPress: async () => {
            await clearAllData();
            // 로컬 로그인 상태와 SecureStore refresh 토큰까지 정리한다(서버 계정은 유지).
            // 이걸 빼면 refresh 토큰이 SecureStore에 남아 앱 재시작 시 자동 로그인으로
            // 세션이 복원될 수 있다("모든 데이터 삭제"와 불일치). best-effort — 실패해도 진행.
            try {
              await logout();
            } catch {
              /* 서버 폐기 실패 등은 무시하고 로컬 정리/이동은 계속한다 */
            }
            navigation.getParent()?.reset({ index: 0, routes: [{ name: 'Login' }] });
          },
        },
      ]
    );
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.xl },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.title}>더보기</Text>
      <View style={styles.profileCard}>
        <View style={styles.avatar}>
          <Ionicons name="person" size={24} color={colors.primaryDark} />
        </View>
        <View>
          <Text style={styles.name}>{displayName}</Text>
          <Text style={styles.email}>{displayEmail}</Text>
        </View>
      </View>

      {isAuthenticated && (
        <Pressable
          style={styles.row}
          onPress={() => navigation.navigate('Account')}
          accessibilityRole="button"
          accessibilityLabel="회원정보"
        >
          <View style={styles.rowIconWrap}>
            <Ionicons name="person-outline" size={18} color={colors.primaryDark} />
          </View>
          <Text style={styles.rowText}>회원정보</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.subtext} />
        </Pressable>
      )}

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

      <View style={styles.row}>
        <View style={styles.rowIconWrap}>
          <Ionicons name="lock-closed-outline" size={18} color={colors.primaryDark} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle}>앱 잠금</Text>
          <Text style={styles.rowSub}>생체인증·기기 암호로 앱을 보호해요</Text>
        </View>
        <Switch
          value={appLock}
          onValueChange={handleToggleAppLock}
          trackColor={{ true: colors.primary, false: colors.border }}
          thumbColor="#fff"
        />
      </View>

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

      {isAuthenticated && (
        <Pressable
          style={styles.row}
          onPress={() => (sync.failedCount > 0 ? sync.retryFailed() : sync.syncNow())}
          disabled={sync.phase === 'syncing'}
          accessibilityRole="button"
          accessibilityLabel="서버 동기화"
        >
          <View style={styles.rowIconWrap}>
            <Ionicons name="sync-outline" size={18} color={colors.primaryDark} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>서버 동기화</Text>
            <Text style={[styles.rowSub, sync.failedCount > 0 && { color: colors.danger }]}>
              {syncStatusLabel(sync)}
            </Text>
          </View>
          {sync.phase === 'syncing' ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Ionicons
              name={sync.failedCount > 0 ? 'refresh' : 'chevron-forward'}
              size={18}
              color={sync.failedCount > 0 ? colors.danger : colors.subtext}
            />
          )}
        </Pressable>
      )}

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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
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
  rowTitle: { fontSize: 14, color: colors.text, fontWeight: '600' },
  rowSub: { fontSize: 12, color: colors.subtext, marginTop: 2 },
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
