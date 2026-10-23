'use client';
import Link from 'next/link';
import { useState } from 'react';
import { api, useApi } from '@/components/client';
import { Button, ErrorBox, Skeleton, cx, fmtDateTime, inputCls, toast } from '@/components/ui';
import { RevenueGoal } from './RevenueGoal';
import { ConceptBox } from './Concepts';
import { AdRefBox } from './AdRefs';

/**
 * 대표 10/20 20:00 ① 마케팅 운영실: AI 마케터(30년차)가 운영을 맡되 분석·방향·협업·인플루언서·계획은 '승인 요청 카드'로 올리고, 대표가 [승인]해야 실행(계획·방향 → 제작의뢰실, 협업·인플루언서·분석 → 업무).
 * ② 광고 예산: 채널별 월 계획 초안 → 대표 승인 → 집행(연결된 네이버 캠페인 하루 예산, 나머지는 안내) · 소진율 80% 넘으면 '충전 필요' 알림(충전은 대표가 매체 사이트에서).
 * ③ 월 매출 목표 vs 실적 막대(RevenueGoal) + CAC·ROI 는 월간 보고.
 */
const C = '#7C3AED';
type Proposal = { id: string; kind: string; title: string; summary: string; body: { items: { title: string; detail: string; expected?: string; cost?: string }[]; rationale: string; numbers?: any; link?: string }; status: string; source: string; version?: number; revision_note?: string | null; decision_note: string | null; decided_by_name: string | null; decided_at: string | null; executed: any; created_at: string };
export type BrandRow = { brandId: string; name: string; share: number; monthly: number; priority: number | null; note: string; plans: number; needsPlan: boolean };
type Budget = { id: string; month: string; status: string; version?: number; revision_note?: string | null; reject_note?: string | null; brand_plan?: BrandRow[]; total_source?: string | null; plan: { provider: string; label: string; monthly: number; daily: number; note: string; connected: boolean; charge: string | null; used: number; rate: number | null }[]; total: number; rationale: string | null; source: string; executed: any[] | null; approved_by_name: string | null; approved_at: string | null };
type FeedItem = { id: string; title: string; media: string; url: string | null; stats: { brightness: number; saturation: number; warmth: number } | { error: string } | null; outlier: boolean };
type FeedBrand = { brandId: string | null; name: string; color: string; n: number; score: number | null; items: FeedItem[]; note: string };
type View = { month: string; feed?: { analyzable: boolean; brands: FeedBrand[] } | null; proposals: Proposal[]; budget: Budget | null; kinds: Record<string, string>; channels: Record<string, { label: string; charge: string }>; canEdit: boolean; months: string[]; ownerTotal?: number | null; totalDefault?: { total: number; source: string }; brands?: { brandId: string; name: string; share: number; priority: number | null; note: string }[]; maxRevisions?: number; review?: { day: string; status: 'ok' | 'warn' | 'action'; signals: { key: string; level: string; title: string; detail: string; action: string }[]; metrics: any; brief: string | null; briefAt: string | null; reviewedAt: string } | null };
const REVIEW_STATUS: Record<string, [string, string]> = { ok: ['정상', 'bg-emerald-50 text-emerald-800 border-emerald-200'], warn: ['주의', 'bg-amber-50 text-amber-800 border-amber-200'], action: ['조치 필요', 'bg-red-50 text-red-800 border-red-200'] };
const TOTAL_SRC: Record<string, string> = { owner: '대표 입력 총액', goal: '월 운영 목표 광고비', last: '지난달 지출 ×1.5', hint: '화면 입력', min: '최소 기준(30만)' };
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
  // #98 ④ 잔여: 주간 운영 제안 카드 지금 만들기(월요일 자동과 같은 내용, 6일 안 이미 있으면 그 카드)
  async function weekly() {
    setBusy(true);
    try { const r = await api<{ created: number; skipped?: string }>('/api/marketing/ops/weekly', { body: {} }); toast.ok(r.created ? '주간 운영 제안 카드를 만들었습니다 — 승인함에서 확인하세요' : '최근 6일 안에 만든 주간 제안이 있어 그대로 둡니다'); reload(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  async function reviewNow() {
    setBusy(true);
    try { const r = await api<{ status: string; signals: any[]; cards: number }>('/api/marketing/ops/review', { body: {} }); toast.ok(`검토 완료 — ${REVIEW_STATUS[r.status]?.[0] ?? r.status}${r.cards ? ` · 운영 신호 카드 ${r.cards}장` : ''}`); reload(); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  if (error) return <ErrorBox error={error} retry={reload} />;
  const pending = data?.proposals.filter((p) => p.status === 'pending') ?? [];
  const rest = data?.proposals.filter((p) => p.status !== 'pending') ?? [];
  return (
    <div className="mx-auto max-w-5xl space-y-4" data-testid="mkt-ops">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold" style={{ color: C }}>운영실 <span className="text-sm font-normal text-ink-2">AI 마케터</span></h1>
        <select className={cx(inputCls, 'h-8 w-auto py-0 text-sm')} value={data?.month ?? ''} onChange={(e) => setMonth(e.target.value)} aria-label="달" data-testid="ops-month">{(data?.months ?? []).map((m) => <option key={m} value={m}>{mk(m)}</option>)}</select>
        {data?.canEdit && <Button size="sm" variant="secondary" className="ml-auto" onClick={weekly} disabled={busy} data-testid="ops-weekly">주간 제안 만들기</Button>}
        {data?.canEdit && <Button size="sm" onClick={propose} disabled={busy} data-testid="ops-propose">AI 마케터 제안 받기</Button>}
      </div>
      {/* 대표 03:00 ② 상시 운영: 지금 상태(정상/주의/조치 필요) · 신호 · 최근 검토 시각 · [지금 검토] — 1시간마다 자동(지표만, AI 비용 0), 신호는 '운영 신호' 카드로 승인 요청 */}
      {data && <div className={cx('flex flex-wrap items-center gap-2 rounded-card border px-3 py-2 text-xs', data.review ? REVIEW_STATUS[data.review.status][1] : 'border-line bg-white text-ink-2')} data-testid="ops-review" data-status={data.review?.status ?? 'none'}>
        <b>지금 상태</b><span className="rounded-full bg-white/70 px-2 py-0.5 font-semibold" data-testid="ops-review-status">{data.review ? REVIEW_STATUS[data.review.status][0] : '검토 전'}</span>
        {data.review?.signals?.length ? <span className="text-[11px]" data-testid="ops-review-signals">{data.review.signals.map((s) => s.title).join(' · ')}</span> : data.review ? <span className="text-[11px]">오늘 게시 {data.review.metrics?.posts ?? 0} · 클릭 {data.review.metrics?.clicks ?? 0} · 문의 {data.review.metrics?.inquiries ?? 0} · 계약 {data.review.metrics?.contracts ?? 0}</span> : <span className="text-[11px]">1시간마다 지표를 보고 변화가 있으면 카드로 제안합니다</span>}
        <span className="ml-auto text-[11px] opacity-80" data-testid="ops-review-at">{data.review ? `최근 검토 ${fmtDateTime(data.review.reviewedAt)}` : ''}</span>
        {data.canEdit && <Button size="sm" variant="secondary" onClick={reviewNow} disabled={busy} data-testid="ops-review-now">지금 검토</Button>}</div>}
      {data?.review?.brief && <p className="rounded-input bg-slate-50 px-3 py-1.5 text-xs text-ink-2" data-testid="ops-brief">🌅 아침 브리핑 · {data.review.brief}</p>}
      <p className="text-xs text-ink-2">AI 마케터가 숫자(게시·문의·광고비·캠페인)를 보고 분석·게시 방향·협업·인플루언서·향후 계획을 카드로 올립니다. 대표가 [승인]하면 실행됩니다 — 계획·방향은 제작의뢰실 의뢰로, 협업·인플루언서·분석은 담당 업무로. 돈을 쓰거나 밖으로 보내는 일은 사람이 합니다. 매주 월요일 분석·방향 카드가 자동으로 올라옵니다.</p>
      {!data ? <Skeleton rows={5} /> : <>
        <RevenueGoal canEdit={data.canEdit} month={data.month} />
        {/* 대표 10/21 12:20 피드 일관성: 브랜드별 최근 9장(3×3) 톤(밝기·채도·색온도) — 숫자로만 비교(AI 비용 0), 튀는 장은 빨간 테두리. 신호는 운영 검토 카드로 */}
        {data.feed && data.feed.brands.length > 0 && <section id="feed" className="rounded-card border border-line bg-white p-3 shadow-card" data-testid="ops-feed">
          <h2 className="text-sm font-semibold">피드 일관성 <span className="font-normal text-ink-2">브랜드별 최근 9장 톤(밝기·채도·색온도) — 숫자로만 비교</span></h2>
          <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{data.feed.brands.map((b) => (
            <div key={b.brandId ?? 'none'} data-testid="ops-feed-brand" data-score={b.score ?? ''}>
              <div className="flex flex-wrap items-center gap-1.5 text-xs"><i className="inline-block size-2 rounded-full" style={{ background: b.color }} /><b>{b.name}</b>
                <span className={cx('rounded-full px-1.5 py-0.5 text-[11px] font-medium', b.score === null ? 'bg-slate-100 text-ink-3' : b.score >= 70 ? 'bg-emerald-50 text-emerald-800' : b.score >= 50 ? 'bg-amber-50 text-amber-800' : 'bg-red-50 text-red-700')} data-testid="ops-feed-score">{b.score === null ? '분석 전' : `일관성 ${b.score}점`}</span>
                <span className="text-ink-3">{b.n}장</span></div>
              <div className="mt-1 grid grid-cols-3 gap-0.5">{b.items.map((it) => (
                <a key={it.id} href={it.url ?? `/s/marketing/approvals?c=${it.id}`} target={it.url ? '_blank' : undefined} rel="noopener noreferrer" className={cx('relative aspect-square overflow-hidden rounded bg-slate-100', it.outlier && 'ring-2 ring-red-500')}
                  title={`${it.title}${it.stats && !('error' in it.stats) ? ` · 밝기 ${it.stats.brightness} · 채도 ${Math.round(it.stats.saturation * 100)}%` : ''}`} data-testid={it.outlier ? 'ops-feed-outlier' : 'ops-feed-item'}>
                  <img src={`/api/library/${it.media}/download?inline=1`} alt="" className="size-full object-cover" loading="lazy" />
                  {it.outlier && <span className="absolute left-0.5 top-0.5 rounded bg-red-600 px-1 text-[10px] font-semibold text-white">튐</span>}
                </a>))}</div>
              <p className="mt-1 text-[11px] text-ink-3">{b.note}</p>
            </div>))}</div>
        </section>}
        <section data-testid="ops-proposals">
          <h2 className="text-base font-bold">승인 요청 카드 {pending.length ? <span className="text-orange-700">{pending.length}건</span> : <span className="text-sm font-normal text-ink-3">없음</span>}</h2>
          {pending.length === 0 && <div className="mt-2 rounded-card border border-dashed border-line p-6 text-center text-sm text-ink-2" data-testid="ops-empty">대기 중인 카드가 없습니다{data.canEdit ? ' — [AI 마케터 제안 받기]' : ''}</div>}
          <div className="mt-2 grid gap-3 md:grid-cols-2">{pending.map((p) => <ProposalCard key={p.id} p={p} kinds={data.kinds} canEdit={data.canEdit} onChange={reload} />)}</div>
        </section>
        {/* #499-4 상황 매트릭스: 구매자 역할 × 상황 → AI 광고 컨셉 → 대표 1~4개 채택 → 광고형 제작 의뢰 */}
        <ConceptBox />
        {/* #499-6 경쟁 광고 보관함: 링크·영상(수집 없음) → 대본·첫 문장 유형 → 공통 구조 → 우리 대본 3안 */}
        <AdRefBox />
        <BudgetCard b={data.budget} month={data.month} canEdit={data.canEdit} busy={busy} onDraft={draftBudget} onChange={reload} ownerTotal={data.ownerTotal} totalDefault={data.totalDefault} />
        {rest.length > 0 && <details className="rounded-card border border-line bg-white p-3 shadow-card" data-testid="ops-history"><summary className="cursor-pointer text-sm font-semibold">지난 카드 {rest.length}</summary>
          <div className="mt-2 grid gap-3 md:grid-cols-2">{rest.map((p) => <ProposalCard key={p.id} p={p} kinds={data.kinds} canEdit={data.canEdit} onChange={reload} />)}</div></details>}
      </>}
    </div>
  );
}

export function ProposalCard({ p, kinds, canEdit, onChange }: { p: Proposal; kinds: Record<string, string>; canEdit: boolean; onChange: () => void }) {
  const [busy, setBusy] = useState(false); const [reject, setReject] = useState(false); const [note, setNote] = useState('');
  const [sl, sc] = STATUS[p.status] ?? [p.status, ''];
  async function act(body: Record<string, unknown>, msg: string) {
    setBusy(true);
    try { const r = await api<{ revised?: { version: number } | null }>(`/api/marketing/ops/proposals/${p.id}`, { method: 'PATCH', body }); toast.ok(r?.revised ? `반려했습니다 — AI 가 사유를 반영한 v${r.revised.version} 를 다시 올렸습니다` : msg); setReject(false); onChange(); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  const ex = p.executed ?? {};
  return (
    <article className="rounded-card border border-line bg-white p-4 shadow-card" data-testid="ops-card" data-kind={p.kind} data-status={p.status}>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]"><span className="rounded-full bg-violet-50 px-2 py-0.5 font-semibold text-violet-800" data-testid="ops-card-kind">{kinds[p.kind] ?? p.kind}</span>{(p.version ?? 1) > 1 && <span className="rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-800" data-testid="ops-card-version">v{p.version} 반려 반영</span>}
        <span className={cx('rounded-full px-2 py-0.5 font-semibold', sc)} data-testid="ops-card-status">{sl}</span><span className="text-ink-3">{p.source === 'ai' ? 'AI 마케터' : p.source === 'template' ? '기본 카드(AI 없이)' : '직접'} · {fmtDateTime(p.created_at)}</span></div>
      <h3 className="mt-1.5 text-sm font-bold" data-testid="ops-card-title">{p.title}</h3>
      <p className="mt-1 text-sm text-ink-1">{p.summary}</p>
      <ul className="mt-2 space-y-1.5 text-xs">{(p.body?.items ?? []).map((it, i) => <li key={i} className="rounded-input border border-line p-2"><b>{it.title}</b> <span className="text-ink-2">{it.detail}</span>
        <div className="mt-0.5 text-[11px] text-ink-3">{it.expected ? `기대: ${it.expected}` : ''}{it.cost ? ` · 비용: ${it.cost}` : ''}</div></li>)}</ul>
      {p.body?.link && <a href={p.body.link} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 rounded-input border border-violet-300 bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-800" data-testid="ops-card-link">충전 페이지 열기 ↗</a>}
      {p.body?.rationale && <p className="mt-2 rounded-input bg-violet-50/50 px-2.5 py-1.5 text-[11px] text-ink-2" data-testid="ops-card-why"><b className="text-violet-800">근거</b> {p.body.rationale}</p>}
      {p.revision_note && <p className="mt-2 rounded-input border border-amber-200 bg-amber-50/50 px-2.5 py-1.5 text-[11px] text-ink-2" data-testid="ops-card-revision"><b className="text-amber-800">반려 사유 → 반영한 점</b> {p.revision_note}</p>}
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

export function BudgetCard({ b, month, canEdit, busy, onDraft, onChange, ownerTotal, totalDefault, compact }: { b: Budget | null; month: string; canEdit: boolean; busy: boolean; onDraft: () => void; onChange: () => void; ownerTotal?: number | null; totalDefault?: { total: number; source: string }; compact?: boolean }) {
  const [edit, setEdit] = useState(false); const [plan, setPlan] = useState<Record<string, string>>({}); const [bplan, setBplan] = useState<Record<string, string>>({}); const [w, setW] = useState(false); const [reject, setReject] = useState('');
  const [tot, setTot] = useState<string | null>(null);
  async function saveTotal() {
    setW(true);
    try { const n = Number(String(tot ?? '').replace(/[^\d]/g, '')) || null; await api('/api/marketing/ops/budget/total', { method: 'PUT', body: { monthly: n, month } }); toast.ok(n ? `월 광고 예산 총액 ${won(n)} — [AI 다시 계획]을 누르면 이 총액으로 다시 짭니다` : '총액을 지웠습니다(월 목표 광고비 → 지난달 ×1.5 순)'); setTot(null); onChange(); } catch (e: any) { toast.error(e.message); } finally { setW(false); }
  }
  async function act(body: Record<string, unknown>, msg: string) {
    if (!b) return; setW(true);
    try { const r = await api<{ status?: string; version?: number; final?: boolean }>(`/api/marketing/ops/budget/${b.id}`, { method: 'PATCH', body }); toast.ok(r?.status === 'revised' ? `반려했습니다 — AI 가 사유를 반영한 v${r.version} 계획을 다시 올렸습니다` : r?.status === 'rejected' && r.final ? '반려했습니다(3회째 — 재요청 없이 끝)' : msg); setEdit(false); setReject(''); onChange(); } catch (e: any) { toast.error(e.message); } finally { setW(false); }
  }
  const [sl, sc] = b ? STATUS[b.status] ?? [b.status, ''] : ['', ''];
  return (
    <section className="rounded-card border border-line bg-white p-4 shadow-card" data-testid="ops-budget">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-bold">{mk(month)} 광고 예산 계획</h2>
        {b && <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-semibold', sc)} data-testid="budget-status">{sl}</span>}
        {b && (b.version ?? 1) > 1 && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800" data-testid="budget-version">v{b.version} 반려 반영</span>}
        {b && <span className="text-[11px] text-ink-3">{b.source === 'ai' ? 'AI 초안' : b.source === 'template' ? '기본 배분(AI 없이)' : '직접 고침'}{b.total_source ? ` · 총액 기준 ${TOTAL_SRC[b.total_source] ?? b.total_source}` : ''}{b.approved_by_name ? ` · ${b.approved_by_name} 승인 ${b.approved_at ? fmtDateTime(b.approved_at) : ''}` : ''}</span>}
        {canEdit && <span className="ml-auto flex flex-wrap gap-1.5">
          {b?.status === 'pending' && !edit && <Button size="sm" onClick={() => { if (!confirm(`총 ${won(b.total)} 계획을 승인하고 연결된 네이버 캠페인 하루 예산을 바꿀까요?`)) return; act({ action: 'approve' }, '승인 — 연결된 네이버 캠페인 하루 예산을 맞췄습니다'); }} disabled={w || !b.total} title={!b.total ? '예산이 0원이면 집행할 수 없습니다 — [고치기]로 금액을 넣어 주세요' : undefined} data-testid="budget-approve">승인·집행</Button>}
          {b?.status === 'pending' && (!edit ? <Button size="sm" variant="secondary" onClick={() => { setPlan(Object.fromEntries(b.plan.map((p) => [p.provider, String(p.monthly)]))); setBplan(Object.fromEntries((b.brand_plan ?? []).map((x) => [x.brandId, String(x.monthly)]))); setEdit(true); }} data-testid="budget-edit">고치기</Button>
            : <><Button size="sm" onClick={() => act({ action: 'update', plan: b.plan.map((p) => ({ provider: p.provider, monthly: Number(String(plan[p.provider] ?? p.monthly).replace(/[^\d]/g, '')) || 0 })), brands: (b.brand_plan ?? []).map((x) => ({ brandId: x.brandId, monthly: Number(String(bplan[x.brandId] ?? x.monthly).replace(/[^\d]/g, '')) || 0 })) }, '저장했습니다')} disabled={w} data-testid="budget-save">저장</Button><Button size="sm" variant="secondary" onClick={() => setEdit(false)}>취소</Button></>)}
          {/* 로컬 00:10: 승인 대기 상태에서도 [AI 다시 계획] 가능(덮어씀, 승인된 계획은 새 초안으로 대기로 돌아감 — 확인 창) */}
          {!edit && <Button size="sm" variant={b ? 'secondary' : 'primary'} onClick={() => { if (b?.status === 'approved' && !confirm('승인된 계획을 새 초안으로 바꿀까요? 다시 승인해야 합니다(집행된 하루 예산은 그대로).')) return; onDraft(); }} disabled={busy} data-testid="budget-draft">{b ? 'AI 다시 계획' : 'AI 예산 계획 만들기'}</Button>}
        </span>}
      </div>
      {/* 대표 02:30 ③ 총액 = 대표가 적은 월 광고 예산(없으면 월 목표 광고비 → 지난달 ×1.5). 적으면 그 달 월 운영 목표 광고비도 같이 바뀜 */}
      {canEdit && !compact && <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs" data-testid="budget-total-row">
        <span className="text-ink-2">월 광고 예산 총액</span>
        {tot === null ? <><b className="tabular-nums" data-testid="budget-owner-total">{ownerTotal ? won(ownerTotal) : totalDefault ? `${won(totalDefault.total)} (${TOTAL_SRC[totalDefault.source] ?? totalDefault.source})` : '—'}</b>
          <Button size="sm" variant="secondary" onClick={() => setTot(ownerTotal ? String(ownerTotal) : '')} data-testid="budget-total-edit">예산 총액 적기</Button></>
          : <><input className={cx(inputCls, 'h-8 w-36 py-0 text-right text-sm')} value={tot} onChange={(e) => setTot(e.target.value)} inputMode="numeric" placeholder="원" aria-label="월 광고 예산 총액" data-testid="budget-total-in" />
            <Button size="sm" onClick={saveTotal} disabled={w} data-testid="budget-total-save">저장</Button><Button size="sm" variant="secondary" onClick={() => setTot(null)}>취소</Button></>}
        <span className="text-ink-3">월 운영 목표 광고비와 연동 · 비중: 하이링크 35~40 · 워크인 30~35 · 바디랩 15 · 다짐 10(브랜드 설정에서 바꿈)</span></div>}
      {!b ? <p className="mt-2 text-xs text-ink-2" data-testid="budget-empty">이 달 계획이 없습니다. 매월 25일 다음 달 계획 초안이 올라옵니다(광고 계정이 연결된 회사).</p> : <>
        <table className="mt-3 w-full text-xs" data-testid="budget-table"><thead className="text-left text-ink-3"><tr><th className="py-1">채널</th><th className="py-1 text-right">월 예산</th><th className="py-1 text-right">하루</th><th className="py-1 text-right">이달 사용</th><th className="py-1">비고</th></tr></thead>
          <tbody>{b.plan.map((p) => <tr key={p.provider} className="border-t border-line" data-testid={`budget-row-${p.provider}`}>
            <td className="py-1.5">{p.label}{!p.connected && <span className="ml-1 rounded-full bg-slate-100 px-1.5 text-[10px] text-ink-3">연결 없음</span>}</td>
            <td className="py-1.5 text-right tabular-nums">{edit ? <input className={cx(inputCls, 'h-7 w-28 py-0 text-right text-xs')} value={plan[p.provider] ?? ''} onChange={(e) => setPlan({ ...plan, [p.provider]: e.target.value })} inputMode="numeric" aria-label={`${p.label} 월 예산`} data-testid={`budget-in-${p.provider}`} /> : won(p.monthly)}</td>
            <td className="py-1.5 text-right tabular-nums text-ink-2">{won(p.daily)}</td>
            <td className="py-1.5 text-right tabular-nums">{p.connected ? <>{won(p.used)}{p.rate !== null && <span className={cx('ml-1', p.rate >= 80 ? 'font-semibold text-red-700' : 'text-ink-3')}>{p.rate}%</span>}</> : '—'}</td>
            <td className="py-1.5 text-ink-2">{p.note}{p.rate !== null && p.rate >= 80 && p.charge && <a href={p.charge} target="_blank" rel="noreferrer" className="ml-1 font-semibold text-red-700 underline" data-testid={`budget-charge-${p.provider}`}>충전 필요 →</a>}</td></tr>)}</tbody>
          <tfoot><tr className="border-t border-line font-semibold"><td className="py-1.5">합계</td><td className="py-1.5 text-right tabular-nums" data-testid="budget-total">{won(b.total)}</td><td colSpan={3} /></tr></tfoot></table>
        {/* ③ 브랜드 축: 비중(대표 지정 → 이름 기본값) · 우선순위 · 세팅안 수(없으면 '세팅안 필요') · 메모(바디랩 지역 한정) */}
        {!!b.brand_plan?.length && <table className="mt-3 w-full text-xs" data-testid="budget-brands"><thead className="text-left text-ink-3"><tr><th className="py-1">브랜드</th><th className="py-1 text-right">비중</th><th className="py-1 text-right">월 예산</th><th className="py-1">세팅안</th><th className="py-1">메모</th></tr></thead>
          <tbody>{b.brand_plan.map((x) => <tr key={x.brandId} className="border-t border-line" data-testid={`budget-brand-${x.name}`}>
            <td className="py-1.5"><span className="mr-1 rounded-full bg-slate-100 px-1.5 text-[10px] text-ink-3">{x.priority ?? '-'}순위</span>{x.name}</td>
            <td className="py-1.5 text-right tabular-nums">{x.share}%</td>
            <td className="py-1.5 text-right tabular-nums">{edit ? <input className={cx(inputCls, 'h-7 w-28 py-0 text-right text-xs')} value={bplan[x.brandId] ?? ''} onChange={(e) => setBplan({ ...bplan, [x.brandId]: e.target.value })} inputMode="numeric" aria-label={`${x.name} 월 예산`} data-testid={`budget-brand-in-${x.name}`} /> : won(x.monthly)}</td>
            <td className="py-1.5">{x.plans ? <span className="text-emerald-800">네이버 {x.plans}건</span> : <Link href="/s/marketing/ad-ops" className="font-semibold text-amber-800 underline" data-testid={`budget-brand-needs-${x.name}`}>세팅안 필요 →</Link>}</td>
            <td className="py-1.5 text-ink-2">{x.note}</td></tr>)}</tbody></table>}
        {b.reject_note && <p className="mt-2 text-[11px] text-ink-3" data-testid="budget-reject-note">반려 사유: {b.reject_note}</p>}
        {b.revision_note && <p className="mt-1 rounded-input border border-amber-200 bg-amber-50/50 px-2.5 py-1.5 text-[11px] text-ink-2" data-testid="budget-revision"><b className="text-amber-800">반려 사유 → 반영한 점</b> {b.revision_note}</p>}
        {!b.total && b.status === 'pending' && <p className="mt-2 rounded-input bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800" data-testid="budget-zero">모든 채널이 0원입니다 — 승인·집행할 수 없습니다. [고치기]로 월 예산을 넣거나 [AI 다시 계획]을 눌러 주세요.</p>}
        {b.rationale && <p className="mt-2 rounded-input bg-violet-50/50 px-2.5 py-1.5 text-[11px] text-ink-2" data-testid="budget-why"><b className="text-violet-800">근거</b> {b.rationale}</p>}
        {b.executed && <ul className="mt-2 space-y-0.5 text-[11px]" data-testid="budget-executed">{b.executed.map((e: any, i: number) => <li key={i} className={e.ok ? 'text-emerald-800' : 'text-ink-2'}>{e.ok ? '✓' : e.needsPlan ? '⚠' : '·'} {e.brand ? `${e.brand} · ` : ''}{e.provider}{e.name ? ` · ${e.name}` : ''}{e.dailyBudget ? ` 하루 ${won(e.dailyBudget)}` : ''}{e.note ? ` — ${e.note}` : ''}{e.error ? ` — ${e.error}` : ''}</li>)}</ul>}
        {canEdit && b.status === 'pending' && <div className="mt-2 flex items-center gap-1.5"><input className={cx(inputCls, 'h-8 flex-1 py-0 text-sm')} value={reject} onChange={(e) => setReject(e.target.value)} placeholder="반려 사유" aria-label="예산 반려 사유" data-testid="budget-reject-note" /><Button size="sm" variant="secondary" onClick={() => act({ action: 'reject', note: reject }, '반려했습니다')} disabled={w || !reject.trim()} data-testid="budget-reject">반려</Button></div>}
        <p className="mt-2 text-[11px] text-ink-3">승인하면 연결된 네이버 캠페인(세팅안)의 하루 예산을 계획값으로 맞춥니다(월 상한 검사 포함). Google·유튜브·Meta 는 각 매체에서 직접 설정합니다. 소진율 80% 또는 예상 초과 시 “충전 필요” 알림 — 충전은 대표가 매체 사이트에서.</p>
      </>}
    </section>
  );
}
