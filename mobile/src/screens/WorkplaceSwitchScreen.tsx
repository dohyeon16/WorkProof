import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../shared/components/Text';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import type { RootScreenProps } from '../app/navigation/types';
import { getActiveWorkplaceId, getWorkplaces, setActiveWorkplaceId } from '../core/data/storage';
import { Workplace } from '../core/domain/models/types';
import { colors, radius, shadow, spacing } from '../shared/theme';

type Props = RootScreenProps<'WorkplaceSwitch'>;

export default function WorkplaceSwitchScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const [workplaces, setWorkplaces] = useState<Workplace[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const [list, active] = await Promise.all([getWorkplaces(), getActiveWorkplaceId()]);
        setWorkplaces(list);
        setActiveId(active);
      })();
    }, [])
  );

  const handleSelect = async (id: string) => {
    await setActiveWorkplaceId(id);
    navigation.goBack();
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={workplaces}
        keyExtractor={(w) => w.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Ionicons name="business-outline" size={32} color={colors.subtext} />
            <Text style={styles.empty}>등록된 근무지가 없어요.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            style={[styles.row, item.id === activeId && styles.rowActive]}
            onPress={() => handleSelect(item.id)}
            accessibilityRole="button"
            accessibilityLabel={`${item.name}${item.id === activeId ? ', 현재 근무지' : ''}`}
          >
            <View style={styles.iconCircle}>
              <Ionicons name="business" size={18} color={colors.primaryDark} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.wage}>시급 {item.hourlyWage.toLocaleString('ko-KR')}원 · 매월 {item.payDay}일</Text>
            </View>
            {item.id === activeId ? (
              <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
            ) : (
              <Pressable
                hitSlop={8}
                onPress={() => navigation.navigate('WorkplaceForm', { id: item.id })}
                accessibilityRole="button"
                accessibilityLabel={`${item.name} 수정`}
              >
                <Ionicons name="create-outline" size={20} color={colors.subtext} />
              </Pressable>
            )}
          </Pressable>
        )}
      />
      <Pressable
        style={[styles.addButton, { marginBottom: insets.bottom }]}
        onPress={() => navigation.navigate('WorkplaceForm', {})}
        accessibilityRole="button"
        accessibilityLabel="새 근무지 추가"
      >
        <Ionicons name="add" size={18} color={colors.primaryDark} />
        <Text style={styles.addButtonText}>새 근무지 추가</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  listContent: { padding: spacing.md },
  emptyWrap: { alignItems: 'center', gap: spacing.xs, marginTop: spacing.xl },
  empty: { color: colors.subtext, fontSize: 13, textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm + 4,
    marginBottom: spacing.sm,
  },
  rowActive: { borderColor: colors.primary, ...shadow.card },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { fontSize: 15, fontWeight: '700', color: colors.text },
  wage: { fontSize: 12, color: colors.subtext, marginTop: 2 },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    margin: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary,
    paddingVertical: spacing.sm + 2,
  },
  addButtonText: { color: colors.primaryDark, fontWeight: '700', fontSize: 14 },
});
