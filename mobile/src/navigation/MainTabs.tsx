import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { MainTabParamList } from './types';
import HomeScreen from '../screens/HomeScreen';
import RecordsCalendarScreen from '../screens/RecordsCalendarScreen';
import AnalysisScreen from '../screens/AnalysisScreen';
import VaultScreen from '../screens/VaultScreen';
import MoreScreen from '../screens/MoreScreen';
import { colors, fonts } from '../theme';

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
        tabBarStyle: [styles.tabBar, { height: 56 + insets.bottom, paddingBottom: 10 + insets.bottom }],
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
    height: 76,
    paddingTop: 6,
    paddingBottom: 10,
  },
  tabBarItem: {
    paddingVertical: 0,
  },
  tabBarLabel: {
    fontFamily: fonts.medium,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 2,
    includeFontPadding: true,
  },
});
