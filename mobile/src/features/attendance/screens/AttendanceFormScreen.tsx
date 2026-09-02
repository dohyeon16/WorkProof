import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../../../shared/components/Text';
import { FieldInput } from '../../../shared/components/FieldInput';
import { InputAccessoryToolbar } from '../../../shared/components/InputAccessoryToolbar';
import { useNumericInputNavigation } from '../../../shared/hooks/useNumericInputNavigation';
import { WheelPicker } from '../../../shared/components/WheelPicker';
import { CalendarPickerModal } from '../../../shared/components/CalendarPickerModal';
import { Ionicons } from '@expo/vector-icons';
import { Alert } from '../../../shared/components/alert';
import type { RootScreenProps } from '../../../app/navigation/types';
import { getAttendanceHistory, getAttendanceRecord, getScheduledShifts, getWorkplace, deleteAttendance, makeId, saveAttendanceWithHistory } from '../../../core/data/storage';
import { cancelMissingClockOutReminder, scheduleMissingClockOutReminder } from '../../../core/notifications/notifications';
import type { AttendanceChange, AttendanceRecord } from '../../../core/domain/models/types';
import { FIELD_LABELS, formatChangeValue, type AuditedField } from '../audit/auditTrail';
import { formatTimeInput, todayDateString } from '../../../shared/utils/date';
import { BREAK_REQUIRED_MINUTES, shiftDurationMinutes } from '../../../core/domain/payroll/payCalc';
import { colors, radius, shadow, spacing } from '../../../shared/theme';
import { LoadingScreen } from '../../../shared/components/LoadingScreen';

type Props = RootScreenProps<'AttendanceForm'>;

// 직접 입력하는 숫자 필드 순서: 출근 시간 → 퇴근 시간(마지막 → '완료').
// 날짜는 달력 모달, 휴게시간은 휠 픽커라 키보드 이동 대상에서 제외한다.
const NUMERIC_FIELDS = ['clockIn', 'clockOut'] as const;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function clampBreakMinutes(n: number) {
  const clamped = Math.max(0, Math.min(60, n));
  return Math.round(clamped / 10) * 10;
}

const SOURCE_LABEL: Record<string, string> = { clock: '원터치', manual: '직접 수정' };

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function AttendanceFormScreen({ navigation, route }: Props) {
  const { workplaceId, id: editingId, date: dateParam } = route.params;
  const [loaded, setLoaded] = useState(false);
  const [date, setDate] = useState(dateParam ?? todayDateString());
  const [calendarVisible, setCalendarVisible] = useState(false);
  const [clockIn, setClockIn] = useState('');
  const [clockOut, setClockOut] = useState('');
  const [breakMinutes, setBreakMinutes] = useState(0);
  const [isHoliday, setIsHoliday] = useState(false);
  // 휴게시간 휠을 조작하는 동안 화면 스크롤을 잠근다(네이티브).
  const [scrollEnabled, setScrollEnabled] = useState(true);
  // 수정 시 폼에 노출하지 않는 필드(출퇴근 GPS 위치 등)를 잃지 않도록 원본 기록을 보관한다.
  const existingRef = useRef<AttendanceRecord | null>(null);
  const [history, setHistory] = useState<AttendanceChange[]>([]);
  const numericNav = useNumericInputNavigation(NUMERIC_FIELDS);

  useEffect(() => {
    (async () => {
      if (editingId) {
        setHistory(await getAttendanceHistory(editingId));
        const record = await getAttendanceRecord(editingId);
        if (!record) {
          // 알림 등으로 이 화면에 들어왔지만 대상 기록이 이미 삭제된 경우.
          // 빈 폼을 열지 않고(빈 기록 생성 방지) 안내 후 이전 화면으로 돌아간다.
          Alert.alert('기록을 찾을 수 없어요', '해당 근무 기록이 삭제되었거나 존재하지 않아요.', [
            { text: '확인', onPress: () => navigation.goBack() },
          ]);
          return; // setLoaded(true)도 하지 않아 폼이 그려지지 않는다
        }
        existingRef.current = record;
        setDate(record.date);
        setClockIn(record.clockIn);
        setClockOut(record.clockOut);
        setBreakMinutes(clampBreakMinutes(record.breakMinutes));
        setIsHoliday(record.isHoliday ?? false);
      } else {
        const workplace = await getWorkplace(workplaceId);
        if (workplace) setBreakMinutes(clampBreakMinutes(workplace.breakMinutesPerShift));
      }
      setLoaded(true);
    })();
  }, [editingId, workplaceId, navigation]);

  const isShortShift = TIME_RE.test(clockIn) && TIME_RE.test(clockOut) && shiftDurationMinutes(clockIn, clockOut) < BREAK_REQUIRED_MINUTES;

  useEffect(() => {
    if (isShortShift && breakMinutes !== 0) setBreakMinutes(0);
  }, [isShortShift]);

  const insets = useSafeAreaInsets();

  if (!loaded) return <LoadingScreen />;

  const handleSave = async () => {
    // 편집 모드인데 원본 기록이 사라졌다면(삭제 등) 빈 기록을 새로 만들지 않도록 방어한다.
    if (editingId && !existingRef.current) {
      Alert.alert('기록을 찾을 수 없어요', '해당 근무 기록이 삭제되었거나 존재하지 않아요.', [
        { text: '확인', onPress: () => navigation.goBack() },
      ]);
      return;
    }
    if (!DATE_RE.test(date)) {
      Alert.alert('날짜를 YYYY-MM-DD 형식으로 입력해주세요.');
      return;
    }
    if (!TIME_RE.test(clockIn)) {
      Alert.alert('출근 시간을 HH:mm 형식으로 입력해주세요.');
      return;
    }
    if (clockOut && !TIME_RE.test(clockOut)) {
      Alert.alert('퇴근 시간을 HH:mm 형식으로 입력해주세요.');
      return;
    }

    const record: AttendanceRecord = {
      // 폼에 없는 필드(출퇴근 GPS 위치 등)는 원본에서 이어받아 수정 시 유실되지 않게 한다.
      ...(existingRef.current ?? {}),
      id: editingId ?? makeId(),
      workplaceId,
      date,
      clockIn,
      clockOut,
      breakMinutes,
      isHoliday,
    };
    // 기록 화면 편집은 'manual' 소스로 변경 이력을 남긴다.
    await saveAttendanceWithHistory(record, 'manual');
    // 퇴근이 비어 있으면(진행 중) 미퇴근 알림을 예약, 채워졌으면 취소한다(best-effort).
    if (!clockOut) {
      const [workplace, shifts] = await Promise.all([getWorkplace(workplaceId), getScheduledShifts()]);
      const shift = shifts.find((s) => s.workplaceId === workplaceId && s.date === date);
      if (workplace) scheduleMissingClockOutReminder(record, workplace.name, shift).catch(() => {});
    } else {
      cancelMissingClockOutReminder(record.id).catch(() => {});
    }
    navigation.goBack();
  };

  const handleDelete = () => {
    if (!editingId) return;
    Alert.alert('기록 삭제', '이 근무 기록을 삭제할까요?', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: async () => {
          await deleteAttendance(editingId);
          cancelMissingClockOutReminder(editingId).catch(() => {});
          navigation.goBack();
        },
      },
    ]);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingBottom: spacing.xl * 2 + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
        scrollEnabled={scrollEnabled}
      >
        <Text style={styles.label}>날짜</Text>
        <Pressable
          onPress={() => setCalendarVisible(true)}
          accessibilityRole="button"
          accessibilityLabel="날짜 선택"
        >
          <View pointerEvents="none">
            <FieldInput icon="calendar-outline" value={date} onChangeText={() => {}} placeholder="날짜 선택" />
          </View>
        </Pressable>
        <CalendarPickerModal
          visible={calendarVisible}
          value={date}
          onClose={() => setCalendarVisible(false)}
          onSelect={setDate}
        />

        <Text style={styles.label}>출근 시간</Text>
        <FieldInput
          {...numericNav.getFieldProps('clockIn')}
          icon="log-in-outline"
          value={clockIn}
          onChangeText={(text) => setClockIn(formatTimeInput(text))}
          keyboardType="number-pad"
          placeholder="09:00"
        />

        <Text style={styles.label}>퇴근 시간</Text>
        <FieldInput
          {...numericNav.getFieldProps('clockOut')}
          icon="log-out-outline"
          value={clockOut}
          onChangeText={(text) => setClockOut(formatTimeInput(text))}
          keyboardType="number-pad"
          placeholder="18:00 (미입력 시 근무 중으로 기록)"
        />

        <Text style={styles.label}>휴게시간</Text>
        <WheelPicker
          min={0}
          max={60}
          step={10}
          value={breakMinutes}
          onChange={setBreakMinutes}
          suffix="분"
          disabled={isShortShift}
          onActiveChange={(active) => setScrollEnabled(!active)}
        />
        <Text style={styles.help}>
          {isShortShift
            ? '4시간 미만 근무는 휴게시간을 선택할 수 없어요.'
            : '4시간 미만 근무는 휴게시간이 자동으로 반영되지 않아요.'}
        </Text>

        <View style={styles.switchCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.switchLabel}>휴일근로</Text>
            <Text style={styles.switchHelp}>공휴일·약정휴일 근무. 5인 이상 사업장이면 휴일 가산수당이 반영돼요.</Text>
          </View>
          <Switch
            value={isHoliday}
            onValueChange={setIsHoliday}
            trackColor={{ true: colors.primary, false: colors.border }}
            thumbColor="#fff"
          />
        </View>

        <Pressable
          style={styles.saveButton}
          onPress={handleSave}
          accessibilityRole="button"
          accessibilityLabel={editingId ? '수정 완료' : '기록 추가'}
        >
          <Text style={styles.saveButtonText}>{editingId ? '수정 완료' : '기록 추가'}</Text>
        </Pressable>

        {editingId && (
          <Pressable
            style={styles.deleteButton}
            onPress={handleDelete}
            accessibilityRole="button"
            accessibilityLabel="기록 삭제"
          >
            <Ionicons name="trash-outline" size={14} color={colors.danger} />
            <Text style={styles.deleteButtonText}>기록 삭제</Text>
          </Pressable>
        )}

        {editingId && history.length > 0 && (
          <View style={styles.historyCard}>
            <View style={styles.historyTitleRow}>
              <Ionicons name="time-outline" size={14} color={colors.subtext} />
              <Text style={styles.historyTitle}>변경 이력</Text>
            </View>
            {history.map((h) => (
              <View key={h.id} style={styles.historyItem}>
                <View style={styles.historyHead}>
                  <Text style={styles.historyOp}>{h.op === 'create' ? '최초 기록' : '수정'}</Text>
                  <Text style={styles.historyMeta}>
                    {SOURCE_LABEL[h.source] ?? h.source} · {fmtWhen(h.changedAt)}
                  </Text>
                </View>
                {h.op === 'create' ? (
                  <Text style={styles.historyLine}>기록을 처음 생성했어요.</Text>
                ) : (
                  h.changes.map((c) => (
                    <Text key={c.field} style={styles.historyLine}>
                      {FIELD_LABELS[c.field as AuditedField] ?? c.field}: {formatChangeValue(c.field, c.before)} → {formatChangeValue(c.field, c.after)}
                    </Text>
                  ))
                )}
                {h.reason ? <Text style={styles.historyReason}>사유: {h.reason}</Text> : null}
              </View>
            ))}
            <Text style={styles.historyHelp}>이 기기에 저장된 변경 기록이에요. 서버로 전송되지 않아요.</Text>
          </View>
        )}
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
  label: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: spacing.xs },
  help: { fontSize: 12, color: colors.subtext, marginTop: -spacing.xs, marginBottom: spacing.md },
  switchCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm + 4,
    marginBottom: spacing.md,
  },
  switchLabel: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: 2 },
  switchHelp: { fontSize: 12, color: colors.subtext, paddingRight: spacing.sm },
  saveButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 6,
    alignItems: 'center',
    marginTop: spacing.md,
    ...shadow.card,
  },
  saveButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
  },
  deleteButtonText: { color: colors.danger, fontWeight: '600', fontSize: 13 },
  historyCard: {
    marginTop: spacing.lg,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm + 4,
  },
  historyTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm },
  historyTitle: { fontSize: 13, fontWeight: '700', color: colors.text },
  historyItem: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingVertical: spacing.sm,
  },
  historyHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
  historyOp: { fontSize: 12, fontWeight: '700', color: colors.primaryDark },
  historyMeta: { fontSize: 11, color: colors.subtext },
  historyLine: { fontSize: 12, color: colors.text, lineHeight: 18 },
  historyReason: { fontSize: 12, color: colors.subtext, fontStyle: 'italic', marginTop: 2 },
  historyHelp: { fontSize: 11, color: colors.subtext, marginTop: spacing.sm },
});
