// AI 분석용 훅 — 화면(WorkplaceForm/Vault)이 새 OCR/AI 분석을 시작하기 전에 쓰는 접근층.
//
// 책임(Phase 4C-2 정책):
//  - AiRemote 를 세션의 runAuthorized + 공유 ApiClient 로 만든다(키 없음, 프록시 전용).
//  - 새 분석 전 로그인 여부를 검사해, 비로그인이면 provider 요청을 아예 시작하지 않고
//    로그인 게이트를 띄운다(기존 저장 결과 "열람"은 게이팅하지 않는다 — 화면에서 그대로 표시).
//  - 분석 도중 인증 만료(AUTH_REQUIRED)로 밝혀지면 같은 게이트를 띄운다.
import { useMemo, useRef } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Alert } from '../shared/components/alert';
import { createApiClient } from '../core/api/client';
import { useAuth } from '../features/auth/state/AuthContext';
import type { RootStackParamList } from '../app/navigation/types';
import { createAiRemote, type AiRemote } from '../core/api/aiProxyApi';
import { AI_LOGIN_GATE, requiresLoginForNewAnalysis } from './aiAccess';

// 공유 ApiClient — AuthContext/SyncContext 와 동일하게 모듈 스코프에서 1회 생성한다.
const apiClient = createApiClient();

export interface AiAnalysis {
  remote: AiRemote;
  /** 새 분석을 시작해도 되면 true. 비로그인이면 로그인 게이트를 띄우고 false 를 돌려준다. */
  ensureCanAnalyze(): boolean;
  /** 분석 결과가 AUTH_REQUIRED 였을 때(진행 중 인증 만료) 로그인 게이트를 띄운다. */
  promptLogin(): void;
}

export function useAiAnalysis(): AiAnalysis {
  const { isAuthenticated, runAuthorized } = useAuth();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  // 최신 runAuthorized 를 ref 로 들고 있어 remote 의 stale closure 를 피한다(SyncContext 패턴).
  const authorizedRef = useRef(runAuthorized);
  authorizedRef.current = runAuthorized;
  const remote = useMemo<AiRemote>(
    () => createAiRemote(apiClient, (run) => authorizedRef.current(run)),
    []
  );

  const promptLogin = (): void => {
    Alert.alert(AI_LOGIN_GATE.title, AI_LOGIN_GATE.message, [
      { text: AI_LOGIN_GATE.confirmLabel, onPress: () => navigation.navigate('Login') },
      { text: AI_LOGIN_GATE.cancelLabel, style: 'cancel' },
    ]);
  };

  const ensureCanAnalyze = (): boolean => {
    if (!requiresLoginForNewAnalysis(isAuthenticated)) return true;
    promptLogin();
    return false;
  };

  return { remote, ensureCanAnalyze, promptLogin };
}
