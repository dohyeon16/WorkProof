import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../components/Text';
import { FieldInput } from '../components/FieldInput';
import { InputAccessoryToolbar } from '../components/InputAccessoryToolbar';
import { useNumericInputNavigation } from '../hooks/useNumericInputNavigation';
import { WheelPicker } from '../components/WheelPicker';
import { CalendarPickerModal } from '../components/CalendarPickerModal';
import { Ionicons } from '@expo/vector-icons';
import { Alert } from '../alert';
import type { RootScreenProps } from '../navigation/types';
import { getAttendanceRecord, getWorkplace, deleteAttendance, makeId, saveAttendance } from '../storage';
import type { AttendanceRecord } from '../types';
import { formatTimeInput, todayDateString } from '../utils/date';
import { BREAK_REQUIRED_MINUTES, shiftDurationMinutes } from '../payCalc';
import { colors, radius, shadow, spacing } from '../theme';
import { LoadingScreen } from '../components/LoadingScreen';

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
  const numericNav = useNumericInputNavigation(NUMERIC_FIELDS);

  useEffect(() => {
    (async () => {
      if (editingId) {
        const record = await getAttendanceRecord(editingId);
        if (record) {
          setDate(record.date);
          setClockIn(record.clockIn);
          setClockOut(record.clockOut);
          setBreakMinutes(clampBreakMinutes(record.breakMinutes));
        }
        existingRef.current = record;
        setIsHoliday(record.isHoliday ?? false);
      } else {
        const workplace = await getWorkplace(workplaceId);
        if (workplace) setBreakMinutes(clampBreakMinutes(workplace.breakMinutesPerShift));
      }
      setLoaded(true);
    })();
  }, [editingId, workplaceId]);

  const isShortShift = TIME_RE.test(clockIn) && TIME_RE.test(clockOut) && shiftDurationMinutes(clockIn, clockOut) < BREAK_REQUIRED_MINUTES;

  useEffect(() => {
    if (isShortShift && breakMinutes !== 0) setBreakMinutes(0);
  }, [isShortShift]);

  const insets = useSafeAreaInsets();

  if (!loaded) return <LoadingScreen />;

  const handleSave = async () => {
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

    await saveAttendance({
      // 폼에 없는 필드(출퇴근 GPS 위치 등)는 원본에서 이어받아 수정 시 유실되지 않게 한다.
      ...(existingRef.current ?? {}),
      id: editingId ?? makeId(),
      workplaceId,
      date,
      clockIn,
      clockOut,
      breakMinutes,
      isHoliday,
    });
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
});
