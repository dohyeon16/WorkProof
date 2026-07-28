import { appliedBreakMinutes, calcMonthlySummary, formatMinutesAsHours, formatWon } from './payCalc';
import { AttendanceRecord, EvidenceFile, IncomeDeductionType, PayRecord, Workplace } from './types';
import { formatYearMonth } from './utils/date';

const DEDUCTION_LABELS: Record<IncomeDeductionType, string> = {
  none: '없음',
  withholding: '3.3% 원천징수',
  insurance: '4대보험',
};

export function buildReportHtml(
  workplace: Workplace,
  records: AttendanceRecord[],
  yearMonth: string,
  payRecord: PayRecord | undefined,
  evidenceFiles: EvidenceFile[] = []
): string {
  const summary = calcMonthlySummary(records, workplace, yearMonth);

  const rows = summary.dailyBreakdown
    .map((d) => {
      const rec = records.find((r) => r.date === d.date);
      return `
        <tr>
          <td>${d.date}</td>
          <td>${rec ? `${rec.clockIn} ~ ${rec.clockOut}` : '-'}</td>
          <td>${rec ? appliedBreakMinutes(rec) : 0}분</td>
          <td>${formatMinutesAsHours(d.workedMinutes)}</td>
        </tr>`;
    })
    .join('');

  const hasActual = payRecord?.actualPay != null;
  const diff = payRecord?.diff ?? null;
  const diffLabel =
    diff === null
      ? '실제 입금액 미입력'
      : diff === 0
      ? '차액 없음'
      : diff < 0
      ? `부족 ${formatWon(Math.abs(diff))}`
      : `초과 ${formatWon(diff)}`;

  const checklistHtml =
    payRecord?.checklist && payRecord.checklist.length > 0
      ? `<ul>${payRecord.checklist
          .map((c) => `<li>${c.status === 'risk' ? '⚠ 위험' : '✔ 양호'} — ${c.label}</li>`)
          .join('')}</ul>`
      : '<p>차액이 없어 확인 항목이 없습니다.</p>';

  const evidenceHtml =
    evidenceFiles.length > 0
      ? `<ul>${evidenceFiles.map((f) => `<li>${f.name}</li>`).join('')}</ul>`
      : '<p>첨부된 증빙 자료가 없습니다.</p>';

  return `
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body { font-family: -apple-system, sans-serif; color: #1B1F1E; padding: 32px; }
          h1 { color: #1F9C82; font-size: 22px; margin-bottom: 4px; }
          h2 { font-size: 16px; margin-top: 28px; border-bottom: 2px solid #1F9C82; padding-bottom: 6px; }
          .subtitle { color: #6B7573; font-size: 13px; margin-bottom: 24px; }
          table { width: 100%; border-collapse: collapse; margin-top: 8px; }
          th, td { border: 1px solid #E3E7E5; padding: 8px; font-size: 12px; text-align: left; }
          th { background: #F7F9F8; }
          .pay-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 14px; }
          .diff { font-size: 18px; font-weight: bold; margin-top: 12px; }
          .note { font-size: 11px; color: #6B7573; margin-top: 32px; border-top: 1px solid #E3E7E5; padding-top: 12px; }
        </style>
      </head>
      <body>
        <h1>WorkProof 근무·급여 증빙 리포트</h1>
        <div class="subtitle">근무지: ${workplace.name} · 대상 기간: ${formatYearMonth(yearMonth)}</div>

        <h2>근무 조건</h2>
        <div class="pay-row"><span>시급</span><span>${formatWon(workplace.hourlyWage)}</span></div>
        <div class="pay-row"><span>급여일</span><span>매월 ${workplace.payDay}일</span></div>
        <div class="pay-row"><span>주휴수당 적용</span><span>${
          workplace.weeklyAllowance ? '적용' : '미적용'
        }</span></div>
        <div class="pay-row"><span>연장근로 가산(5인 이상)</span><span>${
          workplace.fiveOrMoreEmployees ? '적용' : '미적용'
        }</span></div>

        <h2>근무 기록</h2>
        <table>
          <tr><th>날짜</th><th>출퇴근 시간</th><th>휴게시간</th><th>실 근무시간</th></tr>
          ${rows || '<tr><td colspan="4">기록 없음</td></tr>'}
        </table>

        <h2>급여 비교</h2>
        <div class="pay-row"><span>기본급</span><span>${formatWon(summary.basePay)}</span></div>
        ${
          summary.weeklyAllowancePay > 0
            ? `<div class="pay-row"><span>주휴수당(간이 계산)</span><span>${formatWon(
                summary.weeklyAllowancePay
              )}</span></div>`
            : ''
        }
        ${
          summary.overtimePay > 0
            ? `<div class="pay-row"><span>연장근로 가산수당(간이 계산)</span><span>${formatWon(
                summary.overtimePay
              )}</span></div>`
            : ''
        }
        ${
          summary.nightPay > 0
            ? `<div class="pay-row"><span>야간근로 가산수당(간이 계산)</span><span>${formatWon(
                summary.nightPay
              )}</span></div>`
            : ''
        }
        ${
          summary.holidayPay > 0
            ? `<div class="pay-row"><span>휴일근로 가산수당(간이 계산)</span><span>${formatWon(
                summary.holidayPay
              )}</span></div>`
            : ''
        }
        <div class="pay-row"><span><b>예상 급여${
          summary.deductionType !== 'none' ? ' (세전)' : ''
        }</b></span><span><b>${formatWon(summary.expectedPay)}</b></span></div>
        ${
          summary.deductionType !== 'none'
            ? `<div class="pay-row"><span>예상 공제 (${DEDUCTION_LABELS[summary.deductionType]})</span><span>- ${formatWon(
                summary.deductionPay
              )}</span></div>
        <div class="pay-row"><span><b>세후 예상 실수령</b></span><span><b>${formatWon(
          summary.netExpectedPay
        )}</b></span></div>`
            : ''
        }
        <div class="pay-row"><span>실제 입금액</span><span>${
          hasActual ? formatWon(payRecord!.actualPay as number) : '미입력'
        }</span></div>
        <div class="diff">차액: ${diffLabel}</div>

        <h2>차액 분석 - 확인 필요 항목</h2>
        ${checklistHtml}

        <h2>첨부 자료</h2>
        ${evidenceHtml}

        <div class="note">
          본 리포트는 사용자의 근무 기록을 바탕으로 자동 생성된 개인 기록 자료이며, 법적 판단을 대신하지 않습니다.
          급여 차이가 발생한 경우, 본 리포트를 바탕으로 사업주에게 급여 산정 기준을 먼저 확인해보세요.<br/>
          생성 일시: ${new Date().toLocaleString('ko-KR')}
        </div>
      </body>
    </html>
  `;
}
