'use client';
import Link from 'next/link';
import { useState } from 'react';
import { api, useApi } from '@/components/client';
import { Button, ErrorBox, Skeleton, cx, fmtDateTime, inputCls, toast } from '@/components/ui';
import { RevenueGoal } from './RevenueGoal';

/**
 * 대표 10/20 20:00 ① 마케팅 운영실: AI 마케터(30년차)가 운영을 맡되 분석·방향·협업·인플루언서·계획은 '승인 요청 카드'로 올리고, 대표가 [승인]해야 실행(계획·방향 → 제작의뢰실, 협업·인플루언서·분석 → 업무).
 * ② 광고 예산: 채널별 월 계획 초안 → 대표 승인 → 집행(연결된 네이버 캠페인 하루 예산, 나머지는 안내) · 소진율 80% 넘으면 '충전 필요' 알림(충전은 대표가 매체 사이트에서).
 * ③ 월 매출 목표 vs 실적 막대(RevenueGoal) + CAC·ROI 는 월간 보고.
 */
const C = '#7C3AED';
type Proposal = { id: string; kind: string; title: string; summary: string; body: { items: { title: string; detail: string; expected?: string; cost?: string }[]; rationale: string; numbers?: any }; status: string; source: string; decision_note: string | null; decided_by_name: string | null; decided_at: string | null; executed: any; created_at: string };
type Budget = { id: string; month: string; status: string; plan: { provider: string; label: string; monthly: number; daily: number; note: string; connected: boolean; charge: string | null; used: number; rate: number | null }[]; total: number; rationale: string | null; source: string; executed: any[] | null; approved_by_name: string | null; approved_at: string | null };
type View = { month: string; proposals: Proposal[]; budget: Budget | null; kinds: Record<string, string>; channels: Record<string, { label: string; charge: string }>; canEdit: boolean; months: string[] };
const STATUS: Record<string, [string, string]> = { pending: ['승인 대기', 'bg-orange-50 text-orange-800'], approved: ['승인됨', 'bg-emerald-50 text-emerald-800'], rejected: ['반려', 'bg-slate-100 text-ink-2'], done: ['실행 완료', 'bg-slate-100 text-ink-2'] };
const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`;
const mk = (m: string) => `${m.slice(0, 4)}년 ${Number(m.slice(5))}월`;

export function Ops() {
  const [month, setMonth] = useState('');
  const { data, error, reload } = useApi<View>(`/api/marketing/ops${month ? `?month=${month}` : ''}`, [month]);
  const [busy, setBusy] = useState(false);
  async function propose() {
    setBusy(true);
    try { const r = await api<{ created: number }>('/api/marketing/ops', { body: { kinds: ['analysis', 'direction', 'plan', 'collab', 'influencer'] } }); toast.ok(r.created ? `승인 요청 카드 ${r.created}장` : '이미 대기 중인 카드가 있습니다'); reload(); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  async function draftBudget() {
    if (!data) return; setBusy(true);
    try { const r = await api<{ source: string }>('/api/marketing/ops/budget', { body: { month: data.month } }); toast.ok(r.source === 'ai' ? 'AI 예산 계획 초안 — 승인 대기' : '기본 배분 초안(AI 없이) — 승인 대기'); reload(); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  if (error) return <ErrorBox error={error} retry={reload} />;
  const pending = data?.proposals.filter((p) => p.status === 'pending') ?? [];
  const rest = data?.proposals.filter((p) => p.status !== 'pending') ?? [];
  return (
    <div className="mx-auto max-w-5xl space-y-4" data-testid="mkt-ops">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold" style={{ color: C }}>운영실 <span className="text-sm font-normal text-ink-2">AI 마케터</span></h1>
        <select className={cx(inputCls, 'h-8 w-auto py-0 text-sm')} value={data?.month ?? ''} onChange={(e) => setMonth(e.target.value)} aria-label="달" data-testid="ops-month">{(data?.months ?? []).map((m) => <option key={m} value={m}>{mk(m)}</option>)}</select>
        {data?.canEdit && <Button size="sm" className="ml-auto" onClick={propose} disabled={busy} data-testid="ops-propose">AI 마케터 제안 받기</Button>}
      </div>
      <p className="text-xs text-ink-2">AI 마케터가 숫자(게시·문의·광고비·캠페인)를 보고 분석·게시 방향·협업·인플루언서·향후 계획을 카드로 올립니다. 대표가 [승인]하면 실행됩니다 — 계획·방향은 제작의뢰실 의뢰로, 협업·인플루언서·분석은 담당 업무로. 돈을 쓰거나 밖으로 보내는 일은 사람이 합니다. 매주 월요일 분석·방향 카드가 자동으로 올라옵니다.</p>
      {!data ? <Skeleton rows={5} /> : <>
        <RevenueGoal canEdit={data.canEdit} month={data.month} />
        <section data-testid="ops-proposals">
          <h2 className="text-base font-bold">승인 요청 카드 {pending.length ? <span className="text-orange-700">{pending.length}건</span> : <span className="text-sm font-normal text-ink-3">없음</span>}</h2>
          {pending.length === 0 && <div className="mt-2 rounded-card border border-dashed border-line p-6 text-center text-sm text-ink-2" data-testid="ops-empty">대기 중인 카드가 없습니다{data.canEdit ? ' — [AI 마케터 제안 받기]' : ''}</div>}
          <div className="mt-2 grid gap-3 md:grid-cols-2">{pending.map((p) => <ProposalCard key={p.id} p={p} kinds={data.kinds} canEdit={data.canEdit} onChange={reload} />)}</div>
        </section>
        <BudgetCard b={data.budget} month={data.month} canEdit={data.canEdit} busy={busy} onDraft={draftBudget} onChange={reload} />
        {rest.length > 0 && <details className="rounded-card border border-line bg-white p-3 shadow-card" data-testid="ops-history"><summary className="cursor-pointer text-sm font-semibold">지난 카드 {rest.length}</summary>
          <div className="mt-2 grid gap-3 md:grid-cols-2">{rest.map((p) => <ProposalCard key={p.id} p={p} kinds={data.kinds} canEdit={data.canEdit} onChange={reload} />)}</div></details>}
      </>}
    </div>
  );
}

function ProposalCard({ p, kinds, canEdit, onChange }: { p: Proposal; kinds: Record<string, string>; canEdit: boolean; onChange: () => void }) {
  const [busy, setBusy] = useState(false); const [reject, setReject] = useState(false); const [note, setNote] = useState('');
  const [sl, sc] = STATUS[p.status] ?? [p.status, ''];
  async function act(body: Record<string, unknown>, msg: string) {
    setBusy(true);
    try { await api(`/api/marketing/ops/proposals/${p.id}`, { method: 'PATCH', body }); toast.ok(msg); setReject(false); onChange(); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  const ex = p.executed ?? {};
  return (
    <article className="rounded-card border border-line bg-white p-4 shadow-card" data-testid="ops-card" data-kind={p.kind} data-status={p.status}>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]"><span className="rounded-full bg-violet-50 px-2 py-0.5 font-semibold text-violet-800" data-testid="ops-card-kind">{kinds[p.kind] ?? p.kind}</span>
        <span className={cx('rounded-full px-2 py-0.5 font-semibold', sc)} data-testid="ops-card-status">{sl}</span><span className="text-ink-3">{p.source === 'ai' ? 'AI 마케터' : p.source === 'template' ? '기본 카드(AI 없이)' : '직접'} · {fmtDateTime(p.created_at)}</span></div>
      <h3 className="mt-1.5 text-sm font-bold" data-testid="ops-card-title">{p.title}</h3>
      <p className="mt-1 text-sm text-ink-1">{p.summary}</p>
      <ul className="mt-2 space-y-1.5 text-xs">{(p.body?.items ?? []).map((it, i) => <li key={i} className="rounded-input border border-line p-2"><b>{it.title}</b> <span className="text-ink-2">{it.detail}</span>
        <div className="mt-0.5 text-[11px] text-ink-3">{it.expected ? `기대: ${it.expected}` : ''}{it.cost ? ` · 비용: ${it.cost}` : ''}</div></li>)}</ul>
      {p.body?.rationale && <p className="mt-2 rounded-input bg-violet-50/50 px-2.5 py-1.5 text-[11px] text-ink-2" data-testid="ops-card-why"><b className="text-violet-800">근거</b> {p.body.rationale}</p>}
      {p.decision_note && <p className="mt-1 text-[11px] text-ink-2">결정 메모: {p.decision_note}</p>}
      {p.status !== 'pending' && p.decided_by_name && <p className="mt-1 text-[11px] text-ink-3">{p.decided_by_name} · {p.decided_at ? fmtDateTime(p.decided_at) : ''}{ex.briefs?.length ? ` · 제작의뢰 ${ex.briefs.length}건` : ''}{ex.tasks?.length ? ` · 업무 ${ex.tasks.length}건` : ''}</p>}
      {p.status === 'approved' && <p className="mt-1 text-[11px]">{ex.briefs?.length ? <Link href="/s/marketing/automation?tab=studio" className="underline">제작의뢰실에서 진행 →</Link> : ex.tasks?.length ? <Link href={`/tasks/${ex.tasks[0]}`} className="underline">업무 열기 →</Link> : null}</p>}
      {canEdit && p.status === 'pending' && <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {!reject ? <><Button size="sm" onClick={() => act({ action: 'approve' }, '승인했습니다 — 실행으로 넘겼습니다')} disabled={busy} data-testid="ops-approve">승인</Button>
          <Button size="sm" variant="secondary" onClick={() => setReject(true)} disabled={busy} data-testid="ops-reject">반려</Button></>
          : <><input className={cx(inputCls, 'h-8 flex-1 py-0 text-sm')} value={note} onChange={(e) => setNote(e.target.value)} placeholder="반려 사유" aria-label="반려 사유" data-testid="ops-reject-note" />
            <Button size="sm" onClick={() => act({ action: 'reject', note }, '반려했습니다')} disabled={busy || !note.trim()} data-testid="ops-reject-go">반려 확정</Button><Button size="sm" variant="secondary" onClick={() => setReject(false)}>취소</Button></>}
      </div>}
      {canEdit && p.status === 'approved' && <div className="mt-2"><Button size="sm" variant="secondary" onClick={() => act({ action: 'done' }, '실행 완료로 표시했습니다')} disabled={busy} data-testid="ops-done">실행 완료</Button></div>}
    </article>
  );
}

function BudgetCard({ b, month, canEdit, busy, onDraft, onChange }: { b: Budget | null; month: string; canEdit: boolean; busy: boolean; onDraft: () => void; onChange: () => void }) {
  const [edit, setEdit] = useState(false); const [plan, setPlan] = useState<Record<string, string>>({}); const [w, setW] = useState(false); const [reject, setReject] = useState('');
  async function act(body: Record<string, unknown>, msg: string) {
    if (!b) return; setW(true);
    try { await api(`/api/marketing/ops/budget/${b.id}`, { method: 'PATCH', body }); toast.ok(msg); setEdit(false); onChange(); } catch (e: any) { toast.error(e.message); } finally { setW(false); }
  }
  const [sl, sc] = b ? STATUS[b.status] ?? [b.status, ''] : ['', ''];
  return (
    <section className="rounded-card border border-line bg-white p-4 shadow-card" data-testid="ops-budget">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-bold">{mk(month)} 광고 예산 계획</h2>
        {b && <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-semibold', sc)} data-testid="budget-status">{sl}</span>}
        {b && <span className="text-[11px] text-ink-3">{b.source === 'ai' ? 'AI 초안' : b.source === 'template' ? '기본 배분(AI 없이)' : '직접 고침'}{b.approved_by_name ? ` · ${b.approved_by_name} 승인 ${b.approved_at ? fmtDateTime(b.approved_at) : ''}` : ''}</span>}
        {canEdit && <span className="ml-auto flex flex-wrap gap-1.5">
          {b?.status === 'pending' && !edit && <Button size="sm" onClick={() => act({ action: 'approve' }, '승인 — 연결된 네이버 캠페인 하루 예산을 맞췄습니다')} disabled={w} data-testid="budget-approve">승인·집행</Button>}
          {b?.status === 'pending' && (!edit ? <Button size="sm" variant="secondary" onClick={() => { setPlan(Object.fromEntries(b.plan.map((p) => [p.provider, String(p.monthly)]))); setEdit(true); }} data-testid="budget-edit">고치기</Button>
            : <><Button size="sm" onClick={() => act({ action: 'update', plan: b.plan.map((p) => ({ provider: p.provider, monthly: Number(String(plan[p.provider] ?? p.monthly).replace(/[^\d]/g, '')) || 0 })) }, '저장했습니다')} disabled={w} data-testid="budget-save">저장</Button><Button size="sm" variant="secondary" onClick={() => setEdit(false)}>취소</Button></>)}
          {(!b || b.status !== 'pending') && <Button size="sm" variant={b ? 'secondary' : 'primary'} onClick={onDraft} disabled={busy} data-testid="budget-draft">{b ? 'AI 다시 계획' : 'AI 예산 계획 만들기'}</Button>}
        </span>}
      </div>
      {!b ? <p className="mt-2 text-xs text-ink-2" data-testid="budget-empty">이 달 계획이 없습니다. 매월 25일 다음 달 계획 초안이 올라옵니다(광고 계정이 연결된 회사).</p> : <>
        <table className="mt-3 w-full text-xs" data-testid="budget-table"><thead className="text-left text-ink-3"><tr><th className="py-1">채널</th><th className="py-1 text-right">월 예산</th><th className="py-1 text-right">하루</th><th className="py-1 text-right">이달 사용</th><th className="py-1">비고</th></tr></thead>
          <tbody>{b.plan.map((p) => <tr key={p.provider} className="border-t border-line" data-testid={`budget-row-${p.provider}`}>
            <td className="py-1.5">{p.label}{!p.connected && <span className="ml-1 rounded-full bg-slate-100 px-1.5 text-[10px] text-ink-3">연결 없음</span>}</td>
            <td className="py-1.5 text-right tabular-nums">{edit ? <input className={cx(inputCls, 'h-7 w-28 py-0 text-right text-xs')} value={plan[p.provider] ?? ''} onChange={(e) => setPlan({ ...plan, [p.provider]: e.target.value })} inputMode="numeric" aria-label={`${p.label} 월 예산`} data-testid={`budget-in-${p.provider}`} /> : won(p.monthly)}</td>
            <td className="py-1.5 text-right tabular-nums text-ink-2">{won(p.daily)}</td>
            <td className="py-1.5 text-right tabular-nums">{p.connected ? <>{won(p.used)}{p.rate !== null && <span className={cx('ml-1', p.rate >= 80 ? 'font-semibold text-red-700' : 'text-ink-3')}>{p.rate}%</span>}</> : '—'}</td>
            <td className="py-1.5 text-ink-2">{p.note}{p.rate !== null && p.rate >= 80 && p.charge && <a href={p.charge} target="_blank" rel="noreferrer" className="ml-1 font-semibold text-red-700 underline" data-testid={`budget-charge-${p.provider}`}>충전 필요 →</a>}</td></tr>)}</tbody>
          <tfoot><tr className="border-t border-line font-semibold"><td className="py-1.5">합계</td><td className="py-1.5 text-right tabular-nums" data-testid="budget-total">{won(b.total)}</td><td colSpan={3} /></tr></tfoot></table>
        {b.rationale && <p className="mt-2 rounded-input bg-violet-50/50 px-2.5 py-1.5 text-[11px] text-ink-2" data-testid="budget-why"><b className="text-violet-800">근거</b> {b.rationale}</p>}
        {b.executed && <ul className="mt-2 space-y-0.5 text-[11px]" data-testid="budget-executed">{b.executed.map((e: any, i: number) => <li key={i} className={e.ok ? 'text-emerald-800' : 'text-ink-2'}>{e.ok ? '✓' : '·'} {e.provider}{e.name ? ` · ${e.name}` : ''}{e.dailyBudget ? ` 하루 ${won(e.dailyBudget)}` : ''}{e.note ? ` — ${e.note}` : ''}{e.error ? ` — ${e.error}` : ''}</li>)}</ul>}
        {canEdit && b.status === 'pending' && <div className="mt-2 flex items-center gap-1.5"><input className={cx(inputCls, 'h-8 flex-1 py-0 text-sm')} value={reject} onChange={(e) => setReject(e.target.value)} placeholder="반려 사유" aria-label="예산 반려 사유" data-testid="budget-reject-note" /><Button size="sm" variant="secondary" onClick={() => act({ action: 'reject', note: reject }, '반려했습니다')} disabled={w || !reject.trim()} data-testid="budget-reject">반려</Button></div>}
        <p className="mt-2 text-[11px] text-ink-3">승인하면 연결된 네이버 캠페인(세팅안)의 하루 예산을 계획값으로 맞춥니다(월 상한 검사 포함). Google·유튜브·Meta 는 각 매체에서 직접 설정합니다. 소진율 80% 또는 예상 초과 시 “충전 필요” 알림 — 충전은 대표가 매체 사이트에서.</p>
      </>}
    </section>
  );
}
