import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../components/Text';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import type { RootScreenProps } from '../navigation/types';
import { getAttendanceByWorkplace, getWorkplace, makeId, saveAttendance } from '../storage';
import { AttendanceRecord, Workplace } from '../types';
import { formatMinutesAsHours, shiftWorkedMinutes } from '../payCalc';
import { formatDateWithWeekday, todayDateString } from '../utils/date';
import { colors, radius, shadow, spacing } from '../theme';
import { LoadingScreen } from '../components/LoadingScreen';

type Props = RootScreenProps<'AttendanceCheck'>;

export default function AttendanceCheckScreen({ navigation, route }: Props) {
  const { workplaceId } = route.params;
  const [workplace, setWorkplace] = useState<Workplace | null>(null);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const load = useCallback(async () => {
    const [w, list] = await Promise.all([
      getWorkplace(workplaceId),
      getAttendanceByWorkplace(workplaceId),
    ]);
    setWorkplace(w ?? null);
    setRecords(list);
  }, [workplaceId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (!workplace) return <LoadingScreen />;

  const today = todayDateString();
  const todayRecord = records.find((r) => r.date === today);
  const inProgress = !!todayRecord && !todayRecord.clockOut;
  const completed = !!todayRecord && !!todayRecord.clockOut;
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(
    2,
    '0'
  )}:${String(now.getSeconds()).padStart(2, '0')}`;

  const handleClockIn = async () => {
    await saveAttendance({
      id: makeId(),
      workplaceId,
      date: today,
      clockIn: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
      clockOut: '',
      breakMinutes: workplace.breakMinutesPerShift,
    });
    load();
  };

  const handleClockOut = async () => {
    if (!todayRecord) return;
    await saveAttendance({
      ...todayRecord,
      clockOut: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    });
    load();
  };

  const recent = records.filter((r) => r.date !== today).slice(-3).reverse();
  const statusLabel = completed ? '오늘 근무 완료' : inProgress ? '근무 중' : '출근 전';
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingBottom: spacing.md + insets.bottom }]}>
      <View style={styles.headerCard}>
        <View style={styles.headerIconWrap}>
          <Ionicons name="business" size={20} color={colors.primaryDark} />
        </View>
        <Text style={styles.workplaceName}>{workplace.name}</Text>
        <Text style={styles.workplaceWage}>시급 {workplace.hourlyWage.toLocaleString('ko-KR')}원</Text>
      </View>

      <View style={styles.clockCard}>
        <View style={[styles.statusChip, inProgress && styles.statusChipActive]}>
          <View style={[styles.statusDot, inProgress && styles.statusDotActive]} />
          <Text style={[styles.statusChipText, inProgress && styles.statusChipTextActive]}>{statusLabel}</Text>
        </View>
        <Text style={styles.clock}>{timeStr}</Text>

        <View style={styles.timeRow}>
          <View style={styles.timeCol}>
            <Ionicons name="log-in-outline" size={16} color={colors.primaryDark} />
            <Text style={styles.timeLabel}>출근 시간</Text>
            <Text style={styles.timeValue}>{todayRecord?.clockIn || '--:--'}</Text>
          </View>
          <View style={styles.timeDivider} />
          <View style={styles.timeCol}>
            <Ionicons name="log-out-outline" size={16} color={colors.subtext} />
            <Text style={styles.timeLabel}>퇴근 시간</Text>
            <Text style={styles.timeValue}>{todayRecord?.clockOut || '--:--'}</Text>
          </View>
        </View>
      </View>

      <Pressable
        style={[styles.actionButton, (inProgress || completed) && styles.actionButtonDisabled]}
        onPress={handleClockIn}
        disabled={inProgress || completed}
        accessibilityRole="button"
        accessibilityLabel="출근"
      >
        <Ionicons name="play" size={16} color="#fff" />
        <Text style={styles.actionButtonText}>출근</Text>
      </Pressable>
      <Pressable
        style={[styles.actionButtonOutline, !inProgress && styles.actionButtonDisabledOutline]}
        onPress={handleClockOut}
        disabled={!inProgress}
        accessibilityRole="button"
        accessibilityLabel="퇴근"
      >
        <Ionicons name="stop" size={16} color={!inProgress ? colors.subtext : colors.text} />
        <Text style={[styles.actionButtonOutlineText, !inProgress && styles.actionButtonDisabledText]}>
          퇴근
        </Text>
      </Pressable>

      <Text style={styles.sectionTitle}>최근 기록</Text>
      {recent.length === 0 ? (
        <Text style={styles.empty}>이전 기록이 없어요.</Text>
      ) : (
        recent.map((r) => (
          <View key={r.id} style={styles.recordRow}>
            <Text style={styles.recordDate}>{formatDateWithWeekday(r.date)}</Text>
            <Text style={styles.recordTime}>
              {r.clockIn} ~ {r.clockOut || '진행중'}
            </Text>
            <Text style={styles.recordHours}>{formatMinutesAsHours(shiftWorkedMinutes(r))}</Text>
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.md },
  headerCard: { alignItems: 'center', marginBottom: spacing.md },
  headerIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  workplaceName: { fontSize: 16, fontWeight: '800', color: colors.text },
  workplaceWage: { fontSize: 13, color: colors.subtext, marginTop: 2 },
  clockCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    alignItems: 'center',
    marginBottom: spacing.md,
    ...shadow.card,
  },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.background,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
    marginBottom: spacing.xs,
  },
  statusChipActive: { backgroundColor: colors.primaryLight },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.subtext },
  statusDotActive: { backgroundColor: colors.primary },
  statusChipText: { fontSize: 12, fontWeight: '600', color: colors.subtext },
  statusChipTextActive: { color: colors.primaryDark },
  clock: {
    fontSize: 44,
    fontWeight: '800',
    color: colors.primaryDark,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
    marginVertical: spacing.sm,
  },
  timeRow: { flexDirection: 'row', alignItems: 'center', width: '100%', marginTop: spacing.xs },
  timeCol: { flex: 1, alignItems: 'center', gap: 2 },
  timeDivider: { width: 1, height: 40, backgroundColor: colors.border },
  timeLabel: { fontSize: 12, color: colors.subtext },
  timeValue: { fontSize: 18, fontWeight: '700', color: colors.text, marginTop: 2 },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 6,
    marginBottom: spacing.sm,
    ...shadow.card,
  },
  actionButtonDisabled: { backgroundColor: colors.border },
  actionButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  actionButtonOutline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 6,
    backgroundColor: colors.card,
  },
  actionButtonDisabledOutline: { opacity: 0.5 },
  actionButtonOutlineText: { color: colors.text, fontWeight: '700', fontSize: 15 },
  actionButtonDisabledText: { color: colors.subtext },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: colors.text, marginTop: spacing.lg, marginBottom: spacing.xs },
  empty: { color: colors.subtext, fontSize: 13 },
  recordRow: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm + 4,
    marginBottom: spacing.sm,
  },
  recordDate: { fontSize: 14, fontWeight: '700', color: colors.text },
  recordTime: { fontSize: 12, color: colors.subtext, marginTop: 2 },
  recordHours: { fontSize: 12, color: colors.primaryDark, marginTop: 2, fontWeight: '600' },
});
