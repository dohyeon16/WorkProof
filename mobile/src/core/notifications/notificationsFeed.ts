import { Ionicons } from '@expo/vector-icons';
import { getAllAttendance, getAllPayRecords, getReadNotificationIds, getWorkplaces } from '../data/storage';
import { formatWon } from '../domain/payroll/payCalc';
import { currentYearMonth, formatDateWithWeekday, formatYearMonth, nextPayDate, shiftYearMonth, todayDateString } from '../../shared/utils/date';

// 백엔드가 없으므로 알림은 저장된 데이터(근무지/근태/급여)에서 그때그때 파생한다.
// 각 알림은 안정적인 id를 가져 읽음 처리(배지 계산)에 쓰인다.
export interface AppNotification {
  id: string;
  icon: keyof typeof Ionicons.glyphMap;
  tone: 'info' | 'warning' | 'success';
  title: string;
  body: string;
  priority: number; // 작을수록 위에 노출
  read: boolean;
  // 탭했을 때 이동할 대상. hasPay면 급여 비교, 아니면 실제 입금액 입력으로 보낸다.
  target: { workplaceId: string; yearMonth: string; hasPay: boolean };
  // 급여 화면이 아니라 특정 근무 기록 등 다른 화면으로 보내야 할 때 사용(있으면 target보다 우선).
  link?: { screen: 'AttendanceForm'; params: { workplaceId: string; id: string } };
}

/** 급여일이 임박(3일 이내)했거나 지난달 입금액이 비어있는 등, 지금 확인할 만한 알림 목록. */
export async function buildNotifications(): Promise<AppNotification[]> {
  const [workplaces, payRecords, attendance, readIds] = await Promise.all([
    getWorkplaces(),
    getAllPayRecords(),
    getAllAttendance(),
    getReadNotificationIds(),
  ]);
  const read = new Set(readIds);
  const thisMonth = currentYearMonth();
  const lastMonth = shiftYearMonth(thisMonth, -1);
  const today = todayDateString();
  const nameById = new Map(workplaces.map((w) => [w.id, w.name]));
  const items: Omit<AppNotification, 'read'>[] = [];

  // 0) 퇴근 미기록 — 출근은 찍었는데 지난 날짜인데도 퇴근이 비어 있는 근무.
  for (const a of attendance) {
    if (!a.clockIn || a.clockOut || a.date >= today) continue;
    const name = nameById.get(a.workplaceId);
    if (!name) continue; // 삭제된 근무지의 잔여 기록은 건너뛴다
    items.push({
      id: `unclosed-${a.id}`,
      icon: 'time',
      tone: 'warning',
      title: '퇴근 기록이 빠졌어요',
      body: `${name} · ${formatDateWithWeekday(a.date)} 근무의 퇴근 시간이 비어 있어요. 지금 채워 넣어보세요.`,
      priority: 1,
      target: { workplaceId: a.workplaceId, yearMonth: a.date.slice(0, 7), hasPay: false },
      link: { screen: 'AttendanceForm', params: { workplaceId: a.workplaceId, id: a.id } },
    });
  }

  for (const wp of workplaces) {
    // 1) 급여일 임박/당일
    const { daysUntil } = nextPayDate(wp.payDay);
    if (daysUntil <= 3) {
      const thisMonthPay = payRecords.find((p) => p.workplaceId === wp.id && p.yearMonth === thisMonth);
      items.push({
        id: `payday-${wp.id}-${thisMonth}`,
        icon: 'calendar',
        tone: daysUntil === 0 ? 'warning' : 'info',
        title: daysUntil === 0 ? '오늘은 급여일이에요' : `급여일이 ${daysUntil}일 남았어요`,
        body: `${wp.name}의 급여가 들어오면 예상 금액과 비교해보세요.`,
        priority: daysUntil === 0 ? 0 : 2,
        target: { workplaceId: wp.id, yearMonth: thisMonth, hasPay: thisMonthPay != null },
      });
    }

    // 2) 차액(부족) 발생 — 실제 입금액을 입력했고 예상보다 적은 달
    for (const pay of payRecords) {
      if (pay.workplaceId !== wp.id) continue;
      if (pay.actualPay == null || pay.diff == null || pay.diff >= 0) continue;
      items.push({
        id: `shortfall-${wp.id}-${pay.yearMonth}`,
        icon: 'alert-circle',
        tone: 'warning',
        title: `${formatYearMonth(pay.yearMonth)} 급여가 예상보다 적어요`,
        body: `${wp.name} · ${formatWon(Math.abs(pay.diff))} 부족해요. 확인 항목을 살펴보세요.`,
        priority: 1,
        target: { workplaceId: wp.id, yearMonth: pay.yearMonth, hasPay: true },
      });
    }

    // 3) 지난달 실제 입금액 미입력 — 근무 기록은 있는데 입금액을 안 넣은 경우
    const hasLastMonthWork = attendance.some(
      (a) => a.workplaceId === wp.id && a.date.startsWith(lastMonth)
    );
    const lastMonthPay = payRecords.find((p) => p.workplaceId === wp.id && p.yearMonth === lastMonth);
    if (hasLastMonthWork && (lastMonthPay == null || lastMonthPay.actualPay == null)) {
      items.push({
        id: `unentered-${wp.id}-${lastMonth}`,
        icon: 'create',
        tone: 'info',
        title: `${formatYearMonth(lastMonth)} 실제 입금액을 입력해보세요`,
        body: `${wp.name}의 지난달 급여를 입력하면 예상 금액과 차액을 확인할 수 있어요.`,
        priority: 3,
        target: { workplaceId: wp.id, yearMonth: lastMonth, hasPay: lastMonthPay != null },
      });
    }
  }

  return items
    .map((item) => ({ ...item, read: read.has(item.id) }))
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
}

/** 안 읽은 알림 개수 (홈 화면 벨 배지용). */
export async function getUnreadCount(): Promise<number> {
  const items = await buildNotifications();
  return items.filter((n) => !n.read).length;
}
