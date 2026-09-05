import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../../../ui/components/display/Text';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import type { RootScreenProps } from '../../../app/navigation/types';
import {
  getAllPayslips,
  getAttendanceByWorkplace,
  getPayRecord,
  getWorkplace,
} from '../../../services/storage/storage';
import { PayRecord, PayslipRecord, Workplace } from '../../../types/domain';
import { calcMonthlySummary, formatWon } from '../../payroll/services/payCalc';
import { formatYearMonth } from '../../../utils/date';
import { colors, radius, shadow, spacing } from '../../../ui/design_system';
import { LoadingScreen } from '../../../ui/components/feedback/LoadingScreen';
import {
  buildPayComparison,
  selectPayslipForMonth,
  type ComparePair,
  type PayComparison,
} from '../services/payComparison';

type Props = RootScreenProps<'PayCompare'>;

/** 비교 쌍을 "텍스트 + (부호)금액"으로 표현. 색만으로 상태를 전달하지 않도록 항상 텍스트 동반. */
function diffText(pair: ComparePair): string {
  if (pair.status === 'incomparable') return '비교 불가';
  if (pair.status === 'match' || pair.diff === 0) return '차이 없음';
  const d = pair.diff ?? 0;
  return `${d > 0 ? '+' : '-'}${formatWon(Math.abs(d))}`;
}

function diffColor(pair: ComparePair, actualPerspective = false): string {
  if (pair.status === 'incomparable') return colors.subtext;
  if (pair.status === 'match') return colors.primaryDark;
  return actualPerspective && (pair.diff ?? 0) > 0 ? colors.primaryDark : colors.danger;
}

export default function PayCompareScreen({ navigation, route }: Props) {
  const { workplaceId, yearMonth } = route.params;
  const [loading, setLoading] = useState(true);
  const [comparison, setComparison] = useState<PayComparison | null>(null);
  const [hasPayRecord, setHasPayRecord] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        const [workplace, payRecord, attendance, payslips] = await Promise.all([
          getWorkplace(workplaceId),
          getPayRecord(workplaceId, yearMonth),
          getAttendanceByWorkplace(workplaceId),
          getAllPayslips(),
        ]);
        if (!active) return;
        const summary =
          workplace != null ? calcMonthlySummary(attendance, workplace as Workplace, yearMonth) : null;
        const payslip: PayslipRecord | null = selectPayslipForMonth(payslips, workplaceId, yearMonth);
        setComparison(
          buildPayComparison({
            summary,
            payslip: payslip?.amounts ?? null,
            actualDeposit: (payRecord as PayRecord | undefined)?.actualPay ?? null,
          })
        );
        setHasPayRecord(!!payRecord);
        setLoading(false);
      })();
      return () => {
        active = false;
      };
    }, [workplaceId, yearMonth])
  );

  const insets = useSafeAreaInsets();

  if (loading || !comparison) return <LoadingScreen />;
  const c = comparison;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingBottom: spacing.xl * 2 + insets.bottom }]}
    >
      <Text style={styles.title}>{formatYearMonth(yearMonth)} 급여 비교</Text>
      <Text style={styles.subtitle}>
        앱 예상액·급여명세서·실제 입금액은 서로 다른 값이에요. 어디서 차이가 나는지 확인해보세요.
      </Text>

      {/* 3-way 값 카드 */}
      <View style={styles.valueCard}>
        <ValueRow
          icon="calculator-outline"
          label="예상 급여 (앱 계산)"
          value={c.expectedGross}
          caption={c.expectedNet !== null && c.expectedNet !== c.expectedGross ? `세후 예상 ${formatWon(c.expectedNet)}` : undefined}
        />
        <View style={styles.divider} />
        <ValueRow
          icon="receipt-outline"
          label="급여명세서 (사업주 기재)"
          value={c.payslipGross}
          caption={c.payslipNet !== null ? `실지급 ${formatWon(c.payslipNet)}` : undefined}
          emptyLabel="명세서 미등록"
          onEmptyPress={() => navigation.navigate('PayslipList', { workplaceId })}
        />
        <View style={styles.divider} />
        <ValueRow
          icon="wallet-outline"
          label="실제 입금액"
          value={c.actualDeposit}
          emptyLabel="입금액 미입력"
          onEmptyPress={() => navigation.navigate('PayInput', { workplaceId, yearMonth })}
          highlight
        />
      </View>

      {/* 차이 쌍 */}
      <View style={styles.diffCard}>
        <DiffRow label="예상 ↔ 명세서" pair={c.expectedVsPayslipGross} />
        <DiffRow label={'\uC2E4\uC81C \uC785\uAE08 \u2212 \uBA85\uC138\uC11C \uC2E4\uC9C0\uAE09'} pair={c.payslipNetVsActual} actualPerspective />
        <DiffRow label={'\uC2E4\uC81C \uC785\uAE08 \u2212 \uC608\uC0C1 \uC2E4\uC218\uB839'} pair={c.expectedNetVsActual} actualPerspective last />
      </View>

      {/* 정보성 안내(법적 판단 아님) */}
      {c.notices.length > 0 && (
        <View style={styles.noticeCard}>
          {c.notices.map((n) => (
            <View key={n.code} style={styles.noticeRow}>
              <Ionicons name="information-circle-outline" size={15} color={colors.primaryDark} />
              <Text style={styles.noticeText}>{n.message}</Text>
            </View>
          ))}
          <Text style={styles.disclaimer}>* 정보 제공용이며 법적 판단이 아니에요.</Text>
        </View>
      )}

      <Pressable
        style={styles.primaryButton}
        onPress={() => navigation.navigate('PayComparisonDetail', { workplaceId, yearMonth })}
        accessibilityRole="button"
        accessibilityLabel="항목별 차이 보기"
      >
        <Ionicons name="list-outline" size={16} color={colors.onPrimary} />
        <Text style={styles.primaryButtonText}>항목별 차이 보기</Text>
      </Pressable>

      {/* 기존 예상↔실입금 급여 차액 체크리스트(실제 입금액 있을 때만 의미 있음) */}
      {hasPayRecord && (
        <Pressable
          style={styles.secondaryButton}
          onPress={() => navigation.navigate('ChecklistDetail', { workplaceId, yearMonth })}
          accessibilityRole="button"
          accessibilityLabel="예상과 실제 입금 차액 상세"
        >
          <Text style={styles.secondaryButtonText}>예상 ↔ 실입금 차액 상세 (체크리스트)</Text>
        </Pressable>
      )}

      <View style={styles.linkRow}>
        <Pressable onPress={() => navigation.navigate('PayslipList', { workplaceId })} accessibilityRole="button" accessibilityLabel="급여명세서 관리">
          <Text style={styles.link}>급여명세서 관리</Text>
        </Pressable>
        <Pressable onPress={() => navigation.navigate('PayInput', { workplaceId, yearMonth })} accessibilityRole="button" accessibilityLabel="입금액 입력/수정">
          <Text style={styles.link}>입금액 입력/수정</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function ValueRow({
  icon,
  label,
  value,
  caption,
  emptyLabel,
  onEmptyPress,
  highlight,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: number | null;
  caption?: string;
  emptyLabel?: string;
  onEmptyPress?: () => void;
  highlight?: boolean;
}) {
  return (
    <View style={styles.valueRow}>
      <Ionicons name={icon} size={18} color={highlight ? colors.primaryDark : colors.subtext} />
      <View style={{ flex: 1 }}>
        <Text style={styles.valueLabel}>{label}</Text>
        {caption ? <Text style={styles.valueCaption}>{caption}</Text> : null}
      </View>
      {value !== null ? (
        <Text style={[styles.valueAmount, highlight && { color: colors.primaryDark }]}>{formatWon(value)}</Text>
      ) : onEmptyPress ? (
        <Pressable onPress={onEmptyPress} accessibilityRole="button" accessibilityLabel={emptyLabel}>
          <Text style={styles.valueEmpty}>{emptyLabel} ›</Text>
        </Pressable>
      ) : (
        <Text style={styles.valueEmpty}>미등록</Text>
      )}
    </View>
  );
}

function DiffRow({ label, pair, actualPerspective = false, last }: { label: string; pair: ComparePair; actualPerspective?: boolean; last?: boolean }) {
  return (
    <View style={[styles.diffRow, !last && styles.diffRowBorder]}>
      <Text style={styles.diffLabel}>{label}</Text>
      <Text style={[styles.diffValue, { color: diffColor(pair, actualPerspective) }]}>{diffText(pair)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: spacing.xl * 2 },
  title: { fontSize: 18, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: 12, color: colors.subtext, marginTop: spacing.xs, marginBottom: spacing.md, lineHeight: 18 },
  valueCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadow.card,
  },
  valueRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  valueLabel: { fontSize: 12, color: colors.subtext },
  valueCaption: { fontSize: 11, color: colors.subtext, marginTop: 2 },
  valueAmount: { fontSize: 17, fontWeight: '800', color: colors.text },
  valueEmpty: { fontSize: 13, color: colors.primaryDark, fontWeight: '600' },
  divider: { height: 1, backgroundColor: colors.border },
  diffCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    marginTop: spacing.md,
    ...shadow.card,
  },
  diffRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.sm + 2 },
  diffRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  diffLabel: { fontSize: 13, color: colors.text },
  diffValue: { fontSize: 14, fontWeight: '800' },
  noticeCard: { backgroundColor: colors.primaryLight, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md, gap: 6 },
  noticeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  noticeText: { flex: 1, fontSize: 12, color: colors.primaryDark, lineHeight: 17 },
  disclaimer: { fontSize: 11, color: colors.subtext, marginTop: 2 },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 6,
    marginTop: spacing.lg,
  },
  primaryButtonText: { color: colors.onPrimary, fontWeight: '700', fontSize: 15 },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 6,
    marginTop: spacing.sm,
  },
  secondaryButtonText: { color: colors.primaryDark, fontWeight: '700', fontSize: 14 },
  linkRow: { flexDirection: 'row', justifyContent: 'center', gap: spacing.lg, marginTop: spacing.md },
  link: { fontSize: 13, color: colors.subtext, textDecorationLine: 'underline' },
});
