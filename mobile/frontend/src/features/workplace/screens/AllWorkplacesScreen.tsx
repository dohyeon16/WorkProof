import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../../../ui/components/display/Text';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import type { RootScreenProps } from '../../../app/navigation/types';
import { getAllAttendance, getWorkplaces } from '../../../services/storage/storage';
import { AttendanceRecord, Workplace } from '../../../types/domain';
import { calcMonthlySummary, formatMinutesAsHours, formatWon } from '../../payroll/services/payCalc';
import { currentYearMonth, formatYearMonth } from '../../../utils/date';
import { colors, radius, shadow, spacing } from '../../../ui/design_system';
import { LoadingScreen } from '../../../ui/components/feedback/LoadingScreen';

type Props = RootScreenProps<'AllWorkplaces'>;

interface WorkplaceLine {
  workplace: Workplace;
  workedMinutes: number;
  expectedPay: number;
  netExpectedPay: number;
  hasDeduction: boolean;
}

export default function AllWorkplacesScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const [lines, setLines] = useState<WorkplaceLine[] | undefined>(undefined);
  const yearMonth = currentYearMonth();

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const [workplaces, attendance] = await Promise.all([getWorkplaces(), getAllAttendance()]);
        const byWorkplace = new Map<string, AttendanceRecord[]>();
        for (const a of attendance) {
          const list = byWorkplace.get(a.workplaceId);
          if (list) list.push(a);
          else byWorkplace.set(a.workplaceId, [a]);
        }
        const result: WorkplaceLine[] = workplaces.map((w) => {
          const summary = calcMonthlySummary(byWorkplace.get(w.id) ?? [], w, yearMonth);
          return {
            workplace: w,
            workedMinutes: summary.totalWorkedMinutes,
            expectedPay: summary.expectedPay,
            netExpectedPay: summary.netExpectedPay,
            hasDeduction: summary.deductionType !== 'none',
          };
        });
        // 이번 달 근무·급여가 많은 근무지를 위로.
        result.sort((a, b) => b.expectedPay - a.expectedPay);
        setLines(result);
      })();
    }, [yearMonth])
  );

  if (lines === undefined) return <LoadingScreen />;

  const totalMinutes = lines.reduce((s, l) => s + l.workedMinutes, 0);
  const totalExpected = lines.reduce((s, l) => s + l.expectedPay, 0);
  const totalNet = lines.reduce((s, l) => s + l.netExpectedPay, 0);
  const anyDeduction = lines.some((l) => l.hasDeduction);
  const activeCount = lines.filter((l) => l.workedMinutes > 0 || l.expectedPay > 0).length;

  return (
    <FlatList
      style={[styles.container, { paddingTop: insets.top + spacing.md }]}
      contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xl + insets.bottom }}
      data={lines}
      keyExtractor={(l) => l.workplace.id}
      ListHeaderComponent={
        <>
          <Text style={styles.title}>{formatYearMonth(yearMonth)} 전체 합산</Text>
          <Text style={styles.subtitle}>등록된 모든 근무지의 이번 달 예상 급여를 합쳐서 보여줘요.</Text>

          <View style={styles.totalCard}>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>총 예상 급여{anyDeduction ? ' (세전)' : ''}</Text>
              <Text style={styles.totalValue}>{formatWon(totalExpected)}</Text>
            </View>
            {anyDeduction && (
              <View style={styles.totalSubRow}>
                <Text style={styles.totalSubLabel}>세후 실수령 예상</Text>
                <Text style={styles.totalSubValue}>{formatWon(totalNet)}</Text>
              </View>
            )}
            <View style={styles.totalDivider} />
            <View style={styles.totalFooterRow}>
              <View style={styles.metaChip}>
                <Ionicons name="time-outline" size={13} color={colors.primaryDark} />
                <Text style={styles.metaChipText}>총 {formatMinutesAsHours(totalMinutes)}</Text>
              </View>
              <View style={styles.metaChip}>
                <Ionicons name="business-outline" size={13} color={colors.primaryDark} />
                <Text style={styles.metaChipText}>근무 근무지 {activeCount}곳</Text>
              </View>
            </View>
          </View>

          <Text style={styles.sectionTitle}>근무지별</Text>
        </>
      }
      ListEmptyComponent={<Text style={styles.empty}>등록된 근무지가 없어요.</Text>}
      renderItem={({ item }) => (
        <Pressable
          style={styles.row}
          onPress={() =>
            navigation.navigate('PayInput', { workplaceId: item.workplace.id, yearMonth })
          }
          accessibilityRole="button"
          accessibilityLabel={`${item.workplace.name} 급여 입력`}
        >
          <View style={styles.rowIconWrap}>
            <Ionicons name="business" size={16} color={colors.primaryDark} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowName} numberOfLines={1}>
              {item.workplace.name}
            </Text>
            <Text style={styles.rowMeta}>{formatMinutesAsHours(item.workedMinutes)}</Text>
          </View>
          <View style={styles.rowRight}>
            <Text style={styles.rowPay}>{formatWon(item.expectedPay)}</Text>
            {item.hasDeduction && (
              <Text style={styles.rowNet}>세후 {formatWon(item.netExpectedPay)}</Text>
            )}
          </View>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  title: { fontSize: 18, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: 13, color: colors.subtext, marginTop: 2, marginBottom: spacing.md },
  totalCard: {
    backgroundColor: colors.primaryLight,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.lg,
    ...shadow.card,
  },
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  totalLabel: { fontSize: 13, color: colors.primaryDark, fontWeight: '700' },
  totalValue: { fontSize: 22, fontWeight: '800', color: colors.text },
  totalSubRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xs },
  totalSubLabel: { fontSize: 12, color: colors.subtext },
  totalSubValue: { fontSize: 15, fontWeight: '700', color: colors.text },
  totalDivider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
  totalFooterRow: { flexDirection: 'row', gap: spacing.sm },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  metaChipText: { fontSize: 12, fontWeight: '700', color: colors.primaryDark },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: colors.text, marginBottom: spacing.xs },
  empty: { fontSize: 13, color: colors.subtext },
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
  rowIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowName: { fontSize: 14, fontWeight: '700', color: colors.text },
  rowMeta: { fontSize: 12, color: colors.subtext, marginTop: 2 },
  rowRight: { alignItems: 'flex-end' },
  rowPay: { fontSize: 14, fontWeight: '800', color: colors.primaryDark },
  rowNet: { fontSize: 11, color: colors.subtext, marginTop: 2 },
});
