import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StyleSheet, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { MainTabParamList } from './types';
import HomeScreen from '../../features/home/screens/HomeScreen';
import RecordsCalendarScreen from '../../features/attendance/screens/RecordsCalendarScreen';
import AnalysisScreen from '../../features/payroll/screens/AnalysisScreen';
import VaultScreen from '../../features/evidence/screens/VaultScreen';
import MoreScreen from '../../features/settings/screens/MoreScreen';
import { colors, control, fonts, spacing } from '../../ui/design_system';

const Tab = createBottomTabNavigator<MainTabParamList>();

const ICONS: Record<keyof MainTabParamList, [keyof typeof Ionicons.glyphMap, keyof typeof Ionicons.glyphMap]> = {
  Home: ['home', 'home-outline'],
  Records: ['calendar', 'calendar-outline'],
  Analysis: ['stats-chart', 'stats-chart-outline'],
  Vault: ['folder', 'folder-outline'],
  More: ['menu', 'menu-outline'],
};

const LABELS: Record<keyof MainTabParamList, string> = {
  Home: '홈',
  Records: '기록',
  Analysis: '분석',
  Vault: '보관함',
  More: '더보기',
};

export default function MainTabs() {
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primaryDark,
        tabBarInactiveTintColor: colors.subtext,
        tabBarLabel: LABELS[route.name],
        tabBarLabelStyle: styles.tabBarLabel,
        // 고정 height/paddingBottom은 제스처 내비게이션 바(홈 인디케이터) 영역을
        // 가려서 마지막 탭이 시스템 바 밑에 깔릴 수 있다. insets.bottom을 더해
        // 기기별 안전영역을 확보한다.
        tabBarStyle: [styles.tabBar, { height: Math.max(64, 44 + 20 * fontScale) + insets.bottom, paddingBottom: spacing.sm + insets.bottom }],
        tabBarItemStyle: styles.tabBarItem,
        tabBarIcon: ({ color, size, focused }) => (
          <Ionicons name={ICONS[route.name][focused ? 0 : 1]} size={size} color={color} />
        ),
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} options={{ title: 'WorkProof' }} />
      <Tab.Screen name="Records" component={RecordsCalendarScreen} options={{ title: '근무 기록' }} />
      <Tab.Screen name="Analysis" component={AnalysisScreen} options={{ title: '급여 분석' }} />
      <Tab.Screen name="Vault" component={VaultScreen} options={{ title: '증빙 보관함' }} />
      <Tab.Screen name="More" component={MoreScreen} options={{ title: '더보기' }} />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: colors.card,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    paddingTop: spacing.sm,
  },
  tabBarItem: {
    minHeight: control.minTarget,
    paddingVertical: 0,
  },
  tabBarLabel: {
    fontFamily: fonts.medium,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 2,
    includeFontPadding: true,
  },
});
