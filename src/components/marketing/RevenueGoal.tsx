'use client';
import Link from 'next/link';
import { useState } from 'react';
import { api, useApi } from '@/components/client';
import { Button, cx, inputCls, toast } from '@/components/ui';

/** 대표 10/20 20:00 ③ 월 매출 목표 vs 실적(영업 계약 등록 금액 + 플랫폼 회사는 워크인 결제) — 마케팅·영업 홈 공용 막대. 목표는 대표가 달마다 적는다 */
export type RevenueOption = { key: string; label: string; target: number; rationale: string };
export type Revenue = { month: string; target: number | null; note: string | null; suggest?: { at: string; source: string; options: RevenueOption[]; summary: string } | null; actual: number; contracts: { amount: number; n: number }; workin: { amount: number; n: number } | null; rate: number | null };
const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`;
export function RevenueGoal({ color = '#7C3AED', canEdit, month }: { color?: string; canEdit: boolean; month?: string }) {
  const { data, error, reload } = useApi<Revenue>(`/api/marketing/ops/revenue${month ? `?month=${month}` : ''}`, [month]);
  const [edit, setEdit] = useState(false); const [v, setV] = useState(''); const [busy, setBusy] = useState(false); const [showSuggest, setShowSuggest] = useState(false);
  if (error || !data) return null;
  // 대표 03:00 ①: AI 마케터가 보수/기본/도전 3안 추천(근거: 지난 3달 계약·파이프라인·워크인 가입·광고 예산) → 고르면 입력칸에 채움 → [저장]
  async function recommend() {
    if (!data) return; setBusy(true);
    try { const r = await api<{ source: string; options: RevenueOption[] }>('/api/marketing/ops/revenue/recommend', { body: { month: data.month } }); toast.ok(r.source === 'ai' ? 'AI 마케터 추천 3안' : '기본 계산 3안(AI 없이)'); setShowSuggest(true); reload(); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
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
        {canEdit && !edit && <span className="ml-auto flex items-center gap-2"><button type="button" className="text-xs underline" onClick={recommend} disabled={busy} data-testid="revenue-recommend">AI 추천 받기</button><button type="button" className="text-xs underline" onClick={() => { setV(String(data.target ?? '')); setEdit(true); }} data-testid="revenue-edit">{data.target ? '목표 고치기' : '목표 적기'}</button></span>}
        {edit && <span className="ml-auto flex items-center gap-1"><input className={cx(inputCls, 'h-8 w-36 py-0 text-sm')} value={v} onChange={(e) => setV(e.target.value)} inputMode="numeric" placeholder="원" aria-label="월 매출 목표(원)" data-testid="revenue-target" />
          <Button size="sm" onClick={save} disabled={busy} data-testid="revenue-save">저장</Button><Button size="sm" variant="secondary" onClick={() => setEdit(false)}>취소</Button></span>}
        {!canEdit && !data.target && <Link href="/s/marketing/ops" className="ml-auto text-[11px] text-ink-3">목표 없음</Link>}
      </div>
      {canEdit && data.suggest?.options?.length && (showSuggest || !data.target) ? <div className="mt-2 rounded-input border border-violet-200 bg-violet-50/40 p-2 text-xs" data-testid="revenue-suggest">
        <div className="flex flex-wrap items-center gap-1.5"><b className="text-violet-800">AI 추천</b>{data.suggest.options.map((o) => <button key={o.key} type="button" title={o.rationale} onClick={() => { setV(String(o.target)); setEdit(true); setShowSuggest(false); }} className="rounded-full border border-violet-300 bg-white px-2.5 py-0.5 tabular-nums hover:bg-violet-100" data-testid={`revenue-option-${o.key}`}>{o.label} {won(o.target)}</button>)}
          <span className="text-[11px] text-ink-3">고르면 입력칸에 채워집니다 — 확인·수정 후 [저장]</span></div>
        <p className="mt-1 text-[11px] text-ink-2">{data.suggest.summary}</p>
        <ul className="mt-0.5 text-[11px] text-ink-3">{data.suggest.options.map((o) => <li key={o.key}>{o.label}: {o.rationale}</li>)}</ul></div> : null}
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} /></div>
    </section>
  );
}
