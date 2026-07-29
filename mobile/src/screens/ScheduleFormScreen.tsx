import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../shared/components/Text';
import { FieldInput } from '../shared/components/FieldInput';
import { InputAccessoryToolbar } from '../shared/components/InputAccessoryToolbar';
import { useNumericInputNavigation } from '../shared/hooks/useNumericInputNavigation';
import { CalendarPickerModal } from '../shared/components/CalendarPickerModal';
import { Ionicons } from '@expo/vector-icons';
import { Alert } from '../shared/components/alert';
import type { RootScreenProps } from '../app/navigation/types';
import {
  deleteScheduledShift,
  getScheduledShift,
  getWorkplace,
  makeId,
  saveScheduledShift,
} from '../core/data/storage';
import { cancelShiftReminder, scheduleShiftReminder } from '../core/notifications/notifications';
import { formatTimeInput, todayDateString } from '../shared/utils/date';
import { colors, radius, shadow, spacing } from '../shared/theme';
import { LoadingScreen } from '../shared/components/LoadingScreen';

type Props = RootScreenProps<'Schedule'>;

const NUMERIC_FIELDS = ['startTime', 'endTime'] as const;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

const REMINDER_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: '없음' },
  { value: 30, label: '30분 전' },
  { value: 60, label: '1시간 전' },
  { value: 120, label: '2시간 전' },
];

export default function ScheduleFormScreen({ navigation, route }: Props) {
  const { workplaceId, id: editingId } = route.params;
  const [loaded, setLoaded] = useState(false);
  const [workplaceName, setWorkplaceName] = useState('');
  const [date, setDate] = useState(todayDateString());
  const [calendarVisible, setCalendarVisible] = useState(false);
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [reminderMinutes, setReminderMinutes] = useState(60);
  const numericNav = useNumericInputNavigation(NUMERIC_FIELDS);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    (async () => {
      const workplace = await getWorkplace(workplaceId);
      setWorkplaceName(workplace?.name ?? '근무지');
      if (editingId) {
        const shift = await getScheduledShift(editingId);
        if (shift) {
          setDate(shift.date);
          setStartTime(shift.startTime);
          setEndTime(shift.endTime ?? '');
          setReminderMinutes(shift.reminderMinutes);
        }
      }
      setLoaded(true);
    })();
  }, [editingId, workplaceId]);

  if (!loaded) return <LoadingScreen />;

  const handleSave = async () => {
    if (!DATE_RE.test(date)) {
      Alert.alert('날짜를 선택해주세요.');
      return;
    }
    if (!TIME_RE.test(startTime)) {
      Alert.alert('출근 예정 시간을 HH:mm 형식으로 입력해주세요.');
      return;
    }
    if (endTime && !TIME_RE.test(endTime)) {
      Alert.alert('퇴근 예정 시간을 HH:mm 형식으로 입력해주세요.');
      return;
    }

    const shift = {
      id: editingId ?? makeId(),
      workplaceId,
      date,
      startTime,
      endTime: endTime || undefined,
      reminderMinutes,
      createdAt: new Date().toISOString(),
    };
    await saveScheduledShift(shift);
    // 리마인더 예약(권한/시각 조건은 내부에서 처리, 실패해도 저장은 유지).
    scheduleShiftReminder(shift, workplaceName).catch(() => {});
    navigation.goBack();
  };

  const handleDelete = () => {
    if (!editingId) return;
    Alert.alert('예정 근무 삭제', '이 예정 근무를 삭제할까요?', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: async () => {
          await deleteScheduledShift(editingId);
          cancelShiftReminder(editingId).catch(() => {});
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
      >
        <View style={styles.workplaceChip}>
          <Ionicons name="business-outline" size={14} color={colors.primaryDark} />
          <Text style={styles.workplaceChipText}>{workplaceName}</Text>
        </View>

        <Text style={styles.label}>날짜</Text>
        <Pressable onPress={() => setCalendarVisible(true)} accessibilityRole="button" accessibilityLabel="날짜 선택">
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

        <Text style={styles.label}>출근 예정 시간</Text>
        <FieldInput
          {...numericNav.getFieldProps('startTime')}
          icon="log-in-outline"
          value={startTime}
          onChangeText={(text) => setStartTime(formatTimeInput(text))}
          keyboardType="number-pad"
          placeholder="09:00"
        />

        <Text style={styles.label}>퇴근 예정 시간 (선택)</Text>
        <FieldInput
          {...numericNav.getFieldProps('endTime')}
          icon="log-out-outline"
          value={endTime}
          onChangeText={(text) => setEndTime(formatTimeInput(text))}
          keyboardType="number-pad"
          placeholder="18:00"
        />

        <Text style={styles.label}>출근 알림</Text>
        <View style={styles.segment}>
          {REMINDER_OPTIONS.map((opt) => {
            const active = reminderMinutes === opt.value;
            return (
              <Pressable
                key={opt.value}
                style={[styles.segmentItem, active && styles.segmentItemActive]}
                onPress={() => setReminderMinutes(opt.value)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={opt.label}
              >
                <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{opt.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.help}>출근 시간 전에 알림을 보내드려요. 알림 권한이 꺼져 있으면 울리지 않아요.</Text>

        <Pressable
          style={styles.saveButton}
          onPress={handleSave}
          accessibilityRole="button"
          accessibilityLabel={editingId ? '수정 완료' : '예정 추가'}
        >
          <Text style={styles.saveButtonText}>{editingId ? '수정 완료' : '예정 추가'}</Text>
        </Pressable>

        {editingId && (
          <Pressable
            style={styles.deleteButton}
            onPress={handleDelete}
            accessibilityRole="button"
            accessibilityLabel="예정 근무 삭제"
          >
            <Ionicons name="trash-outline" size={14} color={colors.danger} />
            <Text style={styles.deleteButtonText}>예정 근무 삭제</Text>
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
  workplaceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    backgroundColor: colors.primaryLight,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 5,
    marginBottom: spacing.md,
  },
  workplaceChipText: { fontSize: 12, fontWeight: '700', color: colors.primaryDark },
  label: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: spacing.xs },
  help: { fontSize: 12, color: colors.subtext, marginTop: spacing.xs, marginBottom: spacing.md },
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 3,
    gap: 3,
  },
  segmentItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
  },
  segmentItemActive: { backgroundColor: colors.primary },
  segmentText: { fontSize: 12, fontWeight: '700', color: colors.subtext },
  segmentTextActive: { color: '#fff' },
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
