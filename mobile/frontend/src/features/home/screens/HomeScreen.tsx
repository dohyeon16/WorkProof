import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../../../ui/components/display/Text';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import type { MainTabScreenProps } from '../../../app/navigation/types';
import { getAttendanceByMonth, getAttendanceByWorkplace, getPayRecord, getActiveOrFirstWorkplace, getScheduledShifts, getUpcomingShifts } from '../../../services/storage/storage';
import { computeWeeklyWorktime, weeklyInsight, weekMondayOf, type WeeklyWorktime } from '../../insights/weeklyWorktime';
import { getUnreadCount } from '../../../services/notifications/notificationsFeed';
import { AttendanceRecord, PayRecord, ScheduledShift, Workplace } from '../../../types/domain';
import { calcMonthlySummary, formatMinutesAsHours, formatWorkDuration, formatWon, shiftWorkedMinutes } from '../../payroll/services/payCalc';
import { currentYearMonth, formatDateWithWeekday, formatYearMonth, nextPayDate, todayDateString } from '../../../utils/date';
import { colors, radius, shadow, spacing, control, surface, typography } from '../../../ui/design_system';
import { LoadingScreen } from '../../../ui/components/feedback/LoadingScreen';

type Props = MainTabScreenProps<'Home'>;

export default function HomeScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const [workplace, setWorkplace] = useState<Workplace | null | undefined>(undefined);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [payRecord, setPayRecord] = useState<PayRecord | undefined>(undefined);
  const [nextShift, setNextShift] = useState<ScheduledShift | null>(null);
  const [weekly, setWeekly] = useState<WeeklyWorktime | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const yearMonth = currentYearMonth();

  useFocusEffect(
    useCallback(() => {
      (async () => {
        getUnreadCount().then(setUnreadCount);
        const w = await getActiveOrFirstWorkplace();
        setWorkplace(w ?? null);
        if (!w) return;
        const [list, pay, upcoming, allRecords, shifts] = await Promise.all([
          getAttendanceByMonth(w.id, yearMonth),
          getPayRecord(w.id, yearMonth),
          getUpcomingShifts(),
          getAttendanceByWorkplace(w.id), // 주 경계가 달을 넘을 수 있어 전체 기록으로 이번 주 계산
          getScheduledShifts(),
        ]);
        setRecords(list);
        setPayRecord(pay);
        setNextShift(upcoming.find((s) => s.workplaceId === w.id) ?? null);
        setWeekly(
          computeWeeklyWorktime({
            records: allRecords,
            shifts,
            workplaceId: w.id,
            weekMonday: weekMondayOf(todayDateString()),
            now: Date.now(),
          })
        );
      })();
    }, [yearMonth])
  );

  if (workplace === undefined) return <LoadingScreen />;

  if (workplace === null) {
    return (
      <View style={styles.emptyContainer}>
        <View style={styles.emptyIconCircle}>
          <Ionicons name="business-outline" size={36} color={colors.primary} />
        </View>
        <Text style={styles.emptyTitle}>등록된 근무지가 없어요</Text>
        <Text style={styles.emptySubtitle}>근무지를 등록하면 근무 기록과 급여 비교를 시작할 수 있어요.</Text>
        <Pressable
          style={({ pressed }) => [styles.emptyButton, pressed && control.pressed]}
          onPress={() => navigation.navigate('WorkplaceForm', {})}
          accessibilityRole="button"
          accessibilityLabel="근무지 등록하기"
        >
          <Text style={styles.emptyButtonText}>근무지 등록하기</Text>
        </Pressable>
      </View>
    );
  }

  const summary = calcMonthlySummary(records, workplace, yearMonth);
  const weekInsight = weekly && weekly.expectedMinutes > 0 ? weeklyInsight(weekly.expectedMinutes) : null;
  const recent = [...records].reverse().slice(0, 3);
  const { daysUntil } = nextPayDate(workplace.payDay);
  const today = todayDateString();
  const todayRecord = records.find((r) => r.date === today);
  const diff = payRecord?.diff ?? null;
  const monthLabel = formatYearMonth(yearMonth);

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm + 2 }]}>
        <View style={styles.logoRow}>
          <View style={styles.logoBadge}>
            <Ionicons name="checkmark-done" size={14} color="#fff" />
          </View>
          <Text style={styles.logo}>WorkProof</Text>
        </View>
        <Pressable
          style={({ pressed }) => [control.iconButton, pressed && control.pressed]}
          onPress={() => navigation.navigate('Notifications')}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={unreadCount > 0 ? `알림 ${unreadCount}개` : '알림'}
        >
          <Ionicons name="notifications-outline" size={22} color={colors.text} />
          {unreadCount > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
            </View>
          )}
        </Pressable>
      </View>

      <FlatList
        data={recent}
        keyExtractor={(r) => r.id}
        ListHeaderComponent={
          <View>
            <View style={styles.sectionRow}>
              <Text style={styles.sectionTitleMain}>{monthLabel} 근무 현황</Text>
              <Pressable
                style={({ pressed }) => [styles.workplaceChip, pressed && control.pressed]}
                onPress={() => navigation.navigate('WorkplaceSwitch')}
                accessibilityRole="button"
                accessibilityLabel="근무지 전환"
              >
                <Ionicons name="business-outline" size={14} color={colors.primaryDark} />
                <Text style={styles.workplaceChipText} numberOfLines={1}>
                  {workplace.name}
                </Text>
                <Ionicons name="chevron-down" size={14} color={colors.primaryDark} />
              </Pressable>
            </View>

            <View style={styles.summaryCard}>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>누적 근무시간</Text>
                <Text style={styles.summaryValue}>{formatMinutesAsHours(summary.totalWorkedMinutes)}</Text>
              </View>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>예상 급여{summary.deductionType !== 'none' ? ' (세전)' : ''}</Text>
                <Text style={styles.summaryValuePrimary}>{formatWon(summary.expectedPay)}</Text>
              </View>
              {summary.deductionType !== 'none' && (
                <View style={styles.summaryNetRow}>
                  <Text style={styles.summaryNetLabel}>세후 실수령 예상</Text>
                  <Text style={styles.summaryNetValue}>{formatWon(summary.netExpectedPay)}</Text>
                </View>
              )}
              <View style={styles.summaryDivider} />
              <View style={styles.summaryFooterRow}>
                <View style={styles.payDayChip}>
                  <Ionicons name="calendar-outline" size={13} color={colors.primaryDark} />
                  <Text style={styles.payDayChipText}>급여일 D-{daysUntil}</Text>
                </View>
                <Text style={styles.todayShiftText}>
                  {todayRecord
                    ? `오늘 근무 ${todayRecord.clockIn}~${todayRecord.clockOut || '진행중'}`
                    : '오늘 근무 예정 없음'}
                </Text>
              </View>
            </View>

            {weekly && weekInsight && (
              <View style={styles.weekCard}>
                <View style={styles.weekHeader}>
                  <Text style={styles.weekTitle}>이번 주 근무</Text>
                  <Text style={styles.weekExpected}>예상 {formatWorkDuration(weekly.expectedMinutes)}</Text>
                </View>
                <Text style={styles.weekBreakdown}>
                  실제 {formatWorkDuration(weekly.actualMinutes)} · 예정 {formatWorkDuration(weekly.plannedMinutes)}
                </Text>
                {(weekInsight.allowance === 'possible' || weekInsight.overtime !== 'none') && (
                  <View style={styles.weekBadgeRow}>
                    {weekInsight.allowance === 'possible' && (
                      <View style={[styles.weekBadge, styles.weekBadgeInfo]}>
                        <Text style={styles.weekBadgeTextInfo}>주휴수당 요건 확인</Text>
                      </View>
                    )}
                    {weekInsight.overtime !== 'none' && (
                      <View style={[styles.weekBadge, styles.weekBadgeWarn]}>
                        <Text style={styles.weekBadgeTextWarn}>
                          {weekInsight.overtime === 'exceed' ? '40시간 초과 가능' : '40시간 근접'}
                        </Text>
                      </View>
                    )}
                  </View>
                )}
                <Text style={styles.weekHelp}>
                  간이 안내예요. 실제 적용은 근로계약·사업장·근무조건에 따라 달라질 수 있어요.
                </Text>
              </View>
            )}

            <Pressable
              style={({ pressed }) => [styles.checkInButton, pressed && control.pressed]}
              onPress={() => navigation.navigate('AttendanceCheck', { workplaceId: workplace.id })}
              accessibilityRole="button"
              accessibilityLabel="출퇴근 기록하기"
            >
              <Ionicons name="time-outline" size={18} color={colors.primaryDark} />
              <Text style={styles.checkInButtonText}>출퇴근 기록하기</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.scheduleRow, pressed && control.pressed]}
              onPress={() =>
                navigation.navigate('Schedule', {
                  workplaceId: workplace.id,
                  id: nextShift?.id,
                })
              }
              accessibilityRole="button"
              accessibilityLabel={nextShift ? '다음 근무 예정' : '근무 예정 추가'}
            >
              <View style={styles.scheduleIconWrap}>
                <Ionicons name="alarm-outline" size={16} color={colors.primaryDark} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.scheduleLabel}>다음 근무 예정</Text>
                {nextShift ? (
                  <Text style={styles.scheduleValue}>
                    {formatDateWithWeekday(nextShift.date)} {nextShift.startTime}
                    {nextShift.endTime ? `~${nextShift.endTime}` : ''}
                  </Text>
                ) : (
                  <Text style={styles.scheduleSub}>예정된 근무를 추가하면 출근 전에 알려드려요.</Text>
                )}
              </View>
              <Ionicons name={nextShift ? 'chevron-forward' : 'add'} size={18} color={colors.subtext} />
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.payCompareRow, pressed && control.pressed]}
              onPress={() =>
                navigation.navigate(payRecord ? 'PayCompare' : 'PayInput', { workplaceId: workplace.id, yearMonth })
              }
              accessibilityRole="button"
              accessibilityLabel={`${monthLabel.split(' ')[1]} 급여 비교`}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.payCompareLabel}>{monthLabel.split(' ')[1]} 급여 비교</Text>
                {diff != null ? (
                  <Text style={[styles.payCompareValue, diff < 0 ? styles.payCompareValueDanger : styles.payCompareValueOk]}>
                    {diff === 0 ? '차액 없음' : `${diff < 0 ? '-' : '+'}${formatWon(Math.abs(diff))}`}
                  </Text>
                ) : (
                  <Text style={styles.payCompareSub}>실제 입금액을 입력하면 차액을 확인할 수 있어요.</Text>
                )}
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.subtext} />
            </Pressable>

            <Text style={styles.sectionTitle}>최근 근무 기록</Text>
          </View>
        }
        ListEmptyComponent={<Text style={styles.empty}>아직 근무 기록이 없어요.</Text>}
        renderItem={({ item }) => (
          <View style={styles.recordRow}>
            <View style={styles.recordIconWrap}>
              <Ionicons name="time-outline" size={16} color={colors.primaryDark} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.recordDate}>{formatDateWithWeekday(item.date)}</Text>
              <Text style={styles.recordTime}>
                {item.clockIn} ~ {item.clockOut || '진행중'}
              </Text>
            </View>
            <Text style={styles.recordHours}>
              {item.clockOut ? formatWorkDuration(shiftWorkedMinutes(item)) : '근무 중'}
            </Text>
          </View>
        )}
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.page,
    paddingVertical: spacing.sm + 2,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs },
  logoBadge: {
    width: 22,
    height: 22,
    borderRadius: 6,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.primaryDark },
  badge: {
    position: 'absolute',
    top: -5,
    right: -5,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800' },
  listContent: {
    padding: spacing.page,
    paddingBottom: spacing.xl * 2 },
  sectionRow: {
    gap: spacing.sm,
    flexWrap: 'wrap',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  sectionTitleMain: {
    ...typography.section,
    color: colors.text,
    flexShrink: 1 },
  workplaceChip: {
    minHeight: control.minTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 5,
    maxWidth: 150,
  },
  workplaceChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primaryDark,
    flexShrink: 1 },
  summaryCard: {
    ...surface.card,
    ...shadow.card,
  },
  summaryRow: {
    gap: spacing.xs,
    flexWrap: 'wrap',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm },
  summaryDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.sm },
  summaryLabel: {
    ...typography.caption,
    color: colors.subtext },
  summaryValue: {
    ...typography.section,
    fontSize: 24,
    lineHeight: 34,
    color: colors.text },
  summaryValuePrimary: {
    ...typography.section,
    fontSize: 24,
    lineHeight: 34,
    color: colors.primaryDark },
  summaryNetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs },
  summaryNetLabel: {
    fontSize: 12,
    color: colors.subtext },
  summaryNetValue: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text },
  weekCard: {
    ...surface.card,
    marginTop: spacing.sm,
  },
  weekHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center' },
  weekTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.text },
  weekExpected: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.primaryDark },
  weekBreakdown: {
    fontSize: 12,
    color: colors.subtext,
    marginTop: 2 },
  weekBadgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.sm },
  weekBadge: {
    borderRadius: radius.pill,
    paddingVertical: 4,
    paddingHorizontal: 10 },
  weekBadgeInfo: {
    backgroundColor: colors.primaryLight },
  weekBadgeWarn: {
    backgroundColor: colors.accentLight },
  weekBadgeTextInfo: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.primaryDark },
  weekBadgeTextWarn: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.accent },
  weekHelp: {
    fontSize: 11,
    color: colors.subtext,
    marginTop: spacing.sm },
  summaryFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between' },
  payDayChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  payDayChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primaryDark },
  todayShiftText: {
    fontSize: 12,
    color: colors.subtext,
    flexShrink: 1,
    textAlign: 'right' },
  checkInButton: {
    ...control.button,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 4,
    marginTop: spacing.md,
  },
  checkInButtonText: {
    color: colors.primaryDark,
    fontWeight: '700',
    fontSize: 14 },
  scheduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  scheduleIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scheduleLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text },
  scheduleValue: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.primaryDark,
    marginTop: 2 },
  scheduleSub: {
    fontSize: 12,
    color: colors.subtext,
    marginTop: 2 },
  payCompareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  payCompareLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text },
  payCompareValue: {
    fontSize: 14,
    fontWeight: '800',
    marginTop: 2 },
  payCompareValueDanger: {
    color: colors.danger },
  payCompareValueOk: {
    color: colors.primaryDark },
  payCompareSub: {
    fontSize: 12,
    color: colors.subtext,
    marginTop: 2 },
  sectionTitle: {
    ...typography.section,
    color: colors.text,
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
  },
  empty: {
    color: colors.subtext,
    fontSize: 13,
    textAlign: 'center',
    marginTop: spacing.md },
  recordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  recordIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordDate: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text },
  recordTime: {
    ...typography.caption,
    color: colors.subtext,
    marginTop: 2 },
  recordHours: {
    fontSize: 12,
    color: colors.primaryDark,
    fontWeight: '700' },
  emptyContainer: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    padding: spacing.lg,
  },
  emptyIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  emptyTitle: {
    ...typography.section,
    color: colors.text },
  emptySubtitle: {
    ...typography.body,
    color: colors.subtext,
    textAlign: 'center',
    marginTop: 2 },
  emptyButton: {
    ...control.button,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
    ...shadow.card,
  },
  emptyButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14 },
});
