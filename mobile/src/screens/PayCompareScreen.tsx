import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../components/Text';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import type { RootScreenProps } from '../navigation/types';
import { getPayRecord, getWorkplace } from '../storage';
import { IncomeDeductionType, PayRecord } from '../types';
import { formatWon, netPay } from '../payCalc';
import { formatYearMonth } from '../utils/date';
import { colors, radius, shadow, spacing } from '../theme';
import { LoadingScreen } from '../components/LoadingScreen';

type Props = RootScreenProps<'PayCompare'>;

export default function PayCompareScreen({ navigation, route }: Props) {
  const { workplaceId, yearMonth } = route.params;
  const [payRecord, setPayRecord] = useState<PayRecord | null | undefined>(undefined);
  const [deductionType, setDeductionType] = useState<IncomeDeductionType>('none');

  useFocusEffect(
    useCallback(() => {
      getPayRecord(workplaceId, yearMonth).then((p) => setPayRecord(p ?? null));
      getWorkplace(workplaceId).then((w) => setDeductionType(w?.incomeDeductionType ?? 'none'));
    }, [workplaceId, yearMonth])
  );

  const insets = useSafeAreaInsets();

  if (payRecord === undefined) return <LoadingScreen />;

  if (payRecord === null) {
    return (
      <View style={[styles.emptyContainer, { paddingBottom: insets.bottom }]}>
        <View style={styles.emptyIconCircle}>
          <Ionicons name="cash-outline" size={32} color={colors.primary} />
        </View>
        <Text style={styles.emptyText}>실제 입금액을 먼저 입력해주세요.</Text>
        <Pressable
          style={styles.emptyButton}
          onPress={() => navigation.navigate('PayInput', { workplaceId, yearMonth })}
          accessibilityRole="button"
          accessibilityLabel="실제 입금액 입력하기"
        >
          <Text style={styles.emptyButtonText}>실제 입금액 입력하기</Text>
        </Pressable>
      </View>
    );
  }

  const diff = payRecord.diff ?? 0;
  const pct = payRecord.expectedPay > 0 ? (diff / payRecord.expectedPay) * 100 : 0;
  const isShort = diff < 0;
  const isOver = diff > 0;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingBottom: spacing.xl * 2 + insets.bottom }]}
    >
      <Text style={styles.title}>{formatYearMonth(yearMonth)} 급여</Text>

      <View style={styles.boxRow}>
        <View style={styles.box}>
          <Ionicons name="calculator-outline" size={16} color={colors.subtext} />
          <Text style={styles.boxLabel}>예상 급여{deductionType !== 'none' ? ' (세전)' : ''}</Text>
          <Text style={styles.boxValue}>{formatWon(payRecord.expectedPay)}</Text>
          {deductionType !== 'none' && (
            <Text style={styles.boxCaption}>세후 {formatWon(netPay(payRecord.expectedPay, deductionType))}</Text>
          )}
        </View>
        <View style={[styles.box, styles.boxSecondary]}>
          <Ionicons name="wallet-outline" size={16} color={colors.primaryDark} />
          <Text style={styles.boxLabel}>실제입금액</Text>
          <Text style={styles.boxValuePrimary}>{formatWon(payRecord.actualPay ?? 0)}</Text>
        </View>
      </View>

      <View
        style={[
          styles.diffCard,
          diff === 0 ? styles.diffNeutral : isShort ? styles.diffShort : styles.diffOver,
        ]}
      >
        <Ionicons
          name={diff === 0 ? 'checkmark-circle' : isShort ? 'arrow-down-circle' : 'arrow-up-circle'}
          size={28}
          color={diff === 0 ? colors.primaryDark : isShort ? colors.danger : colors.primaryDark}
        />
        <Text style={styles.diffLabel}>차액</Text>
        <Text style={styles.diffValue}>
          {diff === 0 ? '0원' : `${diff < 0 ? '-' : '+'}${formatWon(Math.abs(diff))}`}
        </Text>
        {diff !== 0 && <Text style={styles.diffPct}>({pct.toFixed(2)}%)</Text>}
      </View>

      <Pressable
        style={styles.detailButton}
        onPress={() => navigation.navigate('ChecklistDetail', { workplaceId, yearMonth })}
        accessibilityRole="button"
        accessibilityLabel="상세 항목 확인하기"
      >
        <Ionicons name="list-outline" size={16} color={colors.onPrimary} />
        <Text style={styles.detailButtonText}>상세 항목 확인하기</Text>
      </Pressable>

      <Pressable
        style={styles.editButton}
        onPress={() => navigation.navigate('PayInput', { workplaceId, yearMonth })}
        accessibilityRole="button"
        accessibilityLabel="입금액 수정하기"
      >
        <Text style={styles.editButtonText}>입금액 수정하기</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: spacing.xl * 2 },
  title: { fontSize: 18, fontWeight: '800', color: colors.text, marginBottom: spacing.md },
  boxRow: { flexDirection: 'row', gap: spacing.sm },
  box: {
    flex: 1,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: 4,
    ...shadow.card,
  },
  boxSecondary: { backgroundColor: colors.primaryLight, borderColor: colors.primaryLight },
  boxLabel: { fontSize: 12, color: colors.subtext },
  boxValue: { fontSize: 18, fontWeight: '800', color: colors.text, marginTop: spacing.xs },
  boxCaption: { fontSize: 11, color: colors.subtext, marginTop: 2 },
  boxValuePrimary: { fontSize: 18, fontWeight: '800', color: colors.primaryDark, marginTop: spacing.xs },
  diffCard: {
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: 'center',
    marginTop: spacing.md,
    gap: 2,
    ...shadow.raised,
  },
  diffNeutral: { backgroundColor: colors.successLight },
  diffShort: { backgroundColor: colors.dangerLight },
  diffOver: { backgroundColor: colors.primaryLight },
  diffLabel: { fontSize: 13, color: colors.subtext, marginTop: spacing.xs },
  diffValue: { fontSize: 26, fontWeight: '800', color: colors.text, marginTop: spacing.xs },
  diffPct: { fontSize: 13, color: colors.subtext, marginTop: 2 },
  detailButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    // 라이트/다크 모두 대비가 보장되는 브랜드 primary + onPrimary 조합.
    // (이전엔 backgroundColor: colors.text + 흰 글자라 다크에서 밝은 배경+흰 글자로 안 보였음)
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 6,
    marginTop: spacing.lg,
  },
  detailButtonText: { color: colors.onPrimary, fontWeight: '700', fontSize: 15 },
  editButton: { marginTop: spacing.md, alignItems: 'center' },
  editButtonText: { color: colors.subtext, fontSize: 13 },
  emptyContainer: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    gap: spacing.sm,
  },
  emptyIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  emptyText: { fontSize: 14, color: colors.subtext, textAlign: 'center' },
  emptyButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.lg,
    ...shadow.card,
  },
  emptyButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
