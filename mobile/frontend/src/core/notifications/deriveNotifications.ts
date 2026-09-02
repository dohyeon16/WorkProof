// 인앱 알림 파생(순수 로직 — 저장소/RN 의존 없음, node:test 대상).
// 저장 데이터(근무지/근태/급여)에서 "지금 확인할 만한" 알림 목록과 각 알림의
// 이동 대상(target/link)을 만든다. 시간 의존값(오늘/이번달/급여일까지 일수)은
// 호출부(notificationsFeed.ts)가 주입해 이 함수는 결정적으로 검증 가능하다.
import type { Ionicons } from '@expo/vector-icons';
import type { AttendanceRecord, PayRecord, Workplace } from '../domain/models/types';
import { formatWon } from '../domain/payroll/payCalc';
import { formatDateWithWeekday, formatYearMonth } from '../../shared/utils/date';

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

export interface NotificationsInput {
  workplaces: Workplace[];
  payRecords: PayRecord[];
  attendance: AttendanceRecord[];
  readIds: string[];
  today: string; // YYYY-MM-DD
  thisMonth: string; // YYYY-MM
  lastMonth: string; // YYYY-MM
  /** 해당 급여일(1-31)까지 남은 일수. 시간 의존을 주입으로 분리한다. */
  daysUntilPayday: (payDay: number) => number;
}

export function deriveNotifications(input: NotificationsInput): AppNotification[] {
  const { workplaces, payRecords, attendance, readIds, today, thisMonth, lastMonth } = input;
  const read = new Set(readIds);
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
    const daysUntil = input.daysUntilPayday(wp.payDay);
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
