import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../../../ui/components/display/Text';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import type { MainTabScreenProps } from '../../../app/navigation/types';
import { getActiveOrFirstWorkplace, getAllPayRecords, getAttendanceByWorkplace, getWorkplaces } from '../../../services/storage/storage';
import { AttendanceRecord, PayRecord, Workplace } from '../../../types/domain';
import { formatMinutesAsHours, formatWon, shiftWorkedMinutes } from '../services/payCalc';
import { currentYearMonth, formatYearMonth, shiftYearMonth } from '../../../utils/date';
import { colors, radius, shadow, spacing, control, typography } from '../../../ui/design_system';
import { LoadingScreen } from '../../../ui/components/feedback/LoadingScreen';

type Props = MainTabScreenProps<'Analysis'>;

const CHART_MONTHS = 6;
const CHART_HEIGHT = 120;

interface MonthlyHours {
  yearMonth: string;
  monthLabel: string; // "7월"
  minutes: number;
}

function buildMonthlySeries(attendance: AttendanceRecord[]): MonthlyHours[] {
  const thisMonth = currentYearMonth();
  return Array.from({ length: CHART_MONTHS }, (_, i) => {
    const yearMonth = shiftYearMonth(thisMonth, -(CHART_MONTHS - 1 - i));
    const minutes = attendance
      .filter((a) => a.date.startsWith(yearMonth))
      .reduce((sum, a) => sum + shiftWorkedMinutes(a), 0);
    return { yearMonth, monthLabel: `${Number(yearMonth.split('-')[1])}월`, minutes };
  });
}

export default function AnalysisScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const [workplace, setWorkplace] = useState<Workplace | null | undefined>(undefined);
  const [payRecords, setPayRecords] = useState<PayRecord[]>([]);
  const [series, setSeries] = useState<MonthlyHours[]>([]);
  const [workplaceCount, setWorkplaceCount] = useState(0);
  const yearMonth = currentYearMonth();

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const [w, all] = await Promise.all([getActiveOrFirstWorkplace(), getWorkplaces()]);
        setWorkplaceCount(all.length);
        setWorkplace(w ?? null);
        if (!w) return;
        const [payList, attendance] = await Promise.all([
          getAllPayRecords(),
          getAttendanceByWorkplace(w.id),
        ]);
        setPayRecords(
          payList
            .filter((p) => p.workplaceId === w.id)
            .sort((a, b) => b.yearMonth.localeCompare(a.yearMonth))
        );
        setSeries(buildMonthlySeries(attendance));
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
  const maxMinutes = Math.max(...series.map((s) => s.minutes), 1);
  const totalMinutes = series.reduce((sum, s) => sum + s.minutes, 0);
  const workedMonths = series.filter((s) => s.minutes > 0).length;
  const avgMinutes = workedMonths > 0 ? Math.round(totalMinutes / workedMonths) : 0;

  const header = (
    <>
      <Text style={styles.title}>급여 분석</Text>

      {workplaceCount >= 2 && (
        <Pressable
          style={({ pressed }) => [styles.allWorkplacesCard, pressed && control.pressed]}
          onPress={() => navigation.navigate('AllWorkplaces')}
          accessibilityRole="button"
          accessibilityLabel="전체 근무지 합산 보기"
        >
          <View style={styles.allWorkplacesIconWrap}>
            <Ionicons name="albums-outline" size={18} color={colors.primaryDark} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.allWorkplacesTitle}>전체 근무지 합산</Text>
            <Text style={styles.allWorkplacesSub}>{workplaceCount}곳의 이번 달 예상 급여를 한눈에</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.subtext} />
        </Pressable>
      )}

      <Pressable
        style={({ pressed }) => [styles.currentCard, pressed && control.pressed]}
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

      <Pressable
        style={({ pressed }) => [styles.allWorkplacesCard, pressed && control.pressed]}
        onPress={() => navigation.navigate('PayslipList', { workplaceId: workplace.id })}
        accessibilityRole="button"
        accessibilityLabel="급여명세서 관리"
      >
        <View style={styles.allWorkplacesIconWrap}>
          <Ionicons name="receipt-outline" size={18} color={colors.primaryDark} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.allWorkplacesTitle}>급여명세서</Text>
          <Text style={styles.allWorkplacesSub}>명세서를 등록하면 AI가 항목을 추출해요</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.subtext} />
      </Pressable>

      <View style={styles.chartCard}>
        <View style={styles.chartHeader}>
          <Text style={styles.chartTitle}>월별 근무시간</Text>
          <Text style={styles.chartAvg}>
            {workedMonths > 0 ? `평균 ${formatMinutesAsHours(avgMinutes)}` : '기록 없음'}
          </Text>
        </View>
        <View style={styles.chart}>
          {series.map((s) => {
            const isCurrent = s.yearMonth === yearMonth;
            const barHeight = s.minutes > 0 ? Math.max(4, (s.minutes / maxMinutes) * CHART_HEIGHT) : 0;
            const hours = s.minutes / 60;
            return (
              <View key={s.yearMonth} style={styles.barColumn}>
                <Text style={styles.barValue}>
                  {s.minutes > 0 ? (hours >= 10 ? Math.round(hours) : hours.toFixed(1)) : ''}
                </Text>
                <View style={styles.barTrack}>
                  <View
                    style={[
                      styles.bar,
                      { height: barHeight },
                      isCurrent ? styles.barCurrent : styles.barPast,
                    ]}
                  />
                </View>
                <Text style={[styles.barLabel, isCurrent && styles.barLabelCurrent]}>{s.monthLabel}</Text>
              </View>
            );
          })}
        </View>
        <Text style={styles.chartUnit}>단위: 시간</Text>
      </View>

      <Text style={styles.sectionTitle}>지난 급여 기록</Text>
    </>
  );

  return (
    <FlatList
      style={[styles.container, { paddingTop: insets.top + spacing.md }]}
      contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xl + insets.bottom }}
      ListHeaderComponent={header}
      data={payRecords.filter((p) => p.yearMonth !== yearMonth)}
      keyExtractor={(p) => p.id}
      ListEmptyComponent={<Text style={styles.empty}>지난 기록이 없어요.</Text>}
      renderItem={({ item }) => (
        <Pressable
          style={({ pressed }) => [styles.historyRow, pressed && control.pressed]}
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
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background },
  title: {
    ...typography.title,
    color: colors.text,
    marginBottom: spacing.md },
  allWorkplacesCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  allWorkplacesIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  allWorkplacesTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text },
  allWorkplacesSub: {
    fontSize: 12,
    color: colors.subtext,
    marginTop: 2 },
  currentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
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
  currentLabel: {
    fontSize: 13,
    color: colors.primaryDark,
    fontWeight: '700' },
  currentDiff: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
    marginTop: spacing.xs },
  currentSub: {
    fontSize: 12,
    color: colors.subtext,
    marginTop: 2 },
  chartCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.lg,
    ...shadow.card,
  },
  chartHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  chartTitle: {
    ...typography.section,
    color: colors.text },
  chartAvg: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primaryDark },
  chart: {
    minHeight: CHART_HEIGHT + 44,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: undefined,
  },
  barColumn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end' },
  barValue: {
    lineHeight: 18,
    minHeight: 18,
    fontSize: 12,
    color: colors.subtext,
    marginBottom: 2,
    fontWeight: '600',
    height: undefined },
  barTrack: {
    height: CHART_HEIGHT,
    justifyContent: 'flex-end' },
  bar: {
    width: 22,
    borderTopLeftRadius: 5,
    borderTopRightRadius: 5 },
  barPast: {
    backgroundColor: colors.primaryLight },
  barCurrent: {
    backgroundColor: colors.primary },
  barLabel: {
    fontSize: 11,
    color: colors.subtext,
    marginTop: 6 },
  barLabelCurrent: {
    color: colors.primaryDark,
    fontWeight: '800' },
  chartUnit: {
    fontSize: 10,
    color: colors.subtext,
    textAlign: 'right',
    marginTop: spacing.xs },
  sectionTitle: {
    ...typography.section,
    color: colors.text,
    marginBottom: spacing.xs },
  empty: {
    fontSize: 13,
    color: colors.subtext },
  historyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  historyMonth: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text },
  historyDiff: {
    fontSize: 13,
    color: colors.subtext,
    flex: 1,
    textAlign: 'right' },
  historyDiffShort: {
    color: colors.danger,
    fontWeight: '700' },
  historyDiffOver: {
    color: colors.primaryDark,
    fontWeight: '700' },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.background },
  emptyIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    ...typography.section,
    color: colors.text },
});
