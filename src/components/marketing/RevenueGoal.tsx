'use client';
import Link from 'next/link';
import { useState } from 'react';
import { api, useApi } from '@/components/client';
import { Button, cx, inputCls, toast } from '@/components/ui';

/** 대표 10/20 20:00 ③ 월 매출 목표 vs 실적(영업 계약 등록 금액 + 플랫폼 회사는 워크인 결제) — 마케팅·영업 홈 공용 막대. 목표는 대표가 달마다 적는다 */
export type Revenue = { month: string; target: number | null; note: string | null; actual: number; contracts: { amount: number; n: number }; workin: { amount: number; n: number } | null; rate: number | null };
const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`;
export function RevenueGoal({ color = '#7C3AED', canEdit, month }: { color?: string; canEdit: boolean; month?: string }) {
  const { data, error, reload } = useApi<Revenue>(`/api/marketing/ops/revenue${month ? `?month=${month}` : ''}`, [month]);
  const [edit, setEdit] = useState(false); const [v, setV] = useState(''); const [busy, setBusy] = useState(false);
  if (error || !data) return null;
  async function save() {
    if (!data) return; const n = Number(String(v).replace(/[^\d]/g, '')); if (!Number.isFinite(n)) { toast.error('숫자로 적어 주세요'); return; }
    setBusy(true);
    try { await api('/api/marketing/ops/revenue', { method: 'PUT', body: { month: data.month, target: n } }); toast.ok('매출 목표를 저장했습니다'); setEdit(false); reload(); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  const pct = data.target ? Math.min(100, Math.round((data.actual / data.target) * 100)) : 0;
  return (
    <section className="rounded-card border border-line bg-white p-3 shadow-card" data-testid="revenue-goal" data-month={data.month}>
      <div className="flex flex-wrap items-center gap-2 text-sm"><b>{Number(data.month.slice(5))}월 매출 목표</b>
        <span className="tabular-nums" data-testid="revenue-actual">{won(data.actual)}{data.target ? ` / ${won(data.target)} (${data.rate}%)` : ''}</span>
        <span className="text-[11px] text-ink-3">계약 {data.contracts.n}건 {won(data.contracts.amount)}{data.workin ? ` · 워크인 결제 ${data.workin.n}건 ${won(data.workin.amount)}` : ''}</span>
        {canEdit && !edit && <button type="button" className="ml-auto text-xs underline" onClick={() => { setV(String(data.target ?? '')); setEdit(true); }} data-testid="revenue-edit">{data.target ? '목표 고치기' : '목표 적기'}</button>}
        {edit && <span className="ml-auto flex items-center gap-1"><input className={cx(inputCls, 'h-8 w-36 py-0 text-sm')} value={v} onChange={(e) => setV(e.target.value)} inputMode="numeric" placeholder="원" aria-label="월 매출 목표(원)" data-testid="revenue-target" />
          <Button size="sm" onClick={save} disabled={busy} data-testid="revenue-save">저장</Button><Button size="sm" variant="secondary" onClick={() => setEdit(false)}>취소</Button></span>}
        {!canEdit && !data.target && <Link href="/s/marketing/ops" className="ml-auto text-[11px] text-ink-3">목표 없음</Link>}
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} /></div>
    </section>
  );
}
