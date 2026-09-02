import { getAllAttendance, getAllPayRecords, getReadNotificationIds, getWorkplaces } from '../data/storage';
import { currentYearMonth, nextPayDate, shiftYearMonth, todayDateString } from '../../shared/utils/date';
import { deriveNotifications, type AppNotification } from './deriveNotifications';

// 백엔드가 없으므로 알림은 저장된 데이터(근무지/근태/급여)에서 그때그때 파생한다.
// 파생 규칙 자체는 순수 함수(deriveNotifications)로 분리해 자동 검증 대상이 되게 하고,
// 여기서는 저장소 조회와 시간 컨텍스트 주입만 담당한다.
export type { AppNotification } from './deriveNotifications';

/** 급여일이 임박(3일 이내)했거나 지난달 입금액이 비어있는 등, 지금 확인할 만한 알림 목록. */
export async function buildNotifications(): Promise<AppNotification[]> {
  const [workplaces, payRecords, attendance, readIds] = await Promise.all([
    getWorkplaces(),
    getAllPayRecords(),
    getAllAttendance(),
    getReadNotificationIds(),
  ]);
  const thisMonth = currentYearMonth();
  return deriveNotifications({
    workplaces,
    payRecords,
    attendance,
    readIds,
    today: todayDateString(),
    thisMonth,
    lastMonth: shiftYearMonth(thisMonth, -1),
    daysUntilPayday: (payDay) => nextPayDate(payDay).daysUntil,
  });
}

/** 안 읽은 알림 개수 (홈 화면 벨 배지용). */
export async function getUnreadCount(): Promise<number> {
  const items = await buildNotifications();
  return items.filter((n) => !n.read).length;
}
