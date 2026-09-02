import { useCallback, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../../../shared/components/Text';
import { FieldInput } from '../../../shared/components/FieldInput';
import { InputAccessoryToolbar } from '../../../shared/components/InputAccessoryToolbar';
import { useNumericInputNavigation } from '../../../shared/hooks/useNumericInputNavigation';
import { CalendarPickerModal } from '../../../shared/components/CalendarPickerModal';
import { Ionicons } from '@expo/vector-icons';
import { Alert } from '../../../shared/components/alert';
import { useFocusEffect } from '@react-navigation/native';
import type { RootScreenProps } from '../../../app/navigation/types';
import { getAttendanceByMonth, getPayRecord, getWorkplace, makeId, savePayRecord } from '../../../core/data/storage';
import { AttendanceRecord, Workplace, buildChecklist } from '../../../core/domain/models/types';
import { calcDiff, calcMonthlySummary, formatWon } from '../../../core/domain/payroll/payCalc';
import { formatYearMonth, todayDateString } from '../../../shared/utils/date';
import { colors, radius, shadow, spacing } from '../../../shared/theme';
import { LoadingScreen } from '../../../shared/components/LoadingScreen';

type Props = RootScreenProps<'PayInput'>;

export default function PayInputScreen({ navigation, route }: Props) {
  const { workplaceId, yearMonth } = route.params;
  const [workplace, setWorkplace] = useState<Workplace | null>(null);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [actualPay, setActualPay] = useState('');
  const [payDate, setPayDate] = useState(todayDateString());
  const [calendarVisible, setCalendarVisible] = useState(false);
  const [memo, setMemo] = useState('');
  const [existingId, setExistingId] = useState<string | undefined>(undefined);
  // 실제 입금액만 숫자 키보드 이동 대상(마지막 필드 → '완료'). 메모는 일반
  // 텍스트 키보드라 자체 return 키가 있어 별도 처리한다.
  const numericNav = useNumericInputNavigation(['actualPay'] as const);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const [w, list, existing] = await Promise.all([
          getWorkplace(workplaceId),
          getAttendanceByMonth(workplaceId, yearMonth),
          getPayRecord(workplaceId, yearMonth),
        ]);
        setWorkplace(w ?? null);
        setRecords(list);
        if (existing) {
          setExistingId(existing.id);
          if (existing.actualPay != null) setActualPay(String(existing.actualPay));
          if (existing.payDate) setPayDate(existing.payDate);
          if (existing.memo) setMemo(existing.memo);
        }
      })();
    }, [workplaceId, yearMonth])
  );

  const insets = useSafeAreaInsets();

  if (!workplace) return <LoadingScreen />;

  const summary = calcMonthlySummary(records, workplace, yearMonth);

  const handleSave = async () => {
    const amount = Number(actualPay);
    if (!Number.isFinite(amount) || amount < 0) {
      Alert.alert('실제 입금액을 올바르게 입력해주세요.');
      return;
    }
    const diff = calcDiff(summary.expectedPay, amount);
    await savePayRecord({
      id: existingId ?? makeId(),
      workplaceId,
      yearMonth,
      expectedPay: summary.expectedPay,
      actualPay: amount,
      payDate,
      memo: memo.trim() || undefined,
      diff,
      checklist: buildChecklist(diff),
      updatedAt: new Date().toISOString(),
    });
    navigation.replace('PayCompare', { workplaceId, yearMonth });
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingBottom: spacing.xl * 2 + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>{formatYearMonth(yearMonth)} 급여</Text>

        <View style={styles.card}>
          <View style={styles.cardIconWrap}>
            <Ionicons name="calculator-outline" size={18} color={colors.primaryDark} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>예상 급여</Text>
            <Text style={styles.expectedValue}>{formatWon(summary.expectedPay)}</Text>
            {(summary.weeklyAllowancePay > 0 ||
              summary.overtimePay > 0 ||
              summary.nightPay > 0 ||
              summary.holidayPay > 0) && (
              <View style={styles.breakdown}>
                <View style={styles.breakdownRow}>
                  <Text style={styles.breakdownLabel}>기본급</Text>
                  <Text style={styles.breakdownValue}>{formatWon(summary.basePay)}</Text>
                </View>
                {summary.weeklyAllowancePay > 0 && (
                  <View style={styles.breakdownRow}>
                    <Text style={styles.breakdownLabel}>주휴수당</Text>
                    <Text style={styles.breakdownValue}>+{formatWon(summary.weeklyAllowancePay)}</Text>
                  </View>
                )}
                {summary.overtimePay > 0 && (
                  <View style={styles.breakdownRow}>
                    <Text style={styles.breakdownLabel}>연장근로 가산</Text>
                    <Text style={styles.breakdownValue}>+{formatWon(summary.overtimePay)}</Text>
                  </View>
                )}
                {summary.nightPay > 0 && (
                  <View style={styles.breakdownRow}>
                    <Text style={styles.breakdownLabel}>야간근로 가산</Text>
                    <Text style={styles.breakdownValue}>+{formatWon(summary.nightPay)}</Text>
                  </View>
                )}
                {summary.holidayPay > 0 && (
                  <View style={styles.breakdownRow}>
                    <Text style={styles.breakdownLabel}>휴일근로 가산</Text>
                    <Text style={styles.breakdownValue}>+{formatWon(summary.holidayPay)}</Text>
                  </View>
                )}
              </View>
            )}
          </View>
        </View>

        <Text style={styles.fieldLabel}>실제 입금액</Text>
        <FieldInput
          {...numericNav.getFieldProps('actualPay')}
          icon="cash-outline"
          value={actualPay}
          onChangeText={setActualPay}
          keyboardType="number-pad"
          placeholder="예: 410000"
          suffix="원"
        />

        <Text style={styles.fieldLabel}>입금일</Text>
        <Pressable
          onPress={() => setCalendarVisible(true)}
          accessibilityRole="button"
          accessibilityLabel="입금일 선택"
        >
          <View pointerEvents="none">
            <FieldInput icon="calendar-outline" value={payDate} onChangeText={() => {}} placeholder="날짜 선택" />
          </View>
        </Pressable>
        <CalendarPickerModal
          visible={calendarVisible}
          value={payDate}
          onClose={() => setCalendarVisible(false)}
          onSelect={setPayDate}
        />

        <Text style={styles.fieldLabel}>메모 (선택)</Text>
        <FieldInput
          icon="create-outline"
          value={memo}
          onChangeText={setMemo}
          placeholder="메모를 입력하세요"
          returnKeyType="done"
          onSubmitEditing={() => Keyboard.dismiss()}
        />

        <Pressable
          style={styles.saveButton}
          onPress={handleSave}
          accessibilityRole="button"
          accessibilityLabel="저장하기"
        >
          <Text style={styles.saveButtonText}>저장하기</Text>
        </Pressable>
      </ScrollView>

      <InputAccessoryToolbar
        nativeID={numericNav.accessoryViewID}
        label={numericNav.accessoryLabel}
        onPress={numericNav.onAccessoryPress}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: spacing.xl * 2 },
  title: { fontSize: 18, fontWeight: '800', color: colors.text, marginBottom: spacing.md },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    ...shadow.card,
  },
  cardIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 13, fontWeight: '600', color: colors.subtext },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: spacing.xs },
  expectedValue: { fontSize: 20, fontWeight: '800', color: colors.primaryDark },
  breakdown: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 3,
  },
  breakdownRow: { flexDirection: 'row', justifyContent: 'space-between' },
  breakdownLabel: { fontSize: 12, color: colors.subtext },
  breakdownValue: { fontSize: 12, color: colors.text, fontWeight: '600' },
  saveButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 6,
    alignItems: 'center',
    marginTop: spacing.sm,
    ...shadow.card,
  },
  saveButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
