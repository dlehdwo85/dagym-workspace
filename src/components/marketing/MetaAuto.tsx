'use client';
import { useState } from 'react';
import Link from 'next/link';
import { api, useApi } from '@/components/client';
import { Button, ErrorBox, Field, Modal, Skeleton, cx, fmtDateTime, inputCls, toast } from '@/components/ui';
import { MediaThumb } from '@/components/MediaView';
import { MediaPick } from './MediaPick';

const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`;
const MANAGE_CONNECT = '/api/marketing/ads/connect/meta?manage=1'; // 서버가 Facebook 동의 화면으로 보냄(페이지 이동) — 광고 만들기 권한
const digits = (v: string) => v.replace(/\D/g, '');
/** 서버 metaAutoInput 과 같은 모양 */
export type MetaPlanBody = {
  objective: 'leads' | 'traffic'; pageAccountId: string; leadFormId?: string | null; privacyConfirmed?: boolean;
  creative: { fileId: string; thumbFileId?: string | null; primary: string; headline: string; description?: string; cta: string; link?: string | null };
  location: { address: string; radiusKm: number }; ageMin: number; ageMax: number; startDate: string; endDate: string; dailyBudget: number; totalCap: number;
  guard?: { maxCpl?: number | null; maxCpc?: number | null; minSpend?: number } | null;
};
export type MetaPlanRow = { id: string; account_id: string; brand_id: string | null; brand: string | null; name: string; plan: MetaPlanBody; status: string; external: Record<string, any>; error: string | null;
  created_at: string; approved_at?: string | null; account_label: string; approved_by_name?: string | null; created_by_name: string | null; page_label: string | null; creative_mime: string | null;
  check?: { issues: string[]; warnings: string[] } };
type Change = { id: string; plan_id: string | null; kind: string; before: any; after: any; money_up: boolean; status: string; error: string | null; created_at: string; actor_name: string | null };
type Data = { canEdit: boolean; cap: { monthlyCap: number } | null; monthSpend: number; today: string; minTotalCap: number; cta: string[]; leadCta: string[];
  accounts: { id: string; label: string }[]; pages: { id: string; label: string; brand: string | null; brand_id: string | null; leads: boolean }[]; brands: { id: string; name: string }[]; plans: MetaPlanRow[]; changes: Change[] };

const STATUS: Record<string, [string, string]> = { draft: ['세팅안', 'bg-slate-100 text-ink-2'], creating: ['만드는 중', 'bg-sky-50 text-sky-800'], created: ['광고 초안 · 승인 대기', 'bg-amber-50 text-amber-900'],
  active: ['집행 중', 'bg-emerald-50 text-emerald-800'], paused: ['꺼짐', 'bg-slate-100 text-ink-2'], failed: ['만들기 실패', 'bg-red-50 text-red-800'], archived: ['반려·보관', 'bg-slate-100 text-ink-3'] };
const CTA_LABEL: Record<string, string> = { SIGN_UP: '가입하기', APPLY_NOW: '신청하기', LEARN_MORE: '더 알아보기', GET_QUOTE: '견적 받기', SUBSCRIBE: '구독하기', DOWNLOAD: '다운로드', CONTACT_US: '문의하기', BOOK_NOW: '예약하기' };
const KIND: Record<string, string> = { create: 'Meta 에 꺼진 초안 만듦', enable: '켜기(집행)', pause: '끄기', budget: '하루 예산 변경', auto_pause: '자동 일시정지', approve: '반려' };
const nDays = (p: MetaPlanBody) => Math.round((Date.parse(`${p.endDate}T00:00:00Z`) - Date.parse(`${p.startDate}T00:00:00Z`)) / 864e5) + 1;
const changeDesc = (c: Change) => c.kind === 'budget' ? `${won(c.before?.dailyBudget)} → ${won(c.after?.dailyBudget)}`
  : c.kind === 'auto_pause' ? (c.after?.reason === 'monthly_cap' ? `월 상한 도달(${won(c.after.spend)} / ${won(c.after.cap)})` : `${c.after?.reason === 'cpl' ? '리드당' : '클릭당'} 비용 ${c.after?.value != null ? won(c.after.value) : '(0건)'} > 기준 ${won(c.after?.limit ?? 0)}`)
  : c.kind === 'approve' && c.status === 'rejected' ? `사유: ${c.after?.reason ?? ''}` : c.kind === 'enable' && c.after?.approved ? '승인하고 집행' : '';

/** 한 줄 요약: 목적 · 하루 예산 · 총 상한 · 기간 · 반경 · 나이 */
export function MetaPlanSummary({ p }: { p: MetaPlanBody }) {
  return (
    <p className="text-xs text-ink-2" data-testid="meta-plan-summary">{p.objective === 'leads' ? '리드(광고 안 양식)' : '방문(홈페이지)'} · 하루 <b>{won(p.dailyBudget)}</b> · 총 상한 <b>{won(p.totalCap)}</b> · {p.startDate} ~ {p.endDate}({nDays(p)}일)
      · {p.location.address} 반경 {p.location.radiusKm}km · {p.ageMin}~{p.ageMax >= 65 ? '65+' : p.ageMax}세{p.guard?.maxCpl ? ` · 리드당 ${won(p.guard.maxCpl)} 넘으면 자동 일시정지` : ''}{p.guard?.maxCpc ? ` · 클릭당 ${won(p.guard.maxCpc)} 넘으면 자동 일시정지` : ''}</p>
  );
}
/** 소재 미리보기(피드 모양 비슷하게): 페이지 이름 · 기본 문구 · 이미지/영상 · 제목·버튼 */
export function MetaCreativePreview({ r }: { r: Pick<MetaPlanRow, 'plan' | 'page_label' | 'creative_mime'> }) {
  const c = r.plan.creative;
  return (
    <div className="w-full max-w-[22rem] overflow-hidden rounded-input border border-line bg-white text-xs" data-testid="meta-preview">
      <p className="px-2 pt-2 font-semibold">{r.page_label ?? '페이스북 페이지'} <span className="font-normal text-ink-3">· 광고</span></p>
      <p className="whitespace-pre-wrap break-words px-2 py-1 text-ink-2">{c.primary}</p>
      <MediaThumb src={`/api/library/${c.fileId}/download?inline=1`} mime={r.creative_mime} poster={c.thumbFileId ? `/api/library/${c.thumbFileId}/download?inline=1` : null} className="aspect-square w-full object-cover" />
      <div className="flex items-center gap-2 bg-slate-50 px-2 py-1.5"><span className="min-w-0 flex-1"><b className="block truncate">{c.headline}</b>{c.description && <span className="block truncate text-ink-3">{c.description}</span>}</span>
        <span className="shrink-0 rounded bg-slate-200 px-2 py-1 font-semibold">{CTA_LABEL[c.cta] ?? c.cta}</span></div>
    </div>
  );
}

/** #494 승인함 '광고 초안' 카드: 예산·상한·기간·타깃·소재 미리보기 → [승인하고 집행](관리자, 서버가 상한 다시 확인) · [반려](사유) */
export function MetaDraftCard({ r, canEdit, onChange }: { r: MetaPlanRow; canEdit: boolean; onChange: () => void }) {
  const [busy, setBusy] = useState(false); const [why, setWhy] = useState<string | null>(null);
  const warnings: string[] = r.external?.checks?.warnings ?? [];
  async function act(path: string, body: unknown, ok: string) {
    setBusy(true);
    try { await api(`/api/marketing/ad-ops/meta/${r.id}/${path}`, { body }); toast.ok(ok); onChange(); } catch (e: any) { toast.error(e.message); onChange(); } finally { setBusy(false); }
  }
  return (
    <article className="rounded-card border border-line bg-white p-4 shadow-card" data-testid="meta-draft">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]"><span className="rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-900">광고 초안 · Meta 에 꺼진 채로 만듦</span>
        {r.brand && <span className="rounded-full bg-violet-50 px-2 py-0.5 font-medium text-violet-800">{r.brand}</span>}<span className="text-ink-3">{r.account_label} · {r.created_by_name ?? ''} · {fmtDateTime(r.created_at)}</span></div>
      <h3 className="mt-1.5 text-sm font-bold">{r.name}</h3>
      <MetaPlanSummary p={r.plan} />
      <div className="mt-2 flex flex-wrap gap-3"><MetaCreativePreview r={r} />
        <div className="min-w-0 flex-1 space-y-1 text-xs">
          {r.plan.objective === 'leads' && <p>리드 양식: {r.external?.formName ?? r.plan.leadFormId}{r.external?.privacyUrl ? ' · 개인정보처리방침 링크 있음' : r.plan.privacyConfirmed ? ' · 개인정보처리방침 링크(담당자 확인)' : ''}</p>}
          {r.plan.objective === 'traffic' && <p className="break-all">연결 주소: {r.plan.creative.link}</p>}
          {warnings.length > 0 && <ul className="space-y-0.5 text-amber-800" data-testid="meta-draft-warnings">{warnings.map((w, k) => <li key={k}>확인: {w}</li>)}</ul>}
          <p className="text-ink-3">승인하면 서버가 회사 월 광고비 상한·Meta 쪽 총 상한·하루 예산을 다시 확인한 뒤 켭니다. 켜기 전에는 광고비가 나가지 않습니다.</p>
        </div></div>
      {canEdit ? (why === null ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" disabled={busy} data-testid="meta-draft-approve" onClick={() => confirm(`'${r.name}' 광고를 켭니다. 하루 최대 ${won(r.plan.dailyBudget)}, 모두 합쳐 최대 ${won(r.plan.totalCap)} 이 나갈 수 있습니다. 승인하고 집행할까요?`)
            && act('approve', {}, '승인했습니다 — 광고를 켰습니다')}>승인하고 집행</Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => setWhy('')} data-testid="meta-draft-reject">반려</Button>
        </div>) : (
        <div className="mt-3 flex flex-wrap items-center gap-2"><input className={cx(inputCls, 'min-w-0 flex-1')} value={why} onChange={(e) => setWhy(e.target.value)} placeholder="반려 사유(예: 문구 수정, 예산 줄이기)" aria-label="반려 사유" data-testid="meta-draft-reason" />
          <Button size="sm" disabled={busy || !why.trim()} onClick={() => act('reject', { reason: why.trim() }, '반려했습니다 — Meta 에는 꺼진 채로 남습니다')} data-testid="meta-draft-reject-send">반려 보내기</Button>
          <Button size="sm" variant="secondary" onClick={() => setWhy(null)}>취소</Button></div>))
        : <p className="mt-3 text-xs text-ink-3">승인·반려는 관리자가 합니다.</p>}
    </article>
  );
}

/** #494 광고 운영 › 메타 광고 자동 세팅: 세팅안 → [Meta에 초안 만들기](모두 꺼진 채) → 승인함 '광고 초안' → [승인하고 집행] · 끄기·다시 켜기·하루 예산 · 기록 */
export function MetaAuto() {
  const { data, error, reload } = useApi<Data>('/api/marketing/ad-ops/meta');
  const [form, setForm] = useState<false | true | MetaPlanRow>(false);
  const [busy, setBusy] = useState<string | null>(null);
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Skeleton rows={3} />;
  async function run(key: string, fn: () => Promise<any>, ok: string | ((r: any) => string)) {
    if (busy) return; setBusy(key);
    try { const r = await fn(); toast.ok(typeof ok === 'function' ? ok(r) : ok); } catch (e: any) { toast.error(e.message); } finally { setBusy(null); reload(); }
  }
  const act = (p: MetaPlanRow, body: unknown, ok: string) => run(p.id, () => api(`/api/marketing/ad-ops/plans/${p.id}/action`, { body }), ok);
  return (
    <section className="rounded-card border border-line bg-white p-3 shadow-card" data-testid="meta-auto">
      <div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-semibold">메타 광고 자동 세팅</h2>
        <span className="text-[11px] text-ink-3">소재·지시 → Meta 에 <b>꺼진 초안</b> → 승인함에서 승인하면 집행</span>
        {data.canEdit && <span className="ml-auto flex flex-wrap gap-2">
          {data.accounts.length > 0 && <a href={MANAGE_CONNECT} className="rounded-input border border-line px-2 py-1 text-xs" data-testid="meta-manage-connect">광고 만들기 권한으로 다시 연결</a>}
          <Button size="sm" onClick={() => setForm(true)} disabled={!data.accounts.length || !data.pages.length} data-testid="meta-plan-new">새 메타 광고</Button></span>}</div>
      {!data.accounts.length && <p className="mt-1 text-xs text-ink-3">먼저 <Link href="/s/marketing/ads" className="underline">광고 성과 › 연결</Link>에서 Meta 광고 계정을 연결해 주세요.</p>}
      {data.accounts.length > 0 && !data.pages.length && <p className="mt-1 text-xs text-ink-3">광고를 내보낼 페이스북 페이지가 없습니다 — 연결 계정에서 페이스북 페이지를 먼저 연결해 주세요.</p>}
      {!data.cap && <p className="mt-1 text-xs text-red-700">회사 월 광고비 상한(이 화면 맨 위)을 정해야 Meta 에 초안을 만들 수 있습니다.</p>}
      <ul className="mt-2 space-y-2">{data.plans.map((p) => {
        const [label, cls] = STATUS[p.status] ?? [p.status, 'bg-slate-100'];
        const issues = p.check?.issues ?? []; const warnings = p.check?.warnings ?? [];
        const st = p.external?.stats;
        return (
          <li key={p.id} className={cx('rounded-input border border-line p-2 text-sm', p.status === 'archived' && 'opacity-60')} data-testid="meta-plan" data-status={p.status}>
            <div className="flex flex-wrap items-center gap-2"><b>{p.name}</b>{p.brand && <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-800">{p.brand}</span>}
              <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-medium', cls)} data-testid="meta-plan-status">{label}</span>
              <span className="text-xs text-ink-3">{p.account_label} · {p.page_label ?? ''}</span></div>
            <MetaPlanSummary p={p.plan} />
            <p className="mt-0.5 truncate text-xs"><b className="text-emerald-800">{p.plan.creative.headline}</b> {p.plan.creative.primary}</p>
            {st && <p className="mt-0.5 text-xs text-ink-2" data-testid="meta-plan-stats">지금까지 {won(st.spend)} · 클릭 {st.clicks} · 리드 {st.leads}{st.leads ? ` · 리드당 ${won(st.spend / st.leads)}` : ''} ({fmtDateTime(st.at)} 기준)</p>}
            {issues.length > 0 && <ul className="mt-1 space-y-0.5 text-xs text-red-700" data-testid="meta-plan-issues">{issues.map((x, k) => <li key={k}>고칠 것: {x}</li>)}</ul>}
            {warnings.length > 0 && <ul className="mt-1 space-y-0.5 text-xs text-amber-800" data-testid="meta-plan-warnings">{warnings.map((x, k) => <li key={k}>확인: {x}</li>)}</ul>}
            {p.error && <p className="mt-1 break-words text-xs text-red-700" data-testid="meta-plan-error">{p.error}</p>}
            {data.canEdit && (
              <div className="mt-2 flex flex-wrap gap-2">
                {(p.status === 'draft' || p.status === 'failed') && <Button size="sm" variant="secondary" onClick={() => setForm(p)} data-testid="meta-plan-edit">고치기</Button>}
                {(p.status === 'draft' || p.status === 'failed') && <Button size="sm" disabled={!!issues.length || !data.cap || busy === p.id} data-testid="meta-plan-draft"
                  onClick={() => confirm(`'${p.name}' 을(를) Meta 에 꺼진 상태로 만듭니다(소재 올리기 + 캠페인·광고 세트·광고, 총 상한 ${won(p.plan.totalCap)}). 승인하기 전에는 광고비가 나가지 않습니다. 만들까요?`)
                    && run(p.id, () => api(`/api/marketing/ad-ops/meta/${p.id}/draft`, { body: {} }), (r) => (r?.pending ? r.message : 'Meta 에 꺼진 초안을 만들었습니다 — 승인함에서 승인해 주세요'))}>Meta에 초안 만들기</Button>}
                {p.status === 'created' && <Link href="/s/marketing/approvals?tab=ads" className="rounded-input bg-amber-50 px-2 py-1 text-xs font-medium text-amber-900" data-testid="meta-plan-to-inbox">승인함에서 승인 →</Link>}
                {p.status === 'active' && <Button size="sm" variant="secondary" disabled={busy === p.id} onClick={() => act(p, { action: 'pause' }, '광고를 껐습니다')} data-testid="meta-plan-pause">끄기</Button>}
                {p.status === 'paused' && <Button size="sm" disabled={busy === p.id} data-testid="meta-plan-enable"
                  onClick={() => confirm(`광고를 다시 켭니다. 하루 최대 ${won(p.plan.dailyBudget)}(이번 달 ${won(data.monthSpend)} / 상한 ${data.cap ? won(data.cap.monthlyCap) : '없음'}). 켤까요?`) && act(p, { action: 'enable' }, '광고를 다시 켰습니다')}>다시 켜기</Button>}
                {['created', 'active', 'paused'].includes(p.status) && <Button size="sm" variant="secondary" disabled={busy === p.id} data-testid="meta-plan-budget"
                  onClick={() => { const v = Number(digits(prompt('새 하루 예산(원) — 올리면 상한 검사 후 바뀝니다', String(p.plan.dailyBudget)) ?? '')); if (v) act(p, { action: 'budget', dailyBudget: v }, '하루 예산을 바꿨습니다'); }}>하루 예산</Button>}
                {['draft', 'failed'].includes(p.status) && <Button size="sm" variant="secondary" disabled={busy === p.id} data-testid="meta-plan-archive"
                  onClick={() => { const r = prompt('보관(반려) 사유'); if (r?.trim()) run(p.id, () => api(`/api/marketing/ad-ops/meta/${p.id}/reject`, { body: { reason: r.trim() } }), '보관했습니다'); }}>보관</Button>}
              </div>)}
          </li>);
      })}{!data.plans.length && <li className="text-xs text-ink-3">아직 메타 광고 세팅안이 없습니다</li>}</ul>
      {data.changes.length > 0 && <details className="mt-2 text-xs" data-testid="meta-changes"><summary className="cursor-pointer text-ink-2">메타 광고 변경 기록 {data.changes.length}건</summary>
        <ul className="mt-1 divide-y divide-line">{data.changes.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-2 py-1"><span className="text-ink-3">{fmtDateTime(c.created_at)}</span><b>{KIND[c.kind] ?? c.kind}</b>{c.money_up && <span className="rounded-full bg-amber-50 px-1.5 text-[10px] text-amber-800">돈 나가는 변경</span>}
            <span>{data.plans.find((p) => p.id === c.plan_id)?.name ?? ''} {changeDesc(c)}</span><span className="text-ink-3">{c.actor_name ?? (c.kind === 'auto_pause' ? '워크인 자동' : '')}</span>
            {c.status === 'failed' && <span className="break-words text-red-700">실패: {c.error}</span>}</li>))}</ul></details>}
      {form && <MetaPlanForm d={data} edit={form === true ? undefined : form} onClose={() => setForm(false)} onDone={reload} />}
    </section>
  );
}

function MetaPlanForm({ d, edit, onClose, onDone }: { d: Data; edit?: MetaPlanRow; onClose: () => void; onDone: () => void }) {
  const e0 = edit?.plan;
  const plusDays = (n: number) => { const t = new Date(`${d.today}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
  const [f, setF] = useState({
    name: edit?.name ?? '', brandId: edit?.brand_id ?? '', accountId: edit?.account_id ?? d.accounts[0]?.id ?? '', pageAccountId: e0?.pageAccountId ?? d.pages[0]?.id ?? '',
    objective: (e0?.objective ?? 'leads') as 'leads' | 'traffic', leadFormId: e0?.leadFormId ?? '', privacyConfirmed: !!e0?.privacyConfirmed,
    file: e0 ? [{ id: e0.creative.fileId, title: '선택한 소재' }] : [] as { id: string; title: string }[], thumb: e0?.creative.thumbFileId ? [{ id: e0.creative.thumbFileId, title: '표지' }] : [] as { id: string; title: string }[],
    primary: e0?.creative.primary ?? '', headline: e0?.creative.headline ?? '', description: e0?.creative.description ?? '', cta: e0?.creative.cta ?? 'SIGN_UP', link: e0?.creative.link ?? '',
    address: e0?.location.address ?? '', radiusKm: String(e0?.location.radiusKm ?? 3), ageMin: String(e0?.ageMin ?? 20), ageMax: String(e0?.ageMax ?? 65),
    startDate: e0?.startDate ?? plusDays(1), endDate: e0?.endDate ?? plusDays(14), dailyBudget: String(e0?.dailyBudget ?? 10000), totalCap: String(e0?.totalCap ?? 150000),
    maxCpl: e0?.guard?.maxCpl ? String(e0.guard.maxCpl) : '', maxCpc: e0?.guard?.maxCpc ? String(e0.guard.maxCpc) : '', minSpend: String(e0?.guard?.minSpend ?? 30000),
  });
  const forms = useApi<{ forms: { id: string; name: string; status: string }[] }>(f.objective === 'leads' && f.pageAccountId ? `/api/marketing/ad-ops/meta/forms?pageAccountId=${f.pageAccountId}` : null, [f.pageAccountId, f.objective]);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));
  const ctas = f.objective === 'leads' ? d.leadCta : d.cta;
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!f.file.length) return toast.error('소재(이미지·영상)를 자료실에서 골라 주세요');
    setBusy(true);
    try {
      const body = { accountId: f.accountId, brandId: f.brandId || null, name: f.name, objective: f.objective, pageAccountId: f.pageAccountId,
        leadFormId: f.objective === 'leads' ? f.leadFormId || null : null, privacyConfirmed: f.privacyConfirmed,
        creative: { fileId: f.file[f.file.length - 1].id, thumbFileId: f.thumb.length ? f.thumb[f.thumb.length - 1].id : null, primary: f.primary, headline: f.headline, description: f.description, cta: f.cta, link: f.link.trim() || null },
        location: { address: f.address, radiusKm: Number(f.radiusKm) || 3 }, ageMin: Number(f.ageMin) || 20, ageMax: Number(f.ageMax) || 65, startDate: f.startDate, endDate: f.endDate,
        dailyBudget: Number(f.dailyBudget), totalCap: Number(f.totalCap),
        guard: f.maxCpl || f.maxCpc ? { maxCpl: f.maxCpl ? Number(f.maxCpl) : null, maxCpc: f.maxCpc ? Number(f.maxCpc) : null, minSpend: Number(f.minSpend) || 30000 } : null };
      const r = await api<{ issues: string[] }>(edit ? `/api/marketing/ad-ops/meta/${edit.id}` : '/api/marketing/ad-ops/meta', { method: edit ? 'PUT' : 'POST', body });
      r.issues.length ? toast.error(`저장했습니다 — 고칠 것 ${r.issues.length}건을 고쳐야 Meta 에 초안을 만들 수 있습니다`) : toast.ok('세팅안을 저장했습니다 — [Meta에 초안 만들기]를 눌러 주세요');
      onDone(); onClose();
    } catch (er: any) { toast.error(er.message); } finally { setBusy(false); }
  }
  const len = (s: string) => [...s].length;
  return (
    <Modal open onClose={onClose} title={edit ? '메타 광고 세팅안 고치기' : '새 메타 광고(꺼진 초안으로 만듦)'} wide>
      <form onSubmit={save} className="grid gap-3 text-sm" data-testid="meta-plan-form">
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="캠페인 이름"><input className={inputCls} value={f.name} onChange={(e) => set({ name: e.target.value })} required maxLength={60} data-testid="meta-name" /></Field>
          {d.brands.length > 0 && <Field label="브랜드"><select className={inputCls} value={f.brandId} onChange={(e) => set({ brandId: e.target.value })} data-testid="meta-brand"><option value="">브랜드 없음</option>{d.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>}
          <Field label="Meta 광고 계정"><select className={inputCls} value={f.accountId} onChange={(e) => set({ accountId: e.target.value })} data-testid="meta-account">{d.accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></Field>
          <Field label="광고를 내보낼 페이스북 페이지"><select className={inputCls} value={f.pageAccountId} onChange={(e) => set({ pageAccountId: e.target.value, leadFormId: '' })} data-testid="meta-page">{d.pages.map((p) => <option key={p.id} value={p.id}>{p.label}{p.brand ? ` (${p.brand})` : ''}</option>)}</select></Field>
        </div>
        <Field label="목적"><div className="flex gap-3" role="radiogroup">
          {(['leads', 'traffic'] as const).map((o) => <label key={o} className="flex items-center gap-1.5 text-sm"><input type="radio" checked={f.objective === o} onChange={() => set({ objective: o, cta: o === 'leads' ? 'SIGN_UP' : 'LEARN_MORE' })} data-testid={`meta-objective-${o}`} />{o === 'leads' ? '리드(광고 안 신청 양식)' : '방문(홈페이지·예약 페이지)'}</label>)}</div></Field>
        {f.objective === 'leads' ? (
          <div className="grid gap-2 rounded-input border border-line p-2">
            <Field label="리드 양식(Meta 광고 관리자 › 양식에서 만든 것)">{forms.data?.forms.length ? (
              <select className={inputCls} value={f.leadFormId} onChange={(e) => set({ leadFormId: e.target.value })} data-testid="meta-form"><option value="">고르기</option>{forms.data.forms.map((x) => <option key={x.id} value={x.id}>{x.name}{x.status && x.status !== 'ACTIVE' ? ` (${x.status})` : ''}</option>)}</select>
            ) : <input className={inputCls} value={f.leadFormId} onChange={(e) => set({ leadFormId: digits(e.target.value) })} placeholder={forms.error ? '양식 목록을 못 읽었습니다 — 양식 번호 직접 입력' : '양식 번호'} data-testid="meta-form" />}</Field>
            <label className="flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5" checked={f.privacyConfirmed} onChange={(e) => set({ privacyConfirmed: e.target.checked })} data-testid="meta-privacy" />
              <span>이 양식에 <b>개인정보처리방침 링크</b>가 들어 있는 것을 확인했습니다(Meta 에서 링크를 읽으면 그 결과로 다시 확인합니다).</span></label>
          </div>) : <Field label="연결 주소"><input className={inputCls} value={f.link} onChange={(e) => set({ link: e.target.value })} placeholder="https://" data-testid="meta-link" /></Field>}
        <div className="grid gap-2 rounded-input border border-line p-2">
          <span className="text-xs font-medium text-ink-2">소재 — 자료실 이미지·영상 1개(기밀 자료는 보낼 수 없음)</span>
          <MediaPick value={f.file} onChange={(v) => set({ file: v.slice(-1) })} label="소재 고르기" />
          <MediaPick value={f.thumb} onChange={(v) => set({ thumb: v.slice(-1) })} label="영상이면 표지 이미지(선택)" />
          <Field label={`기본 문구 ${len(f.primary)}자(앞 125자가 먼저 보임)`}><textarea className={inputCls} rows={3} value={f.primary} onChange={(e) => set({ primary: e.target.value })} required maxLength={1000} data-testid="meta-primary" /></Field>
          <div className="grid gap-2 sm:grid-cols-3">
            <Field label={`제목 ${len(f.headline)}/40`}><input className={inputCls} value={f.headline} onChange={(e) => set({ headline: e.target.value })} required maxLength={80} data-testid="meta-headline" /></Field>
            <Field label="설명(선택)"><input className={inputCls} value={f.description} onChange={(e) => set({ description: e.target.value })} maxLength={80} data-testid="meta-desc" /></Field>
            <Field label="버튼"><select className={inputCls} value={f.cta} onChange={(e) => set({ cta: e.target.value })} data-testid="meta-cta">{ctas.map((c) => <option key={c} value={c}>{CTA_LABEL[c] ?? c}</option>)}</select></Field>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-4">
          <Field label="지역(단지·매장 주소)" className="sm:col-span-2"><input className={inputCls} value={f.address} onChange={(e) => set({ address: e.target.value })} required minLength={4} maxLength={120} placeholder="예: 경기 수원시 영통구 광교중앙로 140" data-testid="meta-address" /></Field>
          <Field label="반경(km, 1~80)"><input className={inputCls} inputMode="decimal" value={f.radiusKm} onChange={(e) => set({ radiusKm: e.target.value.replace(/[^\d.]/g, '') })} data-testid="meta-radius" /></Field>
          <Field label="나이"><div className="flex items-center gap-1"><input className={inputCls} inputMode="numeric" value={f.ageMin} onChange={(e) => set({ ageMin: digits(e.target.value) })} aria-label="최소 나이" data-testid="meta-age-min" />~
            <input className={inputCls} inputMode="numeric" value={f.ageMax} onChange={(e) => set({ ageMax: digits(e.target.value) })} aria-label="최대 나이(65 = 65세 이상)" data-testid="meta-age-max" /></div></Field>
        </div>
        <div className="grid gap-2 sm:grid-cols-4">
          <Field label="시작일"><input type="date" className={inputCls} value={f.startDate} min={d.today} onChange={(e) => set({ startDate: e.target.value })} required data-testid="meta-start" /></Field>
          <Field label="끝나는 날"><input type="date" className={inputCls} value={f.endDate} min={f.startDate} onChange={(e) => set({ endDate: e.target.value })} required data-testid="meta-end" /></Field>
          <Field label="하루 예산(원)"><input className={inputCls} inputMode="numeric" value={f.dailyBudget} onChange={(e) => set({ dailyBudget: digits(e.target.value) })} required data-testid="meta-daily" /></Field>
          <Field label={`총 상한(원, ${won(d.minTotalCap)} 이상)`}><input className={inputCls} inputMode="numeric" value={f.totalCap} onChange={(e) => set({ totalCap: digits(e.target.value) })} required data-testid="meta-cap" /></Field>
        </div>
        <details className="rounded-input border border-line p-2" open={!!(f.maxCpl || f.maxCpc)}>
          <summary className="cursor-pointer text-xs font-medium">자동 일시정지 기준(권장) — 성과가 기준보다 나쁘면 워크인이 끔(켜는 것·예산 올리기는 항상 승인)</summary>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <Field label="리드당 비용 기준(원)"><input className={inputCls} inputMode="numeric" value={f.maxCpl} onChange={(e) => set({ maxCpl: digits(e.target.value) })} placeholder="예: 20000" data-testid="meta-max-cpl" /></Field>
            <Field label="클릭당 비용 기준(원)"><input className={inputCls} inputMode="numeric" value={f.maxCpc} onChange={(e) => set({ maxCpc: digits(e.target.value) })} placeholder="예: 1500" data-testid="meta-max-cpc" /></Field>
            <Field label="판단 시작 금액(원)"><input className={inputCls} inputMode="numeric" value={f.minSpend} onChange={(e) => set({ minSpend: digits(e.target.value) })} data-testid="meta-min-spend" /></Field>
          </div>
        </details>
        <p className="text-[11px] text-ink-3">저장해도 Meta 에는 아직 만들지 않습니다. 목록에서 검사 결과를 보고 [Meta에 초안 만들기]를 누르면 캠페인·광고 세트·광고가 모두 <b>꺼진 상태</b>로 만들어지고, 승인함에서 관리자가 승인해야 켜집니다.</p>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>취소</Button><Button type="submit" disabled={busy} data-testid="meta-save">세팅안 저장</Button></div>
      </form>
    </Modal>
  );
}
