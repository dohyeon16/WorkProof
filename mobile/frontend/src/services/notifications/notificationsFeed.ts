import { getAllAttendance, getAllPayRecords, getReadNotificationIds, getScheduledShifts, getWorkplaces } from '../storage/storage';
import { currentYearMonth, nextPayDate, shiftYearMonth, todayDateString } from '../../utils/date';
import { deriveNotifications, type AppNotification } from './deriveNotifications';
import { deriveWorktimeNotices } from '../../features/insights/weeklyWorktime';

// 백엔드가 없으므로 알림은 저장된 데이터(근무지/근태/급여)에서 그때그때 파생한다.
// 파생 규칙 자체는 순수 함수(deriveNotifications)로 분리해 자동 검증 대상이 되게 하고,
// 여기서는 저장소 조회와 시간 컨텍스트 주입만 담당한다.
export type { AppNotification } from './deriveNotifications';

/** 급여일이 임박(3일 이내)했거나 지난달 입금액이 비어있는 등, 지금 확인할 만한 알림 목록. */
export async function buildNotifications(): Promise<AppNotification[]> {
  const [workplaces, payRecords, attendance, shifts, readIds] = await Promise.all([
    getWorkplaces(),
    getAllPayRecords(),
    getAllAttendance(),
    getScheduledShifts(),
    getReadNotificationIds(),
  ]);
  const today = todayDateString();
  const thisMonth = currentYearMonth();
  const base = deriveNotifications({
    workplaces,
    payRecords,
    attendance,
    readIds,
    today,
    thisMonth,
    lastMonth: shiftYearMonth(thisMonth, -1),
    daysUntilPayday: (payDay) => nextPayDate(payDay).daysUntil,
  });
  // Phase 4B: 이번 주 근무시간 기반 정보성 안내(주휴 요건/40시간 근접·초과)를 합친다.
  const worktime = deriveWorktimeNotices({ workplaces, records: attendance, shifts, readIds, today, now: Date.now() });
  return [...base, ...worktime].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
}

/** 안 읽은 알림 개수 (홈 화면 벨 배지용). */
export async function getUnreadCount(): Promise<number> {
  const items = await buildNotifications();
  return items.filter((n) => !n.read).length;
}
