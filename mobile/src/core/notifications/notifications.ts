import { Platform } from 'react-native';
import type { AttendanceRecord, ScheduledShift, Workplace } from '../domain/models/types';
import { isExpoGo } from '../../shared/utils/expoGo';
import {
  inProgressRecords,
  missingClockOutId,
  planMissingClockOut,
} from '../../features/attendance/missingClockOut/schedule';

const PAYDAY_REMINDER_ID_PREFIX = 'payday-reminder-';
const PAYDAY_REMINDER_HOUR = 10;
const SHIFT_REMINDER_ID_PREFIX = 'shift-reminder-';

/** MONTHLY 트리거는 day를 "이번 달" 일수 기준으로 검증하므로, 31일처럼 없는 달이 있는 값은 28로 낮춰 매달 항상 유효하게 만든다. */
function safeMonthlyDay(payDay: number): number {
  return Math.min(Math.max(payDay, 1), 28);
}

/**
 * expo-notifications는 임포트되는 순간(모듈 최상단 부수효과로) 원격 푸시 토큰 리스너를 등록하는데,
 * 이 과정에서 SDK 53+ Android Expo Go에서는 예외를 던진다. 그래서 해당 조합에서는 아예 임포트하지 않는다.
 */
function isRemotePushUnavailable(): boolean {
  return Platform.OS === 'android' && isExpoGo();
}

let handlerRegistered = false;

async function loadNotifications(): Promise<typeof import('expo-notifications') | null> {
  if (Platform.OS === 'web') return null;
  if (isRemotePushUnavailable()) {
    console.log('[notifications] Remote push skipped in Expo Go');
    return null;
  }

  const Notifications = await import('expo-notifications');
  if (!handlerRegistered) {
    handlerRegistered = true;
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
  }
  return Notifications;
}

export async function schedulePaydayReminder(workplace: Workplace): Promise<void> {
  const Notifications = await loadNotifications();
  if (!Notifications) return;

  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: '기본 알림',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const identifier = `${PAYDAY_REMINDER_ID_PREFIX}${workplace.id}`;
  await Notifications.cancelScheduledNotificationAsync(identifier).catch(() => {});

  await Notifications.scheduleNotificationAsync({
    identifier,
    content: {
      title: '오늘은 급여일이에요',
      body: `${workplace.name}의 급여가 들어왔는지 확인하고 예상 금액과 비교해보세요.`,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.MONTHLY,
      day: safeMonthlyDay(workplace.payDay),
      hour: PAYDAY_REMINDER_HOUR,
      minute: 0,
    },
  });
}

export async function cancelPaydayReminder(workplaceId: string): Promise<void> {
  const Notifications = await loadNotifications();
  if (!Notifications) return;
  await Notifications.cancelScheduledNotificationAsync(`${PAYDAY_REMINDER_ID_PREFIX}${workplaceId}`).catch(() => {});
}

/**
 * 예정 근무의 출근 리마인더를 예약한다. 출근 시각에서 reminderMinutes 분 전에 울린다.
 * 이미 지난 시각이거나 reminderMinutes가 0이면 예약하지 않는다(기존 예약은 먼저 취소).
 */
export async function scheduleShiftReminder(shift: ScheduledShift, workplaceName: string): Promise<void> {
  const Notifications = await loadNotifications();
  if (!Notifications) return;

  const identifier = `${SHIFT_REMINDER_ID_PREFIX}${shift.id}`;
  await Notifications.cancelScheduledNotificationAsync(identifier).catch(() => {});

  if (!shift.reminderMinutes || shift.reminderMinutes <= 0) return;

  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return;

  const start = new Date(`${shift.date}T${shift.startTime}:00`);
  const fireAt = new Date(start.getTime() - shift.reminderMinutes * 60 * 1000);
  if (Number.isNaN(fireAt.getTime()) || fireAt.getTime() <= Date.now()) return; // 이미 지난 알림은 예약 안 함

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: '기본 알림',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  await Notifications.scheduleNotificationAsync({
    identifier,
    content: {
      title: '곧 출근 시간이에요',
      body: `${workplaceName} · ${shift.startTime} 출근 예정이에요. 준비하고 출퇴근을 기록해보세요.`,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: fireAt,
    },
  });
}

export async function cancelShiftReminder(shiftId: string): Promise<void> {
  const Notifications = await loadNotifications();
  if (!Notifications) return;
  await Notifications.cancelScheduledNotificationAsync(`${SHIFT_REMINDER_ID_PREFIX}${shiftId}`).catch(() => {});
}

/** 알림 권한이 이미 허용된 상태라면, 등록된 모든 근무지의 급여일 알림을 다시 예약(설정 변경 반영)한다. */
export async function rescheduleAllPaydayReminders(workplaces: Workplace[]): Promise<void> {
  const Notifications = await loadNotifications();
  if (!Notifications) return;
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return;
  await Promise.all(workplaces.map((w) => schedulePaydayReminder(w)));
}

// ---------- 미퇴근(퇴근 미기록) 알림 ----------
// 진행 중(퇴근 전) 기록에 대해, 예정 종료시간(또는 출근 후 일정 시간)에 맞춰 "퇴근 기록을
// 확인하세요" 로컬 푸시를 예약한다. 언제 울릴지는 순수 로직(planMissingClockOut)이 결정하고,
// 여기서는 예약/취소만 담당한다. identifier 로 항상 취소 후 재예약해 중복을 막는다.

/** 진행 중 기록의 미퇴근 알림을 예약한다. 이미 퇴근했거나 예약 시각이 지났으면 예약하지 않는다. */
export async function scheduleMissingClockOutReminder(
  record: AttendanceRecord,
  workplaceName: string,
  shift?: ScheduledShift
): Promise<void> {
  const Notifications = await loadNotifications();
  if (!Notifications) return;

  const identifier = missingClockOutId(record.id);
  await Notifications.cancelScheduledNotificationAsync(identifier).catch(() => {});

  const plan = planMissingClockOut({ record, shift, now: Date.now() });
  if (!plan.fire || plan.fireAt == null) return;

  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: '기본 알림',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  await Notifications.scheduleNotificationAsync({
    identifier,
    content: {
      title: '퇴근 기록을 확인해보세요',
      body: `${workplaceName} · ${record.clockIn} 출근 기록의 퇴근이 아직 비어 있어요. 퇴근했다면 시간을 채워 넣어보세요.`,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: new Date(plan.fireAt),
    },
  });
}

export async function cancelMissingClockOutReminder(recordId: string): Promise<void> {
  const Notifications = await loadNotifications();
  if (!Notifications) return;
  await Notifications.cancelScheduledNotificationAsync(missingClockOutId(recordId)).catch(() => {});
}

/**
 * 앱 시작 시(또는 권한 허용 후) 진행 중 기록들의 미퇴근 알림을 다시 예약한다.
 * 앱 재실행으로 예약이 날아가도 복원되게 한다. 과거로 지난 건은 planMissingClockOut 가 걸러낸다.
 */
export async function rescheduleMissingClockOutReminders(
  records: AttendanceRecord[],
  workplaces: Workplace[],
  shifts: ScheduledShift[]
): Promise<void> {
  const Notifications = await loadNotifications();
  if (!Notifications) return;
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return;
  const nameById = new Map(workplaces.map((w) => [w.id, w.name]));
  for (const r of inProgressRecords(records)) {
    const name = nameById.get(r.workplaceId);
    if (!name) continue; // 삭제된 근무지의 잔여 기록은 건너뛴다
    const shift = shifts.find((s) => s.workplaceId === r.workplaceId && s.date === r.date);
    await scheduleMissingClockOutReminder(r, name, shift);
  }
}

/**
 * 예약된 모든 로컬 알림을 취소한다(급여일·교대·미퇴근 리마인더 전부).
 *
 * 앱 초기화(모든 데이터 삭제) 시 호출한다. 초기화는 AsyncStorage 만 지우므로,
 * 이걸 부르지 않으면 근무지·예정근무·진행 중 기록이 사라진 뒤에도 이미 OS 에
 * 예약된 알림이 그대로 남아 나중에 발화한다(삭제한 데이터의 유령 알림). best-effort —
 * 로드 불가(web/Expo Go Android)나 실패 시 조용히 넘어가고 초기화 흐름은 계속한다.
 */
export async function cancelAllScheduledNotifications(): Promise<void> {
  const Notifications = await loadNotifications();
  if (!Notifications) return;
  await Notifications.cancelAllScheduledNotificationsAsync().catch(() => {});
}
