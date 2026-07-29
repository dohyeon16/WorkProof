import type { CompositeScreenProps, NavigatorScreenParams } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { SocialLoginResult } from '../../features/auth/services/socialLogin';

// 네이버는 전체 페이지 리다이렉트로 로그인/회원가입을 처리한다. 리다이렉트 후
// 앱이 재부팅되면 이 값을 통해 어느 화면에서, 로그인/회원가입 중 무엇을 하다가
// 돌아왔는지 전달한다 (src/auth/naverIdentityWeb.ts 참고).
export interface NaverResumeParams {
  mode: 'login' | 'signup';
  result: SocialLoginResult;
}

export type MainTabParamList = {
  Home: undefined;
  Records: undefined;
  Analysis: undefined;
  Vault: undefined;
  More: undefined;
};

export type RootStackParamList = {
  Splash: undefined;
  Login: { prefillEmail?: string; naverResume?: NaverResumeParams } | undefined;
  Signup: { naverResume?: NaverResumeParams } | undefined;
  ResetPassword: undefined;
  OnboardingIntro: undefined;
  OnboardingValues: undefined;
  NotifPermission: { fromSettings?: boolean } | undefined;
  WorkplacePrompt: undefined;
  WorkplaceForm: {
    id?: string;
    fromOnboarding?: boolean;
    pickedLatitude?: number;
    pickedLongitude?: number;
    pickedAddress?: string;
    pickedName?: string;
  };
  WorkplacePlacePicker: { latitude?: number; longitude?: number };
  WorkplaceRegistered: { id: string };
  Main: NavigatorScreenParams<MainTabParamList>;
  AllWorkplaces: undefined;
  Notifications: undefined;
  WorkplaceSwitch: undefined;
  AttendanceCheck: { workplaceId: string };
  AttendanceForm: { workplaceId: string; id?: string; date?: string };
  Schedule: { workplaceId: string; id?: string };
  PayInput: { workplaceId: string; yearMonth: string };
  PayCompare: { workplaceId: string; yearMonth: string };
  ChecklistDetail: { workplaceId: string; yearMonth: string };
  Report: { workplaceId: string; yearMonth: string };
  ShareComplete: { workplaceId: string; yearMonth: string; intent: 'save' | 'share'; note?: string };
  LegalDocument: { doc: 'terms' | 'privacy' | 'marketing' };
};

export type RootScreenProps<T extends keyof RootStackParamList> = NativeStackScreenProps<
  RootStackParamList,
  T
>;

export type MainTabScreenProps<T extends keyof MainTabParamList> = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, T>,
  NativeStackScreenProps<RootStackParamList>
>;
