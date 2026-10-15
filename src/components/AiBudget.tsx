'use client';
import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { api } from './client';
import { Button, cx, toast } from './ui';

export type Budget = { limitKrw: number; usedKrw: number; remainingKrw: number; pct: number; todayKrw: number; dayLimitKrw: number; chatsLeft: number; docsLeft: number; extraKrw: number };
const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`;

/**
 * V23 4.3: AI 비서 위 "이번 달 남은 AI 6,420원 / 10,000원 · 대화 약 90회 · 문서 약 70건" 막대.
 * 다 쓰면 [추가 요청](대표 승인), 크레딧 소진이면 빨간 안내(V23-1). compact = 오른쪽 패널용 한 줄
 */
export function AiBudgetBar({ budget, creditMessage, compact, onChanged }: { budget?: Budget | null; creditMessage?: string | null; compact?: boolean; onChanged?: () => void }) {
  const [sent, setSent] = useState(false);
  if (creditMessage) return <div className={cx('flex items-start gap-1.5 rounded-input border border-red-200 bg-red-50 text-red-800', compact ? 'px-2 py-1 text-[11px]' : 'px-3 py-2 text-xs')} data-testid="ai-credit-banner"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{creditMessage}</div>;
  if (!budget) return null;
  const out = budget.usedKrw >= budget.limitKrw;
  const dayOut = !out && budget.todayKrw >= budget.dayLimitKrw;
  async function ask() {
    const v = prompt('추가로 요청할 이번 달 AI 금액(원)', '5000');
    if (!v) return;
    const amount = Math.round(Number(v.replace(/[^0-9]/g, '')));
    if (!amount || amount < 1000) { toast.error('1,000원 이상으로 적어 주세요'); return; }
    try { await api('/api/ai/limit-requests', { body: { amountKrw: amount, reason: prompt('이유(선택)') ?? undefined } }); setSent(true); toast.ok('대표에게 추가 요청을 보냈습니다'); onChanged?.(); }
    catch (e: any) { toast.error(e.message); }
  }
  const tone = out ? 'bg-red-500' : budget.pct >= 80 ? 'bg-amber-500' : 'bg-brand-600';
  return (
    <div className={cx('rounded-input border border-line bg-white', compact ? 'px-2 py-1' : 'px-3 py-2')} data-testid="ai-budget">
      <div className={cx('flex flex-wrap items-center gap-x-2 gap-y-0.5', compact ? 'text-[11px]' : 'text-xs')}>
        <span className="font-semibold text-ink">내 이번 달 남은 AI <span data-testid="ai-budget-left">{won(budget.remainingKrw)}</span> <span className="font-normal text-ink-3">/ {won(budget.limitKrw)}</span></span>
        {!out && <span className="text-ink-3">대화 약 {budget.chatsLeft.toLocaleString('ko-KR')}회 · 문서 약 {budget.docsLeft.toLocaleString('ko-KR')}건</span>}
        {dayOut && <span className="text-amber-700">오늘 한도({won(budget.dayLimitKrw)})를 다 썼습니다 — 내일 다시</span>}
        {out && (sent ? <span className="text-ink-3">추가 요청을 보냈습니다</span>
          : <Button size="sm" variant="secondary" className="h-6 px-2 text-[11px]" onClick={ask} data-testid="ai-limit-request">추가 요청</Button>)}
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={cx('h-full rounded-full', tone)} style={{ width: `${Math.min(100, budget.pct)}%` }} /></div>
    </div>
  );
}
export const costLine = (krw?: number) => (krw === undefined || krw === null ? null : `이번 요청 약 ${Math.max(0, Math.round(krw)).toLocaleString('ko-KR')}원`);
