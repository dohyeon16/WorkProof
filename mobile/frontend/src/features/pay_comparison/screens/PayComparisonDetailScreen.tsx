import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../../../ui/components/display/Text';
import { useFocusEffect } from '@react-navigation/native';
import type { RootScreenProps } from '../../../app/navigation/types';
import { getAllPayslips, getAttendanceByWorkplace, getWorkplace } from '../../../services/storage/storage';
import { Workplace } from '../../../types/domain';
import { calcMonthlySummary, formatWon } from '../../payroll/services/payCalc';
import { formatYearMonth } from '../../../utils/date';
import { colors, radius, spacing } from '../../../ui/design_system';
import { LoadingScreen } from '../../../ui/components/feedback/LoadingScreen';
import {
  buildPayComparison,
  selectPayslipForMonth,
  type CompareItem,
  type PayComparison,
} from '../services/payComparison';

type Props = RootScreenProps<'PayComparisonDetail'>;

function cell(value: number | null): string {
  return value === null ? '—' : formatWon(value);
}

function diffCell(item: CompareItem): { text: string; color: string } {
  if (item.status === 'incomparable') return { text: '비교 불가', color: colors.subtext };
  if (item.status === 'match') return { text: '차이 없음', color: colors.primaryDark };
  const d = item.diff ?? 0;
  return { text: `${d > 0 ? '+' : '-'}${formatWon(Math.abs(d))}`, color: colors.danger };
}

export default function PayComparisonDetailScreen({ route }: Props) {
  const { workplaceId, yearMonth } = route.params;
  const insets = useSafeAreaInsets();
  const [comparison, setComparison] = useState<PayComparison | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        const [workplace, attendance, payslips] = await Promise.all([
          getWorkplace(workplaceId),
          getAttendanceByWorkplace(workplaceId),
          getAllPayslips(),
        ]);
        if (!active) return;
        const summary = workplace ? calcMonthlySummary(attendance, workplace as Workplace, yearMonth) : null;
        const payslip = selectPayslipForMonth(payslips, workplaceId, yearMonth);
        setComparison(buildPayComparison({ summary, payslip: payslip?.amounts ?? null, actualDeposit: null }));
      })();
      return () => {
        active = false;
      };
    }, [workplaceId, yearMonth])
  );

  if (!comparison) return <LoadingScreen />;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingBottom: spacing.xl * 2 + insets.bottom }]}
    >
      <Text style={styles.title}>{formatYearMonth(yearMonth)} 항목별 차이</Text>
      <Text style={styles.subtitle}>앱 예상액과 급여명세서 기재액을 항목별로 비교해요. (법적 판단 아님)</Text>

      <View style={styles.headerRow}>
        <Text style={[styles.hCell, styles.hItem]}>항목</Text>
        <Text style={[styles.hCell, styles.hNum]}>앱 예상</Text>
        <Text style={[styles.hCell, styles.hNum]}>명세서</Text>
        <Text style={[styles.hCell, styles.hNum]}>차이</Text>
      </View>

      {comparison.items.map((item) => {
        const d = diffCell(item);
        return (
          <View key={item.key} style={styles.row}>
            <View style={styles.itemCell}>
              <Text style={styles.itemLabel}>{item.label}</Text>
              {item.estimated ? <Text style={styles.itemNote}>앱은 추정치</Text> : null}
            </View>
            <Text style={[styles.numCell]}>{cell(item.expected)}</Text>
            <Text style={[styles.numCell]}>{cell(item.payslip)}</Text>
            <Text style={[styles.numCell, { color: d.color, fontWeight: '700' }]}>{d.text}</Text>
          </View>
        );
      })}

      {!comparison.hasPayslip && (
        <Text style={styles.empty}>급여명세서가 없어 명세서 열은 비어 있어요. 명세서를 등록하면 채워져요.</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  title: { fontSize: 18, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: 12, color: colors.subtext, marginTop: spacing.xs, marginBottom: spacing.md, lineHeight: 18 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    borderBottomWidth: 1.5,
    borderBottomColor: colors.border,
  },
  hCell: { fontSize: 12, fontWeight: '700', color: colors.subtext },
  hItem: { flex: 1.4 },
  hNum: { flex: 1, textAlign: 'right' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  itemCell: { flex: 1.4 },
  itemLabel: { fontSize: 13, color: colors.text },
  itemNote: { fontSize: 10, color: colors.subtext, marginTop: 1 },
  numCell: { flex: 1, fontSize: 12, color: colors.text, textAlign: 'right' },
  empty: { fontSize: 12, color: colors.subtext, marginTop: spacing.md, lineHeight: 18 },
});
