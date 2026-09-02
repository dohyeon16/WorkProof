import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform, Pressable, StyleSheet, View, type AppStateStatus } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './Text';
import { getAppLockEnabled } from '../storage';
import { authenticateAppLock } from '../utils/appLock';
import {
  initialAppLockState,
  markAuthFinished,
  markAuthStarted,
  reduceAppState,
  type AppLockState,
} from '../utils/appLockState';
import { colors, radius, spacing } from '../theme';

/**
 * 앱 잠금이 켜져 있으면, 앱을 열거나 (충분히 오래) 백그라운드에서 돌아올 때 생체/기기 인증을 요구한다.
 * 잠긴 동안에는 children(실제 앱 화면)을 렌더하지 않아 민감 정보가 보이지 않는다.
 * 잠금이 꺼져 있거나 웹이면 아무 것도 하지 않고 그대로 통과시킨다(기존 동작 보존).
 * 잠금 판단은 순수 함수 reduceAppState에 위임한다 — inactive만으로는 잠그지 않고, 짧은 백그라운드
 * 체류·인증 진행 중 흔들림·인증 직후 재잠금을 구조적으로 방어한다(파일 선택기·공유·OAuth·권한 팝업 대응).
 */
export function AppLockGate({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState<boolean | null>(null); // null = 아직 확인 전
  const [unlocked, setUnlocked] = useState(false);
  const enabledRef = useRef(false);
  const mountedRef = useRef(true);
  const lockStateRef = useRef<AppLockState>(initialAppLockState());

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    getAppLockEnabled().then((e) => {
      if (!mountedRef.current) return;
      enabledRef.current = e;
      setEnabled(e);
      if (!e) setUnlocked(true);
    });
  }, []);

  // 인증은 항상 하나만 실행한다(authInProgress 플래그). 성공 시에만 잠금 해제.
  const tryUnlock = useCallback(async () => {
    if (lockStateRef.current.authInProgress) return;
    lockStateRef.current = markAuthStarted(lockStateRef.current);
    const ok = await authenticateAppLock();
    lockStateRef.current = markAuthFinished(lockStateRef.current, ok, Date.now());
    if (ok && mountedRef.current) setUnlocked(true);
    // 실패/취소면 잠금 화면에 남아 재시도 버튼을 제공한다.
  }, []);

  // 잠금이 켜져 있고 아직 안 풀렸으면 인증을 띄운다.
  useEffect(() => {
    if (enabled && !unlocked) void tryUnlock();
  }, [enabled, unlocked, tryUnlock]);

  // AppState 전이는 순수 리듀서로 판단한다. background → active + 유예 초과일 때만 재잠금.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    let prev: AppStateStatus = AppState.currentState;
    const sub = AppState.addEventListener('change', (next) => {
      const { state, lock } = reduceAppState(lockStateRef.current, { prev, next, now: Date.now() });
      lockStateRef.current = state;
      prev = next;
      if (!lock || !mountedRef.current) return;
      // 잠금 설정을 그 시점에 다시 읽어(설정에서 방금 켠 경우까지) 반영한다.
      getAppLockEnabled().then((e) => {
        enabledRef.current = e;
        if (e && mountedRef.current) {
          setEnabled(true);
          setUnlocked(false);
        }
      });
    });
    return () => sub.remove();
  }, []);

  if (enabled === null) return <View style={styles.blank} />;
  if (!enabled || unlocked) return <>{children}</>;

  return (
    <View style={styles.lock}>
      <View style={styles.lockIcon}>
        <Ionicons name="lock-closed" size={36} color={colors.primaryDark} />
      </View>
      <Text style={styles.lockTitle}>앱이 잠겨 있어요</Text>
      <Text style={styles.lockSub}>생체인증 또는 기기 암호로 잠금을 해제해주세요.</Text>
      <Pressable
        style={styles.unlockButton}
        onPress={tryUnlock}
        accessibilityRole="button"
        accessibilityLabel="잠금 해제"
      >
        <Ionicons name="finger-print" size={18} color="#fff" />
        <Text style={styles.unlockButtonText}>잠금 해제</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  blank: { flex: 1, backgroundColor: colors.background },
  lock: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    gap: spacing.xs,
  },
  lockIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  lockTitle: { fontSize: 18, fontWeight: '800', color: colors.text },
  lockSub: { fontSize: 13, color: colors.subtext, textAlign: 'center', marginTop: 2 },
  unlockButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.lg,
  },
  unlockButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
