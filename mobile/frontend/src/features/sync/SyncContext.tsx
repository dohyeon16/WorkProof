// work-data 동기화를 앱 전역에 붙이는 React 계층.
//
// 원칙:
//  - 로컬 우선: 화면 CRUD 는 이 계층과 무관하게 기존 storage.ts 로 즉시 동작한다.
//    이 provider 는 "배경 동기화"만 담당하며, 매 실행마다 로컬 상태와 metadata 를
//    비교(reconcile)해 서버로 밀어 넣고 서버 변경을 병합한다.
//  - 이메일 인증 세션이 있을 때만 sync 한다. 로그아웃하면 중단하고 metadata 를 비운다
//    (업무 데이터는 보존). 소셜/로컬 로그인은 서버 토큰이 없어 sync 대상이 아니다.
//  - 네트워크 복구 감지는 NetInfo 의존성 추가 없이 AppState(포그라운드 복귀) + 웹
//    online 이벤트 + backoff 타이머로 근사한다.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState, Platform } from 'react-native';
import { createApiClient } from '../../services/api/client';
import type { SyncErrorCategory } from './model';
import { resetFailed } from './model';
import { runSync } from './engine';
import { failedCount as countFailed, hasDueOperations, pendingOperationCount } from './reconcile';
import { createWorkDataRemote, type AuthorizedRunner } from './workDataApi';
import {
  clearSyncState,
  loadSyncState,
  saveSyncState,
  syncPersistence,
} from './syncStore';
import {
  getAllAttendance,
  getScheduledShifts,
  getWorkplaces,
} from '../../services/storage/storage';
import { useAuth } from '../auth/state/AuthContext';

// 앱 수명 동안 하나의 API 클라이언트(base URL 은 core/api/config).
const apiClient = createApiClient();

// 배경 재동기화 주기(ms). pending + backoff 도래분이 있을 때만 실제 네트워크를 탄다.
const BACKGROUND_INTERVAL_MS = 45_000;

export type SyncPhase = 'idle' | 'syncing' | 'offline' | 'error';

export interface SyncContextValue {
  /** 이메일 인증 세션이 있어 서버 동기화가 활성인지. */
  enabled: boolean;
  phase: SyncPhase;
  pendingCount: number;
  failedCount: number;
  lastError?: SyncErrorCategory;
  lastSyncedAt?: number;
  /** 수동 전체 동기화(당겨서 새로고침·설정의 "지금 동기화"). */
  syncNow(): void;
  /** 실패로 park 된 항목을 되돌려 재동기화. */
  retryFailed(): void;
}

const SyncContext = createContext<SyncContextValue | null>(null);

async function loadCounts(): Promise<{ pending: number; failed: number; lastError?: SyncErrorCategory }> {
  const [state, workplace, schedule, attendance] = await Promise.all([
    loadSyncState(),
    getWorkplaces(),
    getScheduledShifts(),
    getAllAttendance(),
  ]);
  const pending = pendingOperationCount({ workplace, schedule, attendance }, state);
  const failed = countFailed(state);
  // 대표 오류 카테고리 하나(가장 최근에 기록된 것 우선순위 없이 첫 발견).
  let lastError: SyncErrorCategory | undefined;
  for (const r of ['workplace', 'schedule', 'attendance'] as const) {
    for (const id of Object.keys(state[r])) {
      const e = state[r][id].lastError;
      if (e) lastError = e;
    }
  }
  return { pending, failed, lastError };
}

export function SyncProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, runAuthorized } = useAuth();

  // 최신 runAuthorized 를 ref 로 들고 있어 doSync 의 stale closure 를 피한다.
  const authorizedRef = useRef<AuthorizedRunner>(runAuthorized);
  authorizedRef.current = runAuthorized;

  const runningRef = useRef(false);
  const authedRef = useRef(isAuthenticated);
  authedRef.current = isAuthenticated;

  const [phase, setPhase] = useState<SyncPhase>('idle');
  const [pendingCount, setPendingCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [lastError, setLastError] = useState<SyncErrorCategory | undefined>();
  const [lastSyncedAt, setLastSyncedAt] = useState<number | undefined>();

  const refreshCounts = useCallback(async () => {
    const c = await loadCounts();
    setPendingCount(c.pending);
    setFailedCount(c.failed);
    setLastError(c.lastError);
  }, []);

  const doSync = useCallback(
    async (opts?: { gated?: boolean }) => {
      if (!authedRef.current) return;
      if (runningRef.current) return; // single-flight
      if (opts?.gated) {
        // 주기 트리거: 지금 보낼(도래한) 작업이 없으면 네트워크를 아예 타지 않는다.
        const [state, workplace, schedule, attendance] = await Promise.all([
          loadSyncState(),
          getWorkplaces(),
          getScheduledShifts(),
          getAllAttendance(),
        ]);
        if (!hasDueOperations({ workplace, schedule, attendance }, state, Date.now())) {
          return;
        }
      }

      runningRef.current = true;
      setPhase('syncing');
      try {
        const remote = createWorkDataRemote(apiClient, (run) => authorizedRef.current(run));
        const result = await runSync({
          persistence: syncPersistence,
          remote,
          now: Date.now,
        });
        if (result.pushed > 0 || result.pulled > 0) setLastSyncedAt(Date.now());
        // 상태 결정: 인증 만료 → 세션 계층이 로그아웃 처리(여기선 idle). 오프라인/실패 반영.
        await refreshCounts();
        if (result.authExpired) setPhase('idle');
        else if (result.offline) setPhase('offline');
        else if (result.failedPermanent > 0) setPhase('error');
        else setPhase('idle');
      } catch {
        // 예기치 못한 오류: 로컬 데이터는 그대로. 상태만 error 로 표시.
        setPhase('error');
        await refreshCounts();
      } finally {
        runningRef.current = false;
      }
    },
    [refreshCounts]
  );

  const syncNow = useCallback(() => {
    void doSync();
  }, [doSync]);

  const retryFailed = useCallback(() => {
    void (async () => {
      const state = await loadSyncState();
      await saveSyncState(resetFailed(state));
      await refreshCounts();
      void doSync();
    })();
  }, [doSync, refreshCounts]);

  // 인증 상태 변화: 로그인 → 초기 동기화, 로그아웃 → 중단 + metadata 정리(업무 데이터 보존).
  useEffect(() => {
    if (isAuthenticated) {
      void doSync();
    } else {
      void (async () => {
        await clearSyncState();
        setPhase('idle');
        setPendingCount(0);
        setFailedCount(0);
        setLastError(undefined);
      })();
    }
  }, [isAuthenticated, doSync]);

  // 앱 포그라운드 복귀 → 재동기화(네트워크 복구 근사).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void doSync();
    });
    return () => sub.remove();
  }, [doSync]);

  // 웹: online 이벤트로 재동기화.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onOnline = () => void doSync();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [doSync]);

  // 배경 주기 트리거(도래분 있을 때만 네트워크 사용).
  useEffect(() => {
    const timer = setInterval(() => void doSync({ gated: true }), BACKGROUND_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [doSync]);

  // 마운트 시 초기 카운트 로드(로그인 상태와 무관하게 UI 표시용).
  useEffect(() => {
    void refreshCounts();
  }, [refreshCounts]);

  const value: SyncContextValue = {
    enabled: isAuthenticated,
    phase,
    pendingCount,
    failedCount,
    lastError,
    lastSyncedAt,
    syncNow,
    retryFailed,
  };

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error('useSync must be used within <SyncProvider>');
  return ctx;
}
