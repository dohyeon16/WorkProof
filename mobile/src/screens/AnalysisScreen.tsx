import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../components/Text';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import type { MainTabScreenProps } from '../navigation/types';
import { getActiveOrFirstWorkplace, getAllPayRecords } from '../storage';
import { PayRecord, Workplace } from '../types';
import { formatWon } from '../payCalc';
import { currentYearMonth, formatYearMonth } from '../utils/date';
import { colors, radius, shadow, spacing } from '../theme';
import { LoadingScreen } from '../components/LoadingScreen';

type Props = MainTabScreenProps<'Analysis'>;

export default function AnalysisScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const [workplace, setWorkplace] = useState<Workplace | null | undefined>(undefined);
  const [payRecords, setPayRecords] = useState<PayRecord[]>([]);
  const yearMonth = currentYearMonth();

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const w = await getActiveOrFirstWorkplace();
        setWorkplace(w ?? null);
        if (!w) return;
        const list = await getAllPayRecords();
        setPayRecords(
          list
            .filter((p) => p.workplaceId === w.id)
            .sort((a, b) => b.yearMonth.localeCompare(a.yearMonth))
        );
      })();
    }, [])
  );

  if (workplace === undefined) return <LoadingScreen />;

  if (workplace === null) {
    return (
      <View style={styles.emptyContainer}>
        <View style={styles.emptyIconCircle}>
          <Ionicons name="stats-chart-outline" size={32} color={colors.primary} />
        </View>
        <Text style={styles.emptyTitle}>등록된 근무지가 없어요</Text>
      </View>
    );
  }

  const thisMonth = payRecords.find((p) => p.yearMonth === yearMonth);

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.md }]}>
      <Text style={styles.title}>급여 분석</Text>

      <Pressable
        style={styles.currentCard}
        onPress={() =>
          navigation.navigate(thisMonth ? 'PayCompare' : 'PayInput', { workplaceId: workplace.id, yearMonth })
        }
        accessibilityRole="button"
        accessibilityLabel={`${formatYearMonth(yearMonth)} 급여 ${thisMonth ? '비교' : '입력'}`}
      >
        <View style={styles.currentIconWrap}>
          <Ionicons name="trending-up-outline" size={20} color={colors.primaryDark} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.currentLabel}>{formatYearMonth(yearMonth)}</Text>
          {thisMonth ? (
            <>
              <Text style={styles.currentDiff}>
                차액{' '}
                {thisMonth.diff === 0
                  ? '없음'
                  : `${formatWon(Math.abs(thisMonth.diff ?? 0))} ${
                      (thisMonth.diff ?? 0) < 0 ? '부족' : '초과'
                    }`}
              </Text>
              <Text style={styles.currentSub}>탭하여 상세 비교 보기</Text>
            </>
          ) : (
            <Text style={styles.currentSub}>실제 입금액을 입력해보세요</Text>
          )}
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.primaryDark} />
      </Pressable>

      <Text style={styles.sectionTitle}>지난 급여 기록</Text>
      <FlatList
        data={payRecords.filter((p) => p.yearMonth !== yearMonth)}
        keyExtractor={(p) => p.id}
        ListEmptyComponent={<Text style={styles.empty}>지난 기록이 없어요.</Text>}
        renderItem={({ item }) => (
          <Pressable
            style={styles.historyRow}
            onPress={() =>
              navigation.navigate('PayCompare', { workplaceId: workplace.id, yearMonth: item.yearMonth })
            }
            accessibilityRole="button"
            accessibilityLabel={`${formatYearMonth(item.yearMonth)} 급여 비교`}
          >
            <Text style={styles.historyMonth}>{formatYearMonth(item.yearMonth)}</Text>
            <Text
              style={[
                styles.historyDiff,
                (item.diff ?? 0) < 0 && styles.historyDiffShort,
                (item.diff ?? 0) > 0 && styles.historyDiffOver,
              ]}
            >
              {item.diff === 0 ? '차액 없음' : formatWon(Math.abs(item.diff ?? 0))}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={colors.subtext} />
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.md },
  title: { fontSize: 18, fontWeight: '800', color: colors.text, marginBottom: spacing.md },
  currentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.lg,
    ...shadow.card,
  },
  currentIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  currentLabel: { fontSize: 13, color: colors.primaryDark, fontWeight: '700' },
  currentDiff: { fontSize: 18, fontWeight: '800', color: colors.text, marginTop: spacing.xs },
  currentSub: { fontSize: 12, color: colors.subtext, marginTop: 2 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: colors.text, marginBottom: spacing.xs },
  empty: { fontSize: 13, color: colors.subtext },
  historyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm + 4,
    marginBottom: spacing.sm,
  },
  historyMonth: { fontSize: 14, fontWeight: '600', color: colors.text },
  historyDiff: { fontSize: 13, color: colors.subtext, flex: 1, textAlign: 'right' },
  historyDiffShort: { color: colors.danger, fontWeight: '700' },
  historyDiffOver: { color: colors.primaryDark, fontWeight: '700' },
  emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  emptyIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
});
