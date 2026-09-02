import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { getFocusedRouteNameFromRoute } from '@react-navigation/native';
import { RootStackParamList } from './types';
import MainTabs from './MainTabs';
import AllWorkplacesScreen from '../../features/workplace/screens/AllWorkplacesScreen';
import NotificationsScreen from '../../features/notifications/screens/NotificationsScreen';
import SplashScreen from '../../features/onboarding/screens/SplashScreen';
import LoginScreen from '../../features/auth/screens/LoginScreen';
import SignupScreen from '../../features/auth/screens/SignupScreen';
import ResetPasswordScreen from '../../features/auth/screens/ResetPasswordScreen';
import AccountScreen from '../../features/settings/screens/AccountScreen';
import OnboardingIntroScreen from '../../features/onboarding/screens/OnboardingIntroScreen';
import OnboardingValuesScreen from '../../features/onboarding/screens/OnboardingValuesScreen';
import NotifPermissionScreen from '../../features/onboarding/screens/NotifPermissionScreen';
import WorkplacePromptScreen from '../../features/onboarding/screens/WorkplacePromptScreen';
import WorkplaceFormScreen from '../../features/workplace/screens/WorkplaceFormScreen';
import WorkplacePlacePickerScreen from '../../features/workplace/screens/WorkplacePlacePickerScreen';
import WorkplaceRegisteredScreen from '../../features/workplace/screens/WorkplaceRegisteredScreen';
import WorkplaceSwitchScreen from '../../features/workplace/screens/WorkplaceSwitchScreen';
import AttendanceCheckScreen from '../../features/attendance/screens/AttendanceCheckScreen';
import AttendanceFormScreen from '../../features/attendance/screens/AttendanceFormScreen';
import ScheduleFormScreen from '../../features/work_schedule/screens/ScheduleFormScreen';
import PayInputScreen from '../../features/payroll/screens/PayInputScreen';
import PayCompareScreen from '../../features/pay_comparison/screens/PayCompareScreen';
import PayComparisonDetailScreen from '../../features/pay_comparison/screens/PayComparisonDetailScreen';
import PayslipListScreen from '../../features/payslip/screens/PayslipListScreen';
import PayslipReviewScreen from '../../features/payslip/screens/PayslipReviewScreen';
import ChecklistDetailScreen from '../../features/payroll/screens/ChecklistDetailScreen';
import ReportScreen from '../../features/payroll/screens/ReportScreen';
import ShareCompleteScreen from '../../features/evidence/screens/ShareCompleteScreen';
import LegalDocumentScreen from '../../features/legal/screens/LegalDocumentScreen';
import { colors } from '../../ui/design_system';

const Stack = createNativeStackNavigator<RootStackParamList>();

// Main(탭 내비게이터)에는 헤더가 없어서 title이 화면에 보이진 않지만, 탭에서
// 스택으로 화면을 열면 그 화면의 뒤로가기 버튼 라벨로 이 title이 쓰인다.
// title을 안 주면 라우트 이름인 "Main"이 영어 그대로 노출되므로, 현재 포커스된
// 탭에 맞는 짧은 한글 라벨을 돌려준다.
const TAB_BACK_TITLES: Record<string, string> = {
  Home: '홈',
  Records: '기록',
  Analysis: '분석',
  Vault: '보관함',
  More: '더보기',
};

export default function RootNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.card },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '700' },
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="Splash" component={SplashScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Signup" component={SignupScreen} options={{ headerShown: false }} />
      <Stack.Screen
        name="ResetPassword"
        component={ResetPasswordScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen name="Account" component={AccountScreen} options={{ headerShown: false }} />
      <Stack.Screen
        name="OnboardingIntro"
        component={OnboardingIntroScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="OnboardingValues"
        component={OnboardingValuesScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="NotifPermission"
        component={NotifPermissionScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="WorkplacePrompt"
        component={WorkplacePromptScreen}
        // 헤더는 숨기지만, 온보딩에서 여기서 근무지 등록 화면을 열 때 뒤로가기
        // 라벨이 라우트명("WorkplacePrompt") 영어로 뜨지 않도록 한글 title을 준다.
        options={{ headerShown: false, title: '이전' }}
      />
      <Stack.Screen
        name="WorkplaceForm"
        component={WorkplaceFormScreen}
        // getId: React Navigation 7부터 navigate()는 같은 화면이 스택에 있어도 항상 새
        // 인스턴스를 push한다(v6은 기존 인스턴스로 점프했음). 탭 화면(홈/분석 등)에서 같은
        // 상세 화면을 여러 번 열었다 닫으면 스택에 화면이 계속 쌓여, 헤더의 "< 홈"/"< 분석"
        // 뒤로가기를 눌러도 방금 쌓인 다른 인스턴스로만 이동해 "안 눌리는 것"처럼 보이는
        // 실기기 회귀의 원인이었다. getId로 같은 대상(id)이면 기존 인스턴스를 재사용하게
        // 해 스택이 무한히 쌓이는 걸 막는다 — 이 파일의 나머지 화면들도 동일하게 적용한다.
        getId={({ params }) => params?.id ?? 'new'}
        options={({ route }) => ({ title: route.params?.id ? '근무지 수정' : '근무지 등록' })}
      />
      <Stack.Screen
        name="WorkplacePlacePicker"
        component={WorkplacePlacePickerScreen}
        options={{ headerShown: false, presentation: 'modal' }}
      />
      <Stack.Screen
        name="WorkplaceRegistered"
        component={WorkplaceRegisteredScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="Main"
        component={MainTabs}
        options={({ route }) => {
          const tab = getFocusedRouteNameFromRoute(route) ?? 'Home';
          return { headerShown: false, title: TAB_BACK_TITLES[tab] ?? '홈' };
        }}
      />
      <Stack.Screen
        name="AllWorkplaces"
        component={AllWorkplacesScreen}
        getId={() => 'singleton'}
        options={{ title: '전체 근무지 합산' }}
      />
      <Stack.Screen
        name="Notifications"
        component={NotificationsScreen}
        getId={() => 'singleton'}
        options={{ title: '알림' }}
      />
      <Stack.Screen
        name="WorkplaceSwitch"
        component={WorkplaceSwitchScreen}
        getId={() => 'singleton'}
        options={{ title: '근무지 전환' }}
      />
      <Stack.Screen
        name="AttendanceCheck"
        component={AttendanceCheckScreen}
        getId={({ params }) => params.workplaceId}
        options={{ title: '출퇴근 기록' }}
      />
      <Stack.Screen
        name="AttendanceForm"
        component={AttendanceFormScreen}
        getId={({ params }) => `${params.workplaceId}:${params.id ?? params.date ?? 'new'}`}
        options={({ route }) => ({ title: route.params?.id ? '근무 기록 수정' : '근무 기록 추가' })}
      />
      <Stack.Screen
        name="Schedule"
        component={ScheduleFormScreen}
        getId={({ params }) => `${params.workplaceId}:${params.id ?? 'new'}`}
        options={({ route }) => ({ title: route.params?.id ? '예정 근무 수정' : '근무 예정 추가' })}
      />
      <Stack.Screen
        name="PayInput"
        component={PayInputScreen}
        getId={({ params }) => `${params.workplaceId}:${params.yearMonth}`}
        options={{ title: '실제 입금액 입력' }}
      />
      <Stack.Screen
        name="PayCompare"
        component={PayCompareScreen}
        getId={({ params }) => `${params.workplaceId}:${params.yearMonth}`}
        options={{ title: '급여 비교' }}
      />
      <Stack.Screen
        name="PayComparisonDetail"
        component={PayComparisonDetailScreen}
        getId={({ params }) => `${params.workplaceId}:${params.yearMonth}`}
        options={{ title: '항목별 차이' }}
      />
      <Stack.Screen
        name="PayslipList"
        component={PayslipListScreen}
        getId={({ params }) => params.workplaceId}
        options={{ title: '급여명세서' }}
      />
      <Stack.Screen
        name="PayslipReview"
        component={PayslipReviewScreen}
        // payslipId 없는 신규 캡처(OCR draft)는 매번 내용이 달라 getId가 undefined를
        // 돌려주면 v7 기본 동작(항상 새로 push)으로 자연스럽게 빠진다 — 기존 편집(같은
        // payslipId 재진입)만 기존 인스턴스로 합친다.
        getId={({ params }) => params.payslipId}
        options={{ title: '명세서 확인' }}
      />
      <Stack.Screen
        name="ChecklistDetail"
        component={ChecklistDetailScreen}
        getId={({ params }) => `${params.workplaceId}:${params.yearMonth}`}
        options={{ title: '확인 필요한 항목' }}
      />
      <Stack.Screen
        name="Report"
        component={ReportScreen}
        getId={({ params }) => `${params.workplaceId}:${params.yearMonth}`}
        options={{ title: 'PDF 리포트 미리보기' }}
      />
      <Stack.Screen
        name="ShareComplete"
        component={ShareCompleteScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="LegalDocument"
        component={LegalDocumentScreen}
        options={{ headerShown: false, presentation: 'modal' }}
      />
    </Stack.Navigator>
  );
}
