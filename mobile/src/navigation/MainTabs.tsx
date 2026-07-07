import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StyleSheet } from 'react-native';
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
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primaryDark,
        tabBarInactiveTintColor: colors.subtext,
        tabBarLabel: LABELS[route.name],
        tabBarLabelStyle: styles.tabBarLabel,
        tabBarStyle: styles.tabBar,
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
