// 회원정보(마이페이지) — 백엔드 이메일 계정 전용.
//  - 진입 시 GET /users/me 로 최신 정보를 불러온다.
//  - 이름만 수정 가능(PATCH /users/me). 이메일/가입수단은 비활성(수정 불가).
//  - 회원탈퇴(DELETE /users/me) — 되돌릴 수 없음을 명확히 안내하고 세션을 완전 삭제.
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../../../shared/components/Text';
import { FieldInput } from '../../../shared/components/FieldInput';
import { Alert } from '../../../shared/components/alert';
import type { RootScreenProps } from '../../../app/navigation/types';
import { useAuth } from '../../auth/state/AuthContext';
import { authErrorMessage } from '../../auth/services/authErrors';
import { clearAllData } from '../../../core/data/storage';
import { colors, radius, shadow, spacing } from '../../../shared/theme';

type Props = RootScreenProps<'Account'>;

export default function AccountScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { user, refreshUser, updateProfile, deleteAccount } = useAuth();

  const [loading, setLoading] = useState(true);
  const [name, setName] = useState(user?.name ?? '');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // 진입 시 서버에서 최신 회원정보를 불러온다. 실패해도 캐시된 값으로 표시한다.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const fresh = await refreshUser();
        if (active) setName(fresh.name);
      } catch {
        // 네트워크 오류 등 — 컨텍스트에 남아있는 user 값을 그대로 쓴다.
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [refreshUser]);

  const email = user?.email ?? '';
  const nameChanged = name.trim().length > 0 && name.trim() !== (user?.name ?? '');

  const handleSave = async () => {
    if (saving || deleting) return;
    if (!name.trim()) {
      Alert.alert('이름을 입력해주세요.');
      return;
    }
    setSaving(true);
    try {
      await updateProfile({ name: name.trim() });
      Alert.alert('저장됐어요', '회원정보가 수정되었어요.');
    } catch (e) {
      Alert.alert('저장 실패', authErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (saving || deleting) return;
    Alert.alert(
      '회원탈퇴',
      '탈퇴하면 계정과 로그인 정보가 삭제되고 되돌릴 수 없어요. 정말 탈퇴하시겠어요?',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '탈퇴',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              await deleteAccount();
              // 탈퇴 시 이 기기의 로컬 데이터(근무 기록·변경 이력·급여·증빙 등)도 함께 지운다.
              // 서버 계정만 지우고 기기에 개인정보가 남지 않도록 한다(변경 이력 포함, ALL_KEYS).
              await clearAllData();
              Alert.alert('탈퇴 완료', '회원탈퇴가 완료되었어요.', [
                {
                  text: '확인',
                  onPress: () =>
                    navigation.reset({ index: 0, routes: [{ name: 'Login' }] }),
                },
              ]);
            } catch (e) {
              Alert.alert('탈퇴 실패', authErrorMessage(e));
              setDeleting(false);
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.md }]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8} accessibilityRole="button" accessibilityLabel="이전으로">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>회원정보</Text>
      </View>

      <Text style={styles.label}>이메일</Text>
      <View style={styles.readonlyField}>
        <Ionicons name="mail-outline" size={18} color={colors.subtext} style={styles.readonlyIcon} />
        <Text style={styles.readonlyText}>{email || '-'}</Text>
      </View>
      <Text style={styles.help}>이메일은 변경할 수 없어요.</Text>

      <Text style={styles.label}>이름 또는 닉네임</Text>
      <FieldInput icon="person-outline" value={name} onChangeText={setName} placeholder="이름" />

      <Pressable
        style={[styles.primaryButton, (!nameChanged || saving) && styles.buttonBusy]}
        onPress={handleSave}
        disabled={!nameChanged || saving || deleting}
        accessibilityRole="button"
        accessibilityLabel="회원정보 저장"
      >
        <Text style={styles.primaryButtonText}>{saving ? '저장 중...' : '저장'}</Text>
      </Pressable>

      <Pressable
        style={styles.deleteButton}
        onPress={handleDelete}
        disabled={deleting || saving}
        accessibilityRole="button"
        accessibilityLabel="회원탈퇴"
      >
        {deleting ? (
          <ActivityIndicator size="small" color={colors.danger} />
        ) : (
          <>
            <Ionicons name="trash-outline" size={16} color={colors.danger} />
            <Text style={styles.deleteButtonText}>회원탈퇴</Text>
          </>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.md },
  center: { alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.lg },
  title: { fontSize: 18, fontWeight: '800', color: colors.text },
  label: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: spacing.xs, marginTop: spacing.sm },
  help: { fontSize: 12, color: colors.subtext, marginTop: spacing.xs },
  readonlyField: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.sm + 6,
    opacity: 0.7,
  },
  readonlyIcon: { marginRight: spacing.xs + 2 },
  readonlyText: { flex: 1, fontSize: 15, color: colors.subtext },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 6,
    alignItems: 'center',
    marginTop: spacing.lg,
    ...shadow.card,
  },
  buttonBusy: { opacity: 0.5 },
  primaryButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.lg,
    paddingVertical: spacing.sm,
  },
  deleteButtonText: { color: colors.danger, fontWeight: '700', fontSize: 14 },
});
