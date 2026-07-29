import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../../../shared/components/Text';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import type { RootScreenProps } from '../../../app/navigation/types';
import { buildNotifications, type AppNotification } from '../../../core/notifications/notificationsFeed';
import { markNotificationsRead } from '../../../core/data/storage';
import { colors, radius, shadow, spacing } from '../../../shared/theme';
import { LoadingScreen } from '../../../shared/components/LoadingScreen';

type Props = RootScreenProps<'Notifications'>;

const TONE_COLOR: Record<AppNotification['tone'], string> = {
  info: colors.primaryDark,
  warning: colors.danger,
  success: colors.success,
};

const TONE_BG: Record<AppNotification['tone'], string> = {
  info: colors.primaryLight,
  warning: colors.dangerLight,
  success: colors.successLight,
};

export default function NotificationsScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<AppNotification[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const list = await buildNotifications();
        setItems(list);
        // 화면에 들어온 알림은 읽음 처리해 홈 화면 배지를 지운다.
        const unread = list.filter((n) => !n.read).map((n) => n.id);
        if (unread.length > 0) await markNotificationsRead(unread);
      })();
    }, [])
  );

  if (items === null) return <LoadingScreen />;

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingBottom: spacing.xl + insets.bottom }]}
      data={items}
      keyExtractor={(n) => n.id}
      ListEmptyComponent={
        <View style={styles.empty}>
          <View style={styles.emptyIcon}>
            <Ionicons name="notifications-off-outline" size={30} color={colors.primary} />
          </View>
          <Text style={styles.emptyTitle}>새 알림이 없어요</Text>
          <Text style={styles.emptySub}>급여일이 다가오거나 차액이 생기면 여기로 알려드릴게요.</Text>
        </View>
      }
      renderItem={({ item }) => (
        <Pressable
          style={[styles.row, !item.read && styles.rowUnread]}
          onPress={() => {
            if (item.link) {
              navigation.navigate(item.link.screen, item.link.params);
              return;
            }
            navigation.navigate(item.target.hasPay ? 'PayCompare' : 'PayInput', {
              workplaceId: item.target.workplaceId,
              yearMonth: item.target.yearMonth,
            });
          }}
          accessibilityRole="button"
          accessibilityLabel={item.title}
        >
          <View style={[styles.iconWrap, { backgroundColor: TONE_BG[item.tone] }]}>
            <Ionicons name={item.icon} size={18} color={TONE_COLOR[item.tone]} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{item.title}</Text>
            <Text style={styles.body}>{item.body}</Text>
          </View>
          {!item.read && <View style={styles.unreadDot} />}
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, flexGrow: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm + 4,
    marginBottom: spacing.sm,
  },
  rowUnread: { borderColor: colors.primary, ...shadow.card },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 14, fontWeight: '700', color: colors.text },
  body: { fontSize: 12, color: colors.subtext, marginTop: 2, lineHeight: 17 },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingTop: spacing.xl * 3 },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  emptyTitle: { fontSize: 15, fontWeight: '800', color: colors.text },
  emptySub: { fontSize: 13, color: colors.subtext, textAlign: 'center', paddingHorizontal: spacing.lg },
});
