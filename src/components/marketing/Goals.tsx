'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, useApi } from '@/components/client';
import { Button, ErrorBox, Field, Skeleton, cx, fmtDateTime, inputCls, toast } from '@/components/ui';

/**
 * 대표 10/20 18:00 ② 월 운영 목표: AI 25일 초안(다음 달) → 대표 승인 → 주간 주제 달력(묶음 규칙이 그 주 주제를 씀) → 월요일 주간 리뷰 → 월말 결산. 홈 '이번 달 목표 n/m' 막대.
 * ④ [이달 근거 소급]: 자동 제작분에 '왜 이 글인가'를 목표·규칙 문장으로 채움(AI 비용 0).
 */
const C = '#7C3AED';
type Goal = { id: string; month: string; brand_id: string | null; brand: string | null; status: string; source: string; goals: { objectives: string[]; message: string; targets: { posts: number | null; inquiries: number | null; adBudget: number | null }; channels: string[] };
  weekly: { week: number; from: string; to: string; topic: string; channels: string[]; kinds: string[]; note?: string }[]; reviews: { week: number; at: string; numbers: any; summary: string }[]; closing: any; created_by_name: string | null; approved_by_name: string | null; approved_at: string | null;
  numbers: { posts: number; planned: number; inquiries: number; adCost: number }; thisWeek: number | null };
type View = { month: string; goals: Goal[]; brands: { id: string; name: string }[]; months: string[]; canEdit: boolean; today: string };
const STATUS: Record<string, [string, string]> = { pending: ['승인 대기', 'bg-orange-50 text-orange-800'], approved: ['승인됨', 'bg-emerald-50 text-emerald-800'], closed: ['결산 완료', 'bg-slate-100 text-ink-2'], draft: ['초안', 'bg-slate-100 text-ink-2'] };
const KINDS = ['feed', 'reels', 'blog', 'shorts', 'story', 'video'];
const mk = (m: string) => `${m.slice(0, 4)}년 ${Number(m.slice(5))}월`;

export function Goals() {
  const [month, setMonth] = useState(''); const [brandId, setBrandId] = useState('');
  const { data, error, reload } = useApi<View>(`/api/marketing/goals${month ? `?month=${month}` : ''}`, [month]);
  const [busy, setBusy] = useState(false);
  async function draft() {
    if (!data) return; setBusy(true);
    try { const r = await api<{ source: string }>('/api/marketing/goals', { body: { month: data.month, brandId: brandId || null } }); toast.ok(r.source === 'ai' ? 'AI 초안을 만들었습니다 — 승인 대기' : 'AI 없이 기본 초안을 만들었습니다 — 고친 뒤 승인'); reload(); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  async function backfill() {
    if (!data) return; setBusy(true);
    try { const r = await api<{ updated: number; total: number }>('/api/marketing/goals/backfill', { body: { month: data.month } }); toast.ok(`근거 ${r.updated}건 채움(대상 ${r.total}건)`); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  if (error) return <ErrorBox error={error} retry={reload} />;
  return (
    <div className="mx-auto max-w-5xl space-y-4" data-testid="mkt-goals">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold" style={{ color: C }}>월 운영 목표</h1>
        <select className={cx(inputCls, 'h-8 w-auto py-0 text-sm')} value={data?.month ?? ''} onChange={(e) => setMonth(e.target.value)} aria-label="달" data-testid="goals-month">{(data?.months ?? []).map((m) => <option key={m} value={m}>{mk(m)}</option>)}</select>
        {data?.canEdit && <span className="ml-auto flex flex-wrap items-center gap-1.5">
          {data.brands.length > 0 && <select className={cx(inputCls, 'h-8 w-auto py-0 text-sm')} value={brandId} onChange={(e) => setBrandId(e.target.value)} aria-label="브랜드"><option value="">회사 전체</option>{data.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>}
          <Button size="sm" onClick={draft} disabled={busy} data-testid="goals-draft">AI 초안 만들기</Button>
          <Button size="sm" variant="secondary" onClick={backfill} disabled={busy} title="이달 자동 제작분에 '왜 이 글인가'를 목표·규칙 문장으로 채움(AI 비용 0)" data-testid="goals-backfill">이달 근거 소급</Button></span>}
      </div>
      <p className="text-xs text-ink-2">매월 25일 AI 가 다음 달 초안을 올립니다 → 대표가 고치고 [승인] → 묶음 규칙 자동 제작이 그 주 주제를 쓰고 글마다 근거가 붙습니다 → 월요일 주간 리뷰 → 월말 결산. 돈·외부 발송은 사람이 합니다.</p>
      {!data ? <Skeleton rows={5} /> : data.goals.length === 0 ? <div className="rounded-card border border-dashed border-line p-8 text-center text-sm text-ink-2" data-testid="goals-empty">{mk(data.month)} 운영 목표가 아직 없습니다{data.canEdit ? ' — [AI 초안 만들기]를 누르면 지난달 실적·브랜드 키트로 초안을 만듭니다' : ''}</div>
        : data.goals.map((g) => <GoalCard key={g.id} g={g} canEdit={data.canEdit} today={data.today} onChange={reload} />)}
    </div>
  );
}

function GoalCard({ g, canEdit, today, onChange }: { g: Goal; canEdit: boolean; today: string; onChange: () => void }) {
  const [edit, setEdit] = useState(false); const [f, setF] = useState({ goals: g.goals, weekly: g.weekly }); const [busy, setBusy] = useState(false);
  useEffect(() => setF({ goals: g.goals, weekly: g.weekly }), [g]);
  const ro = !canEdit || g.status === 'closed';
  async function act(body: Record<string, unknown>, msg: string) {
    setBusy(true);
    try { await api(`/api/marketing/goals/${g.id}`, { method: 'PATCH', body }); toast.ok(msg); setEdit(false); onChange(); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  const t = g.goals?.targets ?? { posts: null, inquiries: null, adBudget: null };
  const bar = (d: number, tot: number | null) => <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${tot ? Math.min(100, Math.round((d / tot) * 100)) : 0}%`, background: C }} /></div>;
  const [sl, sc] = STATUS[g.status] ?? [g.status, ''];
  const setWeek = (i: number, patch: Partial<Goal['weekly'][number]>) => setF({ ...f, weekly: f.weekly.map((w, k) => (k === i ? { ...w, ...patch } : w)) });
  return (
    <section className="rounded-card border border-line bg-white p-4 shadow-card" data-testid="goal-card" data-status={g.status}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-bold">{mk(g.month)}{g.brand ? ` · ${g.brand}` : ' · 회사 전체'}</h2>
        <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-semibold', sc)} data-testid="goal-status">{sl}</span>
        <span className="text-[11px] text-ink-3">{g.source === 'ai' ? 'AI 초안' : g.source === 'template' ? '기본 초안(AI 없이)' : '직접 고침'}{g.approved_at ? ` · ${g.approved_by_name ?? ''} 승인 ${fmtDateTime(g.approved_at)}` : ''}</span>
        {!ro && <span className="ml-auto flex flex-wrap gap-1.5">
          {g.status === 'pending' && !edit && <Button size="sm" onClick={() => act({ action: 'approve' }, '승인했습니다 — 묶음 규칙이 이 달력의 주제를 씁니다')} disabled={busy} data-testid="goal-approve">승인</Button>}
          {!edit ? <Button size="sm" variant="secondary" onClick={() => setEdit(true)} data-testid="goal-edit">고치기</Button>
            : <><Button size="sm" onClick={() => act({ action: 'update', goals: f.goals, weekly: f.weekly }, '저장했습니다')} disabled={busy} data-testid="goal-save">저장</Button><Button size="sm" variant="secondary" onClick={() => { setEdit(false); setF({ goals: g.goals, weekly: g.weekly }); }}>취소</Button></>}
          {g.status === 'pending' && <Button size="sm" variant="secondary" onClick={() => act({ action: 'redraft' }, '다시 만들었습니다')} disabled={busy}>AI 다시</Button>}
          {g.status === 'approved' && <Button size="sm" variant="secondary" onClick={() => act({ action: 'review' }, '주간 리뷰를 적었습니다')} disabled={busy} data-testid="goal-review">주간 리뷰 지금</Button>}
          {g.status === 'approved' && g.month <= today.slice(0, 7) && <Button size="sm" variant="secondary" onClick={() => { if (confirm('이 달을 결산할까요? 결산 뒤에는 고칠 수 없습니다.')) void act({ action: 'close' }, '결산했습니다'); }} disabled={busy} data-testid="goal-close">월말 결산</Button>}
        </span>}
      </div>
      {/* 목표 3·핵심 메시지·목표 수치 + 실적 막대 */}
      <div className="mt-3 grid gap-4 md:grid-cols-[1fr_16rem]">
        <div>
          {edit ? <div className="space-y-2 text-sm">
            {[0, 1, 2].map((i) => <input key={i} className={inputCls} value={f.goals.objectives[i] ?? ''} onChange={(e) => { const o = [...f.goals.objectives]; o[i] = e.target.value; setF({ ...f, goals: { ...f.goals, objectives: o } }); }} placeholder={`목표 ${i + 1}`} maxLength={200} aria-label={`목표 ${i + 1}`} data-testid={`goal-obj-${i}`} />)}
            <Field label="핵심 메시지"><input className={inputCls} value={f.goals.message} onChange={(e) => setF({ ...f, goals: { ...f.goals, message: e.target.value } })} maxLength={200} aria-label="핵심 메시지" /></Field>
            <div className="grid grid-cols-3 gap-2">{(['posts', 'inquiries', 'adBudget'] as const).map((k) => <Field key={k} label={{ posts: '게시(건)', inquiries: '문의(건)', adBudget: '광고비(원)' }[k]}><input className={inputCls} inputMode="numeric" value={f.goals.targets[k] ?? ''} onChange={(e) => setF({ ...f, goals: { ...f.goals, targets: { ...f.goals.targets, [k]: e.target.value === '' ? null : Number(e.target.value.replace(/[^0-9]/g, '')) } } })} aria-label={k} data-testid={`goal-t-${k}`} /></Field>)}</div>
          </div> : <>
            <ol className="list-decimal space-y-0.5 pl-5 text-sm" data-testid="goal-objectives">{(g.goals.objectives ?? []).filter(Boolean).map((o, i) => <li key={i}>{o}</li>)}</ol>
            {g.goals.message && <p className="mt-2 rounded-input bg-violet-50/50 px-2.5 py-1.5 text-sm"><b className="text-violet-800">핵심 메시지</b> {g.goals.message}</p>}
            {!!g.goals.channels?.length && <p className="mt-1 text-[11px] text-ink-3">채널: {g.goals.channels.join(' · ')}</p>}
          </>}
        </div>
        <div className="space-y-2 rounded-input border border-line p-2 text-xs" data-testid="goal-progress">
          {([['게시', g.numbers.posts, t.posts, '건', `예정 포함 ${g.numbers.planned}`], ['문의', g.numbers.inquiries, t.inquiries, '건', ''], ['광고비', g.numbers.adCost, t.adBudget, '원', '']] as [string, number, number | null, string, string][]).map(([l, d, tot, u, sub]) => (
            <div key={l}><div className="flex justify-between"><span className="text-ink-2">{l}{sub ? <span className="ml-1 text-ink-3">({sub})</span> : null}</span><span className="tabular-nums">{u === '원' ? d.toLocaleString('ko-KR') : d}{tot !== null ? `/${u === '원' ? tot.toLocaleString('ko-KR') : tot}` : ''}{u}</span></div>{bar(d, tot)}</div>))}
        </div>
      </div>
      {/* 주간 주제 달력 */}
      <h3 className="mt-4 text-sm font-semibold">주간 주제 달력 <span className="font-normal text-ink-3">묶음 규칙 자동 제작이 그 주 주제를 씁니다</span></h3>
      <ol className="mt-1.5 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-5" data-testid="goal-weeks">{(edit ? f.weekly : g.weekly).map((w, i) => {
        const now = w.from <= today && today <= w.to; const rv = g.reviews?.find((r) => r.week === w.week);
        return <li key={w.week} className={cx('rounded-input border p-2 text-xs', now ? 'border-violet-400 bg-violet-50/40' : 'border-line')} data-testid="goal-week" data-now={now || undefined}>
          <div className="flex justify-between font-semibold"><span>{w.week}주</span><span className="font-normal text-ink-3">{w.from.slice(5).replace('-', '/')}~{w.to.slice(5).replace('-', '/')}</span></div>
          {edit ? <><input className={cx(inputCls, 'mt-1 h-8 py-1 text-xs')} value={w.topic} onChange={(e) => setWeek(i, { topic: e.target.value })} maxLength={200} aria-label={`${w.week}주 주제`} data-testid={`goal-week-topic-${w.week}`} />
            <div className="mt-1 flex flex-wrap gap-1">{KINDS.map((k) => <label key={k} className={cx('rounded-full border px-1.5 py-0.5', w.kinds.includes(k) ? 'border-violet-300 bg-violet-50 text-violet-800' : 'border-line text-ink-3')}><input type="checkbox" className="sr-only" checked={w.kinds.includes(k)} onChange={(e) => setWeek(i, { kinds: e.target.checked ? [...w.kinds, k] : w.kinds.filter((x) => x !== k) })} />{k}</label>)}</div>
            <input className={cx(inputCls, 'mt-1 h-8 py-1 text-xs')} value={w.note ?? ''} onChange={(e) => setWeek(i, { note: e.target.value })} placeholder="메모" maxLength={300} aria-label={`${w.week}주 메모`} /></>
            : <><p className="mt-1 font-medium">{w.topic}</p>{!!w.kinds?.length && <p className="text-[11px] text-ink-3">{w.kinds.join(' · ')}</p>}{w.note && <p className="text-[11px] text-ink-2">{w.note}</p>}
              {rv && <p className="mt-1 rounded bg-slate-50 p-1 text-[11px] text-ink-2" data-testid="goal-week-review">리뷰: {rv.summary}</p>}
              {g.status === 'approved' && w.to >= today && <Link href={`/s/marketing/automation?tab=studio&message=${encodeURIComponent(w.topic)}&kind=${encodeURIComponent((w.kinds ?? [])[0] === 'blog' ? 'blog_cover' : (w.kinds ?? [])[0] ?? 'feed')}&week=${w.week}${g.brand_id ? `&brand=${g.brand_id}` : ''}&due=${w.from}`} className="mt-1 inline-block text-[11px] font-medium text-violet-700 underline" data-testid="goal-week-brief">제작 의뢰 →</Link>}</>}
        </li>; })}</ol>
      {g.closing && <p className="mt-3 rounded-input border border-emerald-200 bg-emerald-50/50 px-3 py-2 text-sm" data-testid="goal-closing"><b className="text-emerald-800">월말 결산</b> {g.closing.summary}</p>}
    </section>
  );
}
