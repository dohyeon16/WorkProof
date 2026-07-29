import { AttendanceRecord, EvidenceFile, IncomeDeductionType, PayRecord, Workplace } from './core/domain/models/types';
import { appliedBreakMinutes, calcMonthlySummary, formatMinutesAsHours, formatWon, shiftWorkedMinutes } from './core/domain/payroll/payCalc';
import { formatYearMonth } from './shared/utils/date';

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

/**
 * 임금체불 진정서 초안 HTML. 근무 기록에서 자동 채울 수 있는 사실관계(사업장·근무내역·차액)는 채우고,
 * 개인정보 등 사용자가 직접 써야 하는 칸은 빈칸(밑줄)으로 남긴다. 법적 효력을 갖는 서류가 아니라,
 * 고용노동부 진정 시 참고할 수 있는 초안이라는 점을 명확히 안내한다.
 */
export function buildComplaintHtml(
  workplace: Workplace,
  records: AttendanceRecord[],
  yearMonth: string,
  payRecord: PayRecord | undefined,
  evidenceFiles: EvidenceFile[] = []
): string {
  const summary = calcMonthlySummary(records, workplace, yearMonth);
  const actual = payRecord?.actualPay ?? null;
  const diff = payRecord?.diff ?? null;
  const unpaid = diff != null && diff < 0 ? Math.abs(diff) : 0;

  const workedDays = summary.dailyBreakdown.length;
  const firstDay = summary.dailyBreakdown[0]?.date ?? '-';
  const lastDay = summary.dailyBreakdown[summary.dailyBreakdown.length - 1]?.date ?? '-';

  const rows = summary.dailyBreakdown
    .map((d) => {
      const rec = records.find((r) => r.date === d.date);
      return `
        <tr>
          <td>${d.date}</td>
          <td>${rec ? `${rec.clockIn} ~ ${rec.clockOut || '-'}` : '-'}</td>
          <td>${rec ? formatMinutesAsHours(shiftWorkedMinutes(rec)) : '-'}</td>
        </tr>`;
    })
    .join('');

  const evidenceHtml =
    evidenceFiles.length > 0
      ? `<ol>${evidenceFiles.map((f) => `<li>${f.name}</li>`).join('')}</ol>`
      : '<p>(첨부 예정: 근로계약서 사본, 급여 입금 내역, 근무 기록 등)</p>';

  const blank = '<span class="blank">&nbsp;</span>';

  return `
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body { font-family: -apple-system, sans-serif; color: #1B1F1E; padding: 32px; line-height: 1.7; }
          h1 { text-align: center; font-size: 22px; margin-bottom: 24px; }
          h2 { font-size: 15px; margin-top: 24px; border-bottom: 2px solid #1F9C82; padding-bottom: 6px; }
          table { width: 100%; border-collapse: collapse; margin-top: 8px; }
          th, td { border: 1px solid #E3E7E5; padding: 8px; font-size: 12px; text-align: left; }
          th { background: #F7F9F8; }
          .field { margin: 4px 0; font-size: 13px; }
          .blank { display: inline-block; min-width: 160px; border-bottom: 1px solid #9AA5A2; }
          .amount { font-size: 18px; font-weight: bold; color: #C0392B; }
          .body-text { font-size: 13px; margin-top: 8px; }
          .note { font-size: 11px; color: #6B7573; margin-top: 32px; border-top: 1px solid #E3E7E5; padding-top: 12px; }
        </style>
      </head>
      <body>
        <h1>임 금 체 불 진 정 서 (초안)</h1>

        <h2>1. 진정인 (근로자)</h2>
        <div class="field">성명: ${blank}</div>
        <div class="field">연락처: ${blank}</div>
        <div class="field">주소: ${blank}</div>

        <h2>2. 피진정인 (사업주)</h2>
        <div class="field">사업장명: ${workplace.name || blank}</div>
        <div class="field">사업장 주소: ${workplace.address || blank}</div>
        <div class="field">대표자 성명: ${blank}</div>
        <div class="field">연락처: ${blank}</div>

        <h2>3. 근로 조건</h2>
        <div class="field">시급: ${formatWon(workplace.hourlyWage)}</div>
        <div class="field">근무 기간(대상): ${formatYearMonth(yearMonth)} (${firstDay} ~ ${lastDay}, ${workedDays}일 근무)</div>
        <div class="field">주휴수당 약정: ${workplace.weeklyAllowance ? '있음' : '없음/불명'}</div>

        <h2>4. 체불 임금 내역</h2>
        <div class="field">산정된 예상 급여(세전): ${formatWon(summary.expectedPay)}</div>
        <div class="field">실제 지급된 금액: ${actual != null ? formatWon(actual) : '미지급 / 미입력'}</div>
        <div class="field">미지급 추정액: <span class="amount">${formatWon(unpaid)}</span></div>
        <p class="body-text">
          ※ 위 금액은 진정인이 앱(WorkProof)에 기록한 근무 내역을 바탕으로 산정한 추정치이며,
          실제 체불액은 근로계약 내용과 사실관계에 따라 달라질 수 있습니다.
        </p>

        <h2>5. 근무 내역</h2>
        <table>
          <tr><th>날짜</th><th>근무 시간</th><th>실 근무</th></tr>
          ${rows || '<tr><td colspan="3">기록 없음</td></tr>'}
        </table>

        <h2>6. 진정 취지</h2>
        <p class="body-text">
          진정인은 위 사업장에서 근로를 제공하였으나 임금 일부(약 ${formatWon(unpaid)})를 지급받지 못하였는바,
          근로기준법에 따라 체불 임금이 조속히 지급될 수 있도록 조치하여 주시기 바랍니다.
        </p>

        <h2>7. 첨부 자료</h2>
        ${evidenceHtml}

        <div class="field" style="margin-top:24px; text-align:right;">
          작성일: ${new Date().toLocaleDateString('ko-KR')} &nbsp;&nbsp;&nbsp; 진정인: ${blank} (서명)
        </div>

        <div class="note">
          본 문서는 WorkProof가 사용자의 근무 기록으로 자동 생성한 <b>진정서 초안</b>이며, 법적 효력을 갖는 서류나 법률 자문이 아닙니다.
          실제 진정은 고용노동부 고객상담센터(국번 없이 1350) 또는 고용노동부 민원마당(minwon.moel.go.kr) 온라인 진정,
          관할 지방고용노동관서 방문을 통해 접수할 수 있습니다. 제출 전 내용을 반드시 사실에 맞게 검토·수정하세요.<br/>
          생성 일시: ${new Date().toLocaleString('ko-KR')}
        </div>
      </body>
    </html>
  `;
}
