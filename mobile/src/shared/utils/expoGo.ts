import { isRunningInExpoGo } from 'expo';
import Constants, { ExecutionEnvironment } from 'expo-constants';

/**
 * Constants.executionEnvironment === StoreClient는 Expo Go와 expo-dev-client 개발 빌드 모두에서
 * 동일하게 참이 되므로, isRunningInExpoGo()와 함께 확인해야 dev-client를 Expo Go로 오판하지 않는다.
 */
export function isExpoGo(): boolean {
  return Constants.executionEnvironment === ExecutionEnvironment.StoreClient && isRunningInExpoGo();
}
