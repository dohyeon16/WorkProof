import { Platform } from 'react-native';
import type { ScheduledShift, Workplace } from '../domain/models/types';
import { isExpoGo } from '../../shared/utils/expoGo';

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
