'use client';
import { useState } from 'react';
import { useTerms } from './session';
import { AlertTriangle } from 'lucide-react';
import { api } from './client';
import { Button, cx, toast } from './ui';

export type Budget = { limitKrw: number; usedKrw: number; remainingKrw: number; pct: number; todayKrw: number; dayLimitKrw: number; chatsLeft: number; docsLeft: number; extraKrw: number };
/** 대표 10/24 ② 회사 월 AI 예산 — 직원에게는 %·다시 채워지는 날만(금액은 관리자 응답에만) · capPct = 대표가 정한 회사 한도(요금제 예산 대비 %) */
export type CompanyAi = { pct: number | null; over: boolean; resetLabel: string; message: string | null; limitKrw?: number | null; usedKrw?: number; leftKrw?: number | null; capPct?: number | null };
/** 351차 #939 ③(대표 11/04): 직원·관리자 화면에는 AI 를 원·회로 보이지 않음 — 쓴 % → 남은 양 % */
export const leftPct = (pct: number) => Math.max(0, 100 - Math.min(100, Math.round(pct)));

/**
 * V23 4.3 → 351차 #939 ③: AI 비서 위 "이번 달 AI 남은 양 99%" 막대(금액·횟수 없음 — 원 금액은 플랫폼 운영 화면에만).
 * 다 쓰면 [추가 요청](대표 승인), 크레딧 소진이면 빨간 안내(V23-1). compact = 오른쪽 패널용 한 줄
 */
export function AiBudgetBar({ budget, company, creditMessage, compact, onChanged }: { budget?: Budget | null; company?: CompanyAi | null; creditMessage?: string | null; compact?: boolean; onChanged?: () => void }) {
  const T = useTerms(); // 범용화 2단계: 회사별 용어(다짐은 지금 표현 그대로)
  const [sent, setSent] = useState(false);
  if (creditMessage) return <div className={cx('flex items-start gap-1.5 rounded-input border border-red-200 bg-red-50 text-red-800', compact ? 'px-2 py-1 text-[11px]' : 'px-3 py-2 text-xs')} data-testid="ai-credit-banner"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{creditMessage}</div>;
  // 회사 월 AI 예산을 다 썼으면 내 한도보다 먼저 안내(다음 달 1일 초기화), 80% 넘으면 한 줄 미리 알림
  if (company?.over && company.message) return <div className={cx('flex items-start gap-1.5 rounded-input border border-red-200 bg-red-50 text-red-800', compact ? 'px-2 py-1 text-[11px]' : 'px-3 py-2 text-xs')} data-testid="ai-company-banner"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{company.message}</div>;
  const near = company && company.pct !== null && company.pct >= 80 ? <div className={cx('mb-1 text-amber-700', compact ? 'text-[11px]' : 'text-xs')} data-testid="ai-company-near">회사 이번 달 AI 사용량 {company.pct}% — 100%가 되면 {company.resetLabel}까지 AI 기능이 멈춥니다</div> : null;
  if (!budget) return near;
  const out = budget.usedKrw >= budget.limitKrw;
  const dayOut = !out && budget.todayKrw >= budget.dayLimitKrw;
  const limitKrw = budget.limitKrw;
  async function ask() {
    // 요청 양은 이번 달 한도의 절반(화면에는 금액이 없음) — 대표가 사람별 AI 한도 칸에서 승인
    const reason = prompt(`${T.role.owner}에게 이번 달 AI 사용량 추가를 요청합니다. 이유(선택)`);
    if (reason === null) return;
    try { await api('/api/ai/limit-requests', { body: { amountKrw: Math.max(1000, Math.round(limitKrw * 0.5)), reason: reason.trim() || undefined } }); setSent(true); toast.ok('대표에게 추가 요청을 보냈습니다'); onChanged?.(); }
    catch (e: any) { toast.error(e.message); }
  }
  const tone = out ? 'bg-red-500' : budget.pct >= 80 ? 'bg-amber-500' : 'bg-brand-600';
  return (
    <div className={cx('rounded-input border border-line bg-white', compact ? 'px-2 py-1' : 'px-3 py-2')} data-testid="ai-budget">
      {near}
      <div className={cx('flex flex-wrap items-center gap-x-2 gap-y-0.5', compact ? 'text-[11px]' : 'text-xs')}>
        <span className="font-semibold text-ink">이번 달 AI 남은 양 <span data-testid="ai-budget-left">{leftPct(budget.pct)}%</span></span>
        {dayOut && <span className="text-amber-700">오늘 쓸 수 있는 양을 다 썼습니다 — 내일 다시</span>}
        {out && (sent ? <span className="text-ink-3">추가 요청을 보냈습니다</span>
          : <Button size="sm" variant="secondary" className="h-6 px-2 text-[11px]" onClick={ask} data-testid="ai-limit-request">추가 요청</Button>)}
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={cx('h-full rounded-full', tone)} style={{ width: `${Math.min(100, budget.pct)}%` }} /></div>
    </div>
  );
}
