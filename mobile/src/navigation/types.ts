import type { CompositeScreenProps, NavigatorScreenParams } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

export type MainTabParamList = {
  Home: undefined;
  Records: undefined;
  Analysis: undefined;
  Vault: undefined;
  More: undefined;
};

export type RootStackParamList = {
  Splash: undefined;
  Login: undefined;
  Signup: undefined;
  ResetPassword: undefined;
  OnboardingIntro: undefined;
  OnboardingValues: undefined;
  NotifPermission: { fromSettings?: boolean } | undefined;
  WorkplacePrompt: undefined;
  WorkplaceForm: { id?: string; fromOnboarding?: boolean };
  WorkplaceRegistered: { id: string };
  Main: NavigatorScreenParams<MainTabParamList>;
  WorkplaceSwitch: undefined;
  AttendanceCheck: { workplaceId: string };
  AttendanceForm: { workplaceId: string; id?: string; date?: string };
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
