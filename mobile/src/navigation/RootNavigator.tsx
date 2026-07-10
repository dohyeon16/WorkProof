import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { RootStackParamList } from './types';
import MainTabs from './MainTabs';
import SplashScreen from '../screens/SplashScreen';
import LoginScreen from '../screens/LoginScreen';
import SignupScreen from '../screens/SignupScreen';
import ResetPasswordScreen from '../screens/ResetPasswordScreen';
import OnboardingIntroScreen from '../screens/OnboardingIntroScreen';
import OnboardingValuesScreen from '../screens/OnboardingValuesScreen';
import NotifPermissionScreen from '../screens/NotifPermissionScreen';
import WorkplacePromptScreen from '../screens/WorkplacePromptScreen';
import WorkplaceFormScreen from '../screens/WorkplaceFormScreen';
import WorkplacePlacePickerScreen from '../screens/WorkplacePlacePickerScreen';
import WorkplaceRegisteredScreen from '../screens/WorkplaceRegisteredScreen';
import WorkplaceSwitchScreen from '../screens/WorkplaceSwitchScreen';
import AttendanceCheckScreen from '../screens/AttendanceCheckScreen';
import AttendanceFormScreen from '../screens/AttendanceFormScreen';
import PayInputScreen from '../screens/PayInputScreen';
import PayCompareScreen from '../screens/PayCompareScreen';
import ChecklistDetailScreen from '../screens/ChecklistDetailScreen';
import ReportScreen from '../screens/ReportScreen';
import ShareCompleteScreen from '../screens/ShareCompleteScreen';
import LegalDocumentScreen from '../screens/LegalDocumentScreen';
import { colors } from '../theme';

const Stack = createNativeStackNavigator<RootStackParamList>();

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
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="WorkplaceForm"
        component={WorkplaceFormScreen}
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
      <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
      <Stack.Screen
        name="WorkplaceSwitch"
        component={WorkplaceSwitchScreen}
        options={{ title: '근무지 전환' }}
      />
      <Stack.Screen
        name="AttendanceCheck"
        component={AttendanceCheckScreen}
        options={{ title: '출퇴근 기록' }}
      />
      <Stack.Screen
        name="AttendanceForm"
        component={AttendanceFormScreen}
        options={({ route }) => ({ title: route.params?.id ? '근무 기록 수정' : '근무 기록 추가' })}
      />
      <Stack.Screen name="PayInput" component={PayInputScreen} options={{ title: '실제 입금액 입력' }} />
      <Stack.Screen name="PayCompare" component={PayCompareScreen} options={{ title: '급여 비교' }} />
      <Stack.Screen
        name="ChecklistDetail"
        component={ChecklistDetailScreen}
        options={{ title: '확인 필요한 항목' }}
      />
      <Stack.Screen name="Report" component={ReportScreen} options={{ title: 'PDF 리포트 미리보기' }} />
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
