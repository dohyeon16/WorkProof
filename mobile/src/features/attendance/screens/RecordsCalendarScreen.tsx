import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../../../shared/components/Text';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import type { MainTabScreenProps } from '../../../app/navigation/types';
import { getAttendanceByMonth, getActiveOrFirstWorkplace } from '../../../core/data/storage';
import { AttendanceRecord, Workplace } from '../../../core/domain/models/types';
import { calcMonthlySummary, formatMinutesAsHours, formatWorkDuration, shiftWorkedMinutes } from '../../../core/domain/payroll/payCalc';
import { currentYearMonth, formatYearMonth, shiftYearMonth, todayDateString } from '../../../shared/utils/date';
import { colors, radius, shadow, spacing } from '../../../shared/theme';
import { LoadingScreen } from '../../../shared/components/LoadingScreen';

type Props = MainTabScreenProps<'Records'>;

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function buildGrid(yearMonth: string): (string | null)[] {
  const [y, m] = yearMonth.split('-').map(Number);
  const firstDay = new Date(y, m - 1, 1);
  const daysInMonth = new Date(y, m, 0).getDate();
  const startWeekday = firstDay.getDay();
  const cells: (string | null)[] = Array(startWeekday).fill(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${yearMonth}-${String(d).padStart(2, '0')}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export default function RecordsCalendarScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const [workplace, setWorkplace] = useState<Workplace | null | undefined>(undefined);
  const [yearMonth, setYearMonth] = useState(currentYearMonth());
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [selectedDate, setSelectedDate] = useState(todayDateString());

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const w = await getActiveOrFirstWorkplace();
        setWorkplace(w ?? null);
        if (!w) return;
        const list = await getAttendanceByMonth(w.id, yearMonth);
        setRecords(list);
      })();
    }, [yearMonth])
  );

  const cells = useMemo(() => buildGrid(yearMonth), [yearMonth]);
  const recordsByDate = useMemo(() => {
    const map = new Map<string, AttendanceRecord>();
    records.forEach((r) => map.set(r.date, r));
    return map;
  }, [records]);

  if (workplace === undefined) return <LoadingScreen />;

  if (workplace === null) {
    return (
      <View style={styles.emptyContainer}>
        <View style={styles.emptyIconCircle}>
          <Ionicons name="calendar-outline" size={32} color={colors.primary} />
        </View>
        <Text style={styles.emptyTitle}>등록된 근무지가 없어요</Text>
        <Pressable
          style={styles.emptyButton}
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
  const selectedRecord = recordsByDate.get(selectedDate);
  const today = todayDateString();

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.md }]}>
      <View style={styles.monthNav}>
        <Pressable
          onPress={() => setYearMonth((v) => shiftYearMonth(v, -1))}
          style={styles.navBtn}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="이전 달"
        >
          <Ionicons name="chevron-back" size={18} color={colors.text} />
        </Pressable>
        <Text style={styles.monthLabel}>{formatYearMonth(yearMonth)}</Text>
        <Pressable
          onPress={() => setYearMonth((v) => shiftYearMonth(v, 1))}
          style={styles.navBtn}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="다음 달"
        >
          <Ionicons name="chevron-forward" size={18} color={colors.text} />
        </Pressable>
      </View>

      <View style={styles.calendarCard}>
        <View style={styles.weekdayRow}>
          {WEEKDAYS.map((w) => (
            <Text key={w} style={styles.weekdayText}>
              {w}
            </Text>
          ))}
        </View>

        <View style={styles.grid}>
          {cells.map((date, idx) => {
            const hasRecord = date ? recordsByDate.has(date) : false;
            const isSelected = date === selectedDate;
            const isToday = date === today;
            return (
              <Pressable
                key={idx}
                style={styles.cell}
                disabled={!date}
                onPress={() => date && setSelectedDate(date)}
                accessibilityRole="button"
                accessibilityLabel={date ? `${Number(date.slice(-2))}일` : undefined}
              >
                {date && (
                  <View style={[styles.cellInner, isSelected && styles.cellSelected, isToday && !isSelected && styles.cellToday]}>
                    <Text
                      style={[
                        styles.cellText,
                        isToday && styles.cellTextToday,
                        isSelected && styles.cellTextSelected,
                      ]}
                    >
                      {Number(date.slice(-2))}
                    </Text>
                    {hasRecord && <View style={[styles.dot, isSelected && styles.dotSelected]} />}
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.detailCard}>
        <View style={{ flex: 1 }}>
          <Text style={styles.detailDate}>{selectedDate}</Text>
          {selectedRecord ? (
            <>
              <Text style={styles.detailTime}>
                {selectedRecord.clockIn} ~ {selectedRecord.clockOut || '진행중'}
              </Text>
              <Text style={styles.detailHours}>
                {selectedRecord.clockOut
                  ? formatWorkDuration(shiftWorkedMinutes(selectedRecord))
                  : '근무 중'}
              </Text>
            </>
          ) : (
            <Text style={styles.detailEmpty}>이 날짜엔 기록이 없어요.</Text>
          )}
        </View>
        <Pressable
          style={styles.detailEditButton}
          onPress={() =>
            navigation.navigate('AttendanceForm', {
              workplaceId: workplace.id,
              id: selectedRecord?.id,
              date: selectedDate,
            })
          }
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={selectedRecord ? '근무 기록 수정' : '근무 기록 추가'}
        >
          <Ionicons name={selectedRecord ? 'create-outline' : 'add'} size={18} color={colors.primaryDark} />
        </Pressable>
      </View>

      <View style={styles.footer}>
        <View>
          <Text style={styles.footerLabel}>월 누적 근무시간</Text>
          <Text style={styles.footerValue}>{formatMinutesAsHours(summary.totalWorkedMinutes)}</Text>
        </View>
        <Pressable
          style={styles.payButton}
          onPress={() => navigation.navigate('PayInput', { workplaceId: workplace.id, yearMonth })}
          accessibilityRole="button"
          accessibilityLabel="급여 입력"
        >
          <Ionicons name="add" size={16} color="#fff" />
          <Text style={styles.payButtonText}>급여 입력</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.md },
  monthNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm },
  navBtn: { padding: spacing.sm },
  monthLabel: { fontSize: 16, fontWeight: '800', color: colors.text, marginHorizontal: spacing.sm },
  calendarCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    ...shadow.card,
  },
  weekdayRow: { flexDirection: 'row' },
  weekdayText: {
    flex: 1,
    textAlign: 'center',
    fontSize: 12,
    color: colors.subtext,
    fontWeight: '600',
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  cellInner: { alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 16 },
  cellSelected: { backgroundColor: colors.primary },
  cellToday: { borderWidth: 1.5, borderColor: colors.primary },
  cellText: { fontSize: 13, color: colors.text },
  cellTextToday: { color: colors.primaryDark, fontWeight: '800' },
  cellTextSelected: { color: '#fff', fontWeight: '800' },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.primary, marginTop: 2 },
  dotSelected: { backgroundColor: '#fff' },
  detailCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm + 4,
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  detailEditButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailDate: { fontSize: 13, fontWeight: '700', color: colors.text },
  detailTime: { fontSize: 13, color: colors.subtext, marginTop: spacing.xs },
  detailHours: { fontSize: 13, color: colors.primaryDark, fontWeight: '700', marginTop: 2 },
  detailEmpty: { fontSize: 13, color: colors.subtext, marginTop: spacing.xs },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
  },
  footerLabel: { fontSize: 12, color: colors.subtext },
  footerValue: { fontSize: 18, fontWeight: '800', color: colors.text, marginTop: 2 },
  payButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.lg,
    ...shadow.card,
  },
  payButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  emptyContainer: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
  },
  emptyIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  emptyButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    marginTop: spacing.sm,
    ...shadow.card,
  },
  emptyButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
