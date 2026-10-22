'use client';
import { useRef, useState } from 'react';
import { api, useApi } from '@/components/client';
import { Button, ErrorBox, Field, Modal, Skeleton, cx, fmtDateTime, inputCls, toast } from '@/components/ui';
import { NAVER_REGIONS, regionLabel } from '@/lib/naverRegions';

const C = '#7C3AED';
/** 네이버 소재 허용 문자(서버 검사와 같은 규칙) — 저장 전에 바로 표시 */
const NAVER_OK = /^[가-힣ㄱ-ㅎㅏ-ㅣA-Za-z0-9 .,!?%&()+\-/:'"~@#*\[\]]$/;
const badChars = (t: string) => [...new Set([...t].filter((c) => !NAVER_OK.test(c)))].join(' ');
const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`;
const n0 = (v: number) => Math.round(v).toLocaleString('ko-KR');
type Test = { on: boolean; days: number; minImpressions: number; afterBudget?: number | null };
type AbRow = { adId: string; label: string; headline: string; impressions: number; clicks: number; cost: number; conversions: number; paused: boolean; ctr: number | null; cvr: number | null };
/** 광고 최적화 1차 ① 3안 소액 테스트 판정(서버 계산) */
type Ab = { status: 'not_started' | 'running' | 'winner' | 'partial' | 'tie'; metric: 'ctr' | 'cvr'; days: number; minImpressions: number; leader: string | null; losers: string[]; message: string; ads: AbRow[]; afterBudget: number | null; on: boolean };
/** 광고 최적화 1차 ② 동네 타깃(반경은 동네 고르기용 — 네이버 파워링크는 반경 지정 없음) */
type Local = { center: string; radiusKm: number; areas: string[]; region: string[]; abroad: boolean };
const NO_LOCAL: Local = { center: '', radiusKm: 3, areas: [], region: [], abroad: false };
type Plan = { id: string; account_id: string; brand_id?: string | null; brand?: string | null; kind: string; name: string; plan: { dailyBudget: number; bidAmt: number; channelId: string; keywords: string[]; ads: { headline: string; description: string; url: string }[]; test?: Test; local?: Local };
  status: string; external: Record<string, unknown>; error: string | null; created_at: string; approved_at: string | null; account_label: string; approved_by_name: string | null; issues: string[]; ab?: Ab | null };
type Change = { id: string; plan_id: string | null; kind: string; before: any; after: any; money_up: boolean; status: string; error: string | null; revert_of: string | null; created_at: string; actor_name: string | null };
type Data = { canEdit: boolean; cap: { monthlyCap: number; stoppedMonth: string | null } | null; monthSpend: number; month: string; accounts: { id: string; label: string; external_id: string }[]; brands: { id: string; name: string }[]; plans: Plan[]; changes: Change[];
  savings?: { pct: number; spend: number; amount: number; custom: boolean } };
const STATUS: Record<string, [string, string]> = { draft: ['세팅안', 'bg-slate-100 text-ink-2'], creating: ['만드는 중', 'bg-sky-50 text-sky-800'], created: ['만듦 · 꺼짐', 'bg-sky-50 text-sky-800'], active: ['켜짐', 'bg-emerald-50 text-emerald-800'],
  paused: ['꺼짐', 'bg-amber-50 text-amber-800'], failed: ['만들기 실패', 'bg-red-50 text-red-800'] };
const kwOk = (x: unknown) => Array.isArray(x) && x.length > 0 && x.every((v) => typeof v === 'string' && v && v !== 'undefined');
const KIND: Record<string, string> = { create: '꺼진 상태로 생성', enable: '켜기', pause: '끄기', budget: '하루 예산 변경', auto_pause: '상한 도달 자동 중지', sync: '키워드 다시 읽기', ad_pause: '소재 끄기', ad_resume: '소재 켜기',
  region: '광고 지역 변경', keywords_add: '키워드 추가', keywords_remove: '키워드 빼기' };
const REVERTIBLE = ['enable', 'pause', 'budget', 'auto_pause', 'ad_pause', 'ad_resume', 'region', 'keywords_add'];
const kwList = (k: string[] = []) => (k.length > 3 ? `${k.slice(0, 3).join(', ')} 외 ${k.length - 3}개` : k.join(', '));
const adName = (plans: Plan[], c: Change, id: string) => { const p = plans.find((x) => x.id === c.plan_id); const k = ((p?.external?.adIds as string[] | undefined) ?? []).indexOf(id); return k >= 0 ? `안 ${'ABC'[k] ?? k + 1}` : id; };
const desc = (c: Change, plans: Plan[] = []) => c.kind === 'budget' ? `${won(c.before?.dailyBudget)} → ${won(c.after?.dailyBudget)}` : c.kind === 'auto_pause' && c.after?.spend ? `이번 달 ${won(c.after.spend)} / 상한 ${won(c.after.cap)}`
  : (c.kind === 'ad_pause' || c.kind === 'ad_resume') ? `${((c.after?.adIds ?? []) as string[]).map((x) => adName(plans, c, x)).join(', ')}${c.after?.ab ? ' (3안 테스트 결과)' : ''}`
  : c.kind === 'region' && c.after?.KR ? `${c.before ? `${regionLabel(c.before.KR)} → ` : ''}${regionLabel(c.after.KR)}${c.after.OTHERS?.includes('00') || c.after.abroad ? ' · 해외 포함' : ''}`
  : c.kind === 'keywords_add' ? kwList(c.after?.keywords) : c.kind === 'keywords_remove' ? kwList(c.before?.keywords) : '';
const AB_STATUS: Record<string, [string, string]> = { not_started: ['켜기 전', 'bg-slate-100 text-ink-2'], running: ['비교 중', 'bg-sky-50 text-sky-800'], winner: ['이긴 안 나옴', 'bg-emerald-50 text-emerald-800'],
  partial: ['일부 판정', 'bg-amber-50 text-amber-800'], tie: ['차이 뚜렷하지 않음', 'bg-slate-100 text-ink-2'] };

/**
 * V44 ① 광고 운영(네이버 검색광고 파워링크) — 세팅안 → [승인하고 시작](꺼진 상태로 생성) → [켜기](상한 검사) · 변경 기록·되돌리기.
 * 대표 결정 전 기본값: 월 상한 필수 입력, 넘으면 워크인이 켠 광고 자동 중지.
 */
export function AdOps() {
  const { data, error, reload } = useApi<Data>('/api/marketing/ad-ops');
  const [capIn, setCapIn] = useState('');
  const [form, setForm] = useState<false | true | Plan>(false); // true = 새 세팅안, Plan = 고치기
  const [busy, setBusy] = useState<string | null>(null);
  const [local, setLocal] = useState<{ p: Plan; mode: 'keywords' | 'region' } | null>(null); // 광고 최적화 1차 ② 만든 세팅안의 동네 키워드·광고 지역
  const running = useRef(false); // 두 번 눌러도 요청 한 번(운영 10/19 — 다시 읽기 요청 2번)
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Skeleton rows={6} />;
  const pct = data.cap ? Math.min(100, (data.monthSpend / data.cap.monthlyCap) * 100) : 0;
  async function run(key: string, fn: () => Promise<unknown>, ok: string) { if (running.current) return; running.current = true; setBusy(key); try { await fn(); toast.ok(ok); reload(); } catch (e: any) { toast.error(e.message); reload(); } finally { setBusy(null); running.current = false; } }
  const saveCap = () => run('cap', () => api('/api/marketing/ad-ops/cap', { method: 'PUT', body: { monthlyCap: Number(capIn.replace(/\D/g, '')) } }), '월 광고비 상한을 저장했습니다');
  const reverted = new Set(data.changes.map((c) => c.revert_of).filter(Boolean));
  return (
    <div className="space-y-4" data-testid="ad-ops">
      <div><h1 className="text-xl font-bold" style={{ color: C }}>광고 운영</h1>
        <p className="text-xs text-ink-2">세팅안을 만들고 [승인하고 시작]을 누르면 네이버 검색광고에 <b>꺼진 상태</b>로 만들어집니다. 확인한 뒤 [켜기]를 눌러야 광고비가 나갑니다. 모든 변경은 아래 기록에 남고 되돌릴 수 있습니다.</p></div>

      <section className="rounded-card border border-line bg-white p-3 shadow-card" data-testid="ad-cap">
        <div className="flex flex-wrap items-baseline gap-2"><h2 className="text-sm font-semibold">이번 달 광고비 · 월 상한</h2>
          <span className="text-sm">{won(data.monthSpend)} / {data.cap ? <b>{won(data.cap.monthlyCap)}</b> : <span className="text-red-700">상한 없음</span>}</span>
          {data.cap?.stoppedMonth === data.month && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-800">상한 도달 — 자동 중지됨</span>}</div>
        {data.cap && <div className="mt-2 h-2 rounded-full bg-slate-100"><div className={cx('h-2 rounded-full', pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-emerald-500')} style={{ width: `${pct}%` }} /></div>}
        {!data.cap && <p className="mt-1 text-xs text-red-700" data-testid="ad-cap-required">광고를 만들거나 켜려면 먼저 월 광고비 상한을 정해 주세요. 이번 달 광고비(모든 매체 합계)가 상한에 닿으면 워크인이 켠 광고를 자동으로 끕니다.</p>}
        {data.canEdit && (
          <div className="mt-2 flex flex-wrap items-center gap-2"><input className={cx(inputCls, 'w-40')} inputMode="numeric" value={capIn} onChange={(e) => setCapIn(e.target.value)} placeholder={data.cap ? String(data.cap.monthlyCap) : '예: 500000'} aria-label="월 광고비 상한(원)" data-testid="ad-cap-input" />
            <Button size="sm" onClick={saveCap} disabled={!capIn || busy === 'cap'} data-testid="ad-cap-save">상한 저장</Button>
            <span className="text-[11px] text-ink-3">광고비는 하루 한 번 읽어 오므로 실제보다 하루 늦게 반영됩니다.</span></div>)}
        {data.savings && <p className="mt-2 text-xs text-ink-2" data-testid="ad-savings">이번 달 대행사 대비 절감액(추정) <b className="text-emerald-800">{won(data.savings.amount)}</b> — 광고비 {won(data.savings.spend)} × 대행 수수료율 {data.savings.pct}%{data.savings.custom ? '(회사 설정)' : '(기본값 — 통상 15~20%)'}
          {data.canEdit && <> · <button type="button" className="underline" data-testid="ad-fee-edit" onClick={() => { const v = prompt('대행 수수료율(%) — 비우면 기본 15%', String(data.savings!.pct)); if (v === null) return; const t = v.trim();
            if (t !== '' && !(Number(t) >= 0 && Number(t) <= 50)) return toast.error('0~50 사이 숫자로 적어 주세요'); run('fee', () => api('/api/marketing/ad-ops/fee', { method: 'PUT', body: { pct: t === '' ? null : Number(t) } }), '대행 수수료율을 저장했습니다'); }}>수수료율 바꾸기</button></>}</p>}
      </section>

      <section className="rounded-card border border-line bg-white p-3 shadow-card">
        <div className="flex items-center gap-2"><h2 className="text-sm font-semibold">네이버 파워링크 세팅안</h2>
          {data.canEdit && <Button size="sm" className="ml-auto" onClick={() => setForm(true)} disabled={!data.accounts.length} title={data.accounts.length ? undefined : '네이버 검색광고 연결 후'} data-testid="ad-plan-new">새 세팅안</Button>}</div>
        {!data.accounts.length && <p className="mt-1 text-xs text-ink-3">먼저 설정 › 연결 계정에서 네이버 검색광고를 연결해 주세요.</p>}
        <ul className="mt-2 space-y-2">{data.plans.map((p) => {
          const [label, cls] = STATUS[p.status] ?? [p.status, 'bg-slate-100'];
          return (
            <li key={p.id} className="rounded-input border border-line p-2 text-sm" data-testid="ad-plan">
              <div className="flex flex-wrap items-center gap-2"><b>{p.name}</b>{p.brand && <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-800" data-testid="ad-plan-brand">{p.brand}</span>}<span className={cx('rounded-full px-2 py-0.5 text-[11px] font-medium', cls)} data-testid="ad-plan-status">{label}</span>
                <span className="text-xs text-ink-2">{p.account_label} · 하루 {won(p.plan.dailyBudget)} · 입찰 {won(p.plan.bidAmt)} · 키워드 {p.plan.keywords.length}개</span></div>
              <p className="mt-0.5 text-xs text-ink-2">키워드: {p.plan.keywords.join(', ')}</p>
              {p.plan.ads.map((a, k) => <p key={k} className="mt-0.5 text-xs"><b className="text-emerald-800">{a.headline}</b> {a.description} <span className="text-ink-3">{a.url}</span></p>)}
              {p.issues.length > 0 && <ul className="mt-1 space-y-0.5 text-xs text-amber-800" data-testid="ad-plan-issues">{p.issues.map((x, k) => <li key={k}>검사: {x}</li>)}</ul>}
              {p.error && <p className="mt-1 break-words text-xs text-red-700">{p.error}</p>}
              {p.plan.local && (p.plan.local.center || p.plan.local.areas?.length || p.plan.local.region?.length) ? <p className="mt-0.5 text-xs text-ink-2" data-testid="ad-plan-local">동네 타깃: {p.plan.local.center ? `${p.plan.local.center} 반경 ${p.plan.local.radiusKm}km` : '중심 없음'}{p.plan.local.areas?.length ? ` · 동네 ${p.plan.local.areas.length}곳(${kwList(p.plan.local.areas)})` : ''} · 광고 지역 {regionLabel(p.plan.local.region)}{p.plan.local.abroad ? '·해외' : ''}</p> : null}
              {p.ab && <AbBox p={p} ab={p.ab} canEdit={data.canEdit} busy={busy === p.id} run={run} />}
              {data.canEdit && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {(p.status === 'draft' || p.status === 'failed') && <Button size="sm" variant="secondary" onClick={() => setForm(p)} data-testid="ad-plan-edit">수정</Button>}
                  {(p.status === 'draft' || p.status === 'failed') && <Button size="sm" disabled={!!p.issues.length || !data.cap || busy === p.id} data-testid="ad-plan-approve"
                    onClick={() => confirm(`'${p.name}' 을(를) 네이버에 꺼진 상태로 만들까요? 켜기 전에는 광고비가 나가지 않습니다.`) && run(p.id, () => api(`/api/marketing/ad-ops/plans/${p.id}/approve`, { body: {} }), '네이버에 꺼진 상태로 만들었습니다')}>승인하고 시작</Button>}
                  {(p.status === 'created' || p.status === 'paused') && <Button size="sm" disabled={busy === p.id} data-testid="ad-plan-enable"
                    onClick={() => confirm(`광고를 켭니다. 하루 최대 ${won(p.plan.dailyBudget)} 이 나갈 수 있습니다(이번 달 ${won(data.monthSpend)} / 상한 ${data.cap ? won(data.cap.monthlyCap) : '없음'}). 켤까요?`) && run(p.id, () => api(`/api/marketing/ad-ops/plans/${p.id}/action`, { body: { action: 'enable' } }), '광고를 켰습니다')}>켜기</Button>}
                  {p.status === 'active' && <Button size="sm" variant="secondary" disabled={busy === p.id} data-testid="ad-plan-pause" onClick={() => run(p.id, () => api(`/api/marketing/ad-ops/plans/${p.id}/action`, { body: { action: 'pause' } }), '광고를 껐습니다')}>끄기</Button>}
                  {/* 운영 10/19: 키워드 id 가 비어 있으면(생성 응답 파싱 실패) 네이버에서 다시 읽기 — 켜기·예산은 그대로 */}
                  {['created', 'active', 'paused'].includes(p.status) && !kwOk(p.external?.keywordIds) && <Button size="sm" variant="secondary" disabled={busy === p.id} data-testid="ad-plan-sync"
                    onClick={() => run(p.id, () => api(`/api/marketing/ad-ops/plans/${p.id}/action`, { body: { action: 'sync' } }), '키워드 id 를 다시 읽었습니다')}>키워드 다시 읽기</Button>}
                  {['created', 'active', 'paused'].includes(p.status) && <Button size="sm" variant="secondary" disabled={busy === p.id} onClick={() => setLocal({ p, mode: 'keywords' })} data-testid="ad-local-kw">동네 키워드 추가</Button>}
                  {['created', 'active', 'paused'].includes(p.status) && <Button size="sm" variant="secondary" disabled={busy === p.id} onClick={() => setLocal({ p, mode: 'region' })} data-testid="ad-local-region">광고 지역</Button>}
                  {['created', 'active', 'paused'].includes(p.status) && <Button size="sm" variant="secondary" disabled={busy === p.id} data-testid="ad-plan-budget"
                    onClick={() => { const v = Number(prompt('새 하루 예산(원)', String(p.plan.dailyBudget))?.replace(/\D/g, '')); if (v) run(p.id, () => api(`/api/marketing/ad-ops/plans/${p.id}/action`, { body: { action: 'budget', dailyBudget: v } }), '하루 예산을 바꿨습니다'); }}>하루 예산</Button>}
                </div>)}
            </li>);
        })}{!data.plans.length && <li className="text-xs text-ink-3">세팅안이 없습니다</li>}</ul>
      </section>

      <section className="rounded-card border border-line bg-white p-3 shadow-card" data-testid="ad-changes">
        <h2 className="text-sm font-semibold">변경 기록</h2>
        <ul className="mt-1 divide-y divide-line text-xs">{data.changes.map((c) => {
          const plan = data.plans.find((p) => p.id === c.plan_id);
          const canRevert = data.canEdit && c.status === 'applied' && REVERTIBLE.includes(c.kind) && !reverted.has(c.id);
          return (
            <li key={c.id} className="flex flex-wrap items-center gap-2 py-1.5" data-testid="ad-change">
              <span className="text-ink-3">{fmtDateTime(c.created_at)}</span><b>{KIND[c.kind] ?? c.kind}</b>{c.money_up && <span className="rounded-full bg-amber-50 px-1.5 text-[10px] text-amber-800">돈 나가는 변경</span>}
              <span>{plan?.name ?? ''} {desc(c, data.plans)}</span><span className="text-ink-3">{c.actor_name ?? (c.kind === 'auto_pause' ? '워크인 자동' : '')}</span>
              {c.status === 'failed' && <span className="break-words text-red-700">실패: {c.error}</span>}
              {c.revert_of && <span className="text-ink-3">(되돌림)</span>}
              {canRevert && <Button size="sm" variant="secondary" className="ml-auto" onClick={() => confirm('이 변경 전으로 되돌릴까요?') && run(c.id, () => api(`/api/marketing/ad-ops/changes/${c.id}/revert`, { body: {} }), '되돌렸습니다')} data-testid="ad-change-revert">되돌리기</Button>}
            </li>);
        })}{!data.changes.length && <li className="py-1.5 text-ink-3">아직 변경이 없습니다</li>}</ul>
      </section>
      {form && <PlanForm accounts={data.accounts} brands={data.brands ?? []} edit={form === true ? undefined : form} onClose={() => setForm(false)} onDone={reload} />}
      {local?.mode === 'keywords' && <Modal open onClose={() => setLocal(null)} title="동네 키워드 추가">
        <LocalFinder accountId={local.p.account_id} value={{ ...NO_LOCAL, ...(local.p.plan.local ?? {}) }} have={local.p.plan.keywords} pickLabel="광고에 키워드 추가"
          onPick={(keywords, v) => { const lp = local.p; setLocal(null); run(lp.id, () => api(`/api/marketing/ad-ops/plans/${lp.id}/action`, { body: { action: 'keywords_add', keywords, local: { center: v.center, radiusKm: v.radiusKm, areas: v.areas } } }), `키워드 ${keywords.length}개를 광고에 넣었습니다(그룹 입찰가)`); }} />
      </Modal>}
      {local?.mode === 'region' && <RegionModal p={local.p} onClose={() => setLocal(null)} onSave={(region, abroad) => { const lp = local.p; setLocal(null);
        run(lp.id, () => api(`/api/marketing/ad-ops/plans/${lp.id}/action`, { body: { action: 'region', region, abroad } }), `광고 지역을 ${regionLabel(region)}${abroad ? '·해외' : ''}(으)로 바꿨습니다`); }} />}
    </div>
  );
}

function PlanForm({ accounts, brands, edit, onClose, onDone }: { accounts: Data['accounts']; brands: Data['brands']; edit?: Plan; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState(edit
    ? { accountId: edit.account_id, brandId: edit.brand_id ?? '', name: edit.name, dailyBudget: String(edit.plan.dailyBudget), bidAmt: String(edit.plan.bidAmt), channelId: edit.plan.channelId, keywords: edit.plan.keywords.join(', '), ads: edit.plan.ads.map((a) => ({ ...a })),
        test: { on: !!edit.plan.test?.on, days: String(edit.plan.test?.days ?? 7), min: String(edit.plan.test?.minImpressions ?? 300), after: edit.plan.test?.afterBudget ? String(edit.plan.test.afterBudget) : '' }, local: { ...NO_LOCAL, ...(edit.plan.local ?? {}) } }
    : { accountId: accounts[0]?.id ?? '', brandId: '', name: '', dailyBudget: '10000', bidAmt: '300', channelId: '', keywords: '', ads: [{ headline: '', description: '', url: 'https://' }], test: { on: false, days: '7', min: '300', after: '' }, local: NO_LOCAL });
  const ch = useApi<{ channels: { id: string; name: string; url: string | null; type: string }[] }>(f.accountId ? `/api/marketing/ad-ops/channels?accountId=${f.accountId}` : null, [f.accountId]);
  const [busy, setBusy] = useState(false);
  const setAd = (k: number, patch: Partial<(typeof f.ads)[number]>) => setF({ ...f, ads: f.ads.map((a, i) => (i === k ? { ...a, ...patch } : a)) });
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try {
      const r = await api<{ issues: string[] }>(edit ? `/api/marketing/ad-ops/plans/${edit.id}` : '/api/marketing/ad-ops/plans', { method: edit ? 'PUT' : 'POST', body: { accountId: f.accountId, brandId: f.brandId || null, name: f.name, dailyBudget: Number(f.dailyBudget), bidAmt: Number(f.bidAmt), channelId: f.channelId,
        keywords: f.keywords.split(/[\n,]/).map((s) => s.trim()).filter(Boolean), ads: f.ads,
        test: { on: f.test.on, days: Number(f.test.days) || 7, minImpressions: Number(f.test.min) || 300, afterBudget: f.test.after ? Number(f.test.after) : null },
        ...(f.local.center || f.local.areas.length || f.local.region.length ? { local: f.local } : {}) } });
      r.issues.length ? toast.error(`저장했습니다 — 검사 ${r.issues.length}건을 고쳐야 시작할 수 있습니다`) : toast.ok('세팅안을 저장했습니다');
      onDone(); onClose();
    } catch (er: any) { toast.error(er.message); } finally { setBusy(false); }
  }
  const len = (s: string) => [...s].length;
  return (
    <Modal open onClose={onClose} title={edit ? '세팅안 고치기' : '네이버 파워링크 세팅안'}>
      <form onSubmit={save} className="grid gap-3 text-sm" data-testid="ad-plan-form">
        <Field label="광고 계정"><select className={inputCls} value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value, channelId: '' })}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></Field>
        {brands.length > 0 && <Field label="브랜드(예산 집행 단위)"><select className={inputCls} value={f.brandId} onChange={(e) => setF({ ...f, brandId: e.target.value })} aria-label="세팅안 브랜드" data-testid="plan-brand"><option value="">브랜드 없음</option>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>}
        <Field label="캠페인 이름"><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={60} data-testid="ad-plan-name" /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="하루 예산(원)"><input className={inputCls} inputMode="numeric" value={f.dailyBudget} onChange={(e) => setF({ ...f, dailyBudget: e.target.value.replace(/\D/g, '') })} required data-testid="ad-plan-budget-input" /></Field>
          <Field label="기본 입찰가(원, 70~)"><input className={inputCls} inputMode="numeric" value={f.bidAmt} onChange={(e) => setF({ ...f, bidAmt: e.target.value.replace(/\D/g, '') })} required data-testid="ad-plan-bid" /></Field>
        </div>
        <Field label="광고할 웹사이트(네이버에 등록된 비즈채널)">
          {ch.data?.channels.length ? <select className={inputCls} value={f.channelId} onChange={(e) => setF({ ...f, channelId: e.target.value })} required data-testid="ad-plan-channel"><option value="">고르기</option>{ch.data.channels.map((c) => <option key={c.id} value={c.id}>{c.name}{c.url ? ` (${c.url})` : ''}{c.type && !/SITE/i.test(c.type) ? ` · ${c.type}` : ''}</option>)}</select>
            : <><input className={inputCls} value={f.channelId} onChange={(e) => setF({ ...f, channelId: e.target.value })} required data-testid="ad-plan-channel"
                placeholder={!ch.data && !ch.error ? '불러오는 중…' : '비즈채널 id(bsn-…) 직접 입력'} />
              {(ch.error || ch.data) && <span className="mt-1 block text-[11px] text-amber-800" data-testid="ad-plan-channel-hint">{ch.error ? `목록을 못 읽었습니다: ${ch.error.message}` : '이 계정에서 웹사이트 비즈채널을 찾지 못했습니다'} — 네이버 광고 시스템 › 도구 › 비즈채널 관리에서 id 를 복사해 넣어 주세요.</span>}</>}
        </Field>
        <Field label="키워드(쉼표·줄바꿈으로 구분, 50개까지)"><textarea className={inputCls} rows={3} value={f.keywords} onChange={(e) => setF({ ...f, keywords: e.target.value })} required data-testid="ad-plan-keywords" /></Field>
        {/* 광고 최적화 1차 ② 동네 타깃 */}
        <details className="rounded-input border border-line p-2" data-testid="ad-plan-local-section" open={!!(f.local.center || f.local.areas.length || f.local.region.length)}>
          <summary className="cursor-pointer text-xs font-medium">동네 타깃(선택) — 반경 안 동네 키워드 · 광고 지역</summary>
          <div className="mt-2 grid gap-3">
            <LocalFinder accountId={f.accountId} value={f.local} have={splitKw(f.keywords)} onChange={(v) => setF((x) => ({ ...x, local: { ...x.local, ...v } }))} pickLabel="키워드에 넣기"
              onPick={(keywords) => { if (mergeKw(f.keywords, keywords).length > 50) toast.error('키워드는 50개까지입니다 — 넘는 것은 빼 주세요'); setF((x) => ({ ...x, keywords: mergeKw(x.keywords, keywords).join(', ') })); }} />
            <RegionPicker region={f.local.region} abroad={f.local.abroad} onChange={(region, abroad) => setF((x) => ({ ...x, local: { ...x.local, region, abroad } }))} />
          </div>
        </details>
        {f.ads.map((a, k) => (
          <fieldset key={k} className="grid gap-2 rounded-input border border-line p-2"><legend className="px-1 text-xs text-ink-2">소재 {k + 1}</legend>
            <input className={inputCls} value={a.headline} onChange={(e) => setAd(k, { headline: e.target.value })} placeholder={`제목(15자) ${len(a.headline)}/15`} aria-label={`소재 ${k + 1} 제목`} required data-testid="ad-plan-headline" />
            <input className={inputCls} value={a.description} onChange={(e) => setAd(k, { description: e.target.value })} placeholder={`설명(45자) ${len(a.description)}/45`} aria-label={`소재 ${k + 1} 설명`} required data-testid="ad-plan-desc" />
            <input className={inputCls} value={a.url} onChange={(e) => setAd(k, { url: e.target.value })} aria-label={`소재 ${k + 1} 연결 주소`} required data-testid="ad-plan-url" />
            <span className={cx('text-[11px]', len(a.headline) > 15 || len(a.description) > 45 || badChars(a.headline + a.description) ? 'text-red-700' : 'text-ink-3')} data-testid="ad-plan-len">제목 {len(a.headline)}/15 · 설명 {len(a.description)}/45{badChars(a.headline + a.description) ? ` · 쓸 수 없는 문자 ${badChars(a.headline + a.description)}` : ''}</span>
          </fieldset>))}
        {f.ads.length < 3 && <Button type="button" size="sm" variant="secondary" className="justify-self-start" onClick={() => setF({ ...f, ads: [...f.ads, { headline: '', description: '', url: f.ads[0].url }] })}>소재 추가(3개까지)</Button>}
        {/* 광고 최적화 1차 ① 3안 소액 테스트 */}
        <label className="flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5" checked={f.test.on} onChange={(e) => setF({ ...f, test: { ...f.test, on: e.target.checked } })} data-testid="ad-plan-ab" />
          <span><b>3안 소액 테스트</b> — 소재 2~3개를 같은 예산으로 비교하고, 이긴 안이 나오면 [이긴 안에 집중]으로 진 안을 끄고 예산을 모읍니다.</span></label>
        {f.test.on && <div className="grid grid-cols-3 gap-2">
          <Field label="비교 기간(일)"><input className={inputCls} inputMode="numeric" value={f.test.days} onChange={(e) => setF({ ...f, test: { ...f.test, days: e.target.value.replace(/\D/g, '') } })} data-testid="ad-plan-ab-days" /></Field>
          <Field label="안마다 최소 노출"><input className={inputCls} inputMode="numeric" value={f.test.min} onChange={(e) => setF({ ...f, test: { ...f.test, min: e.target.value.replace(/\D/g, '') } })} data-testid="ad-plan-ab-min" /></Field>
          <Field label="이긴 뒤 하루 예산(원)"><input className={inputCls} inputMode="numeric" value={f.test.after} placeholder="비우면 그대로" onChange={(e) => setF({ ...f, test: { ...f.test, after: e.target.value.replace(/\D/g, '') } })} data-testid="ad-plan-ab-after" /></Field>
        </div>}
        {f.test.on && <p className="text-[11px] text-ink-3">테스트 동안 하루 예산은 작게(예: 5,000원) 두세요. 판정은 서버가 숫자로 합니다 — 클릭률(전환이 10건을 넘으면 전환율), 1등이 다른 안보다 한쪽 95% 신뢰로 높을 때만 “이긴 안”. 예산을 올리는 것은 [이긴 안에 집중]을 누를 때(월 상한 검사).</p>}
        <p className="text-[11px] text-ink-3">저장해도 네이버에는 아직 만들지 않습니다. 목록에서 검사 결과를 확인하고 [승인하고 시작]을 누르면 꺼진 상태로 만들어집니다.</p>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>취소</Button><Button type="submit" disabled={busy} data-testid="ad-plan-save">세팅안 저장</Button></div>
      </form>
    </Modal>
  );
}

/** 광고 최적화 1차 ① 3안 소액 테스트 — 소재별 노출·클릭·클릭률·전환·비용과 서버 판정, 소재 켜기·끄기, [이긴 안에 집중] */
function AbBox({ p, ab, canEdit, busy, run }: { p: Plan; ab: Ab; canEdit: boolean; busy: boolean; run: (key: string, fn: () => Promise<unknown>, ok: string) => void }) {
  const [label, cls] = AB_STATUS[ab.status] ?? [ab.status, 'bg-slate-100'];
  const pending = ab.losers.filter((id) => !ab.ads.find((a) => a.adId === id)?.paused);
  const after = ab.afterBudget && ab.afterBudget !== p.plan.dailyBudget ? ab.afterBudget : null;
  const act = (body: Record<string, unknown>, ok: string) => run(p.id, async () => {
    const r = await api<{ budgetError?: string }>(`/api/marketing/ad-ops/plans/${p.id}/action`, { body });
    if (r.budgetError) toast.error(`하루 예산은 바꾸지 못했습니다: ${r.budgetError}`);
  }, ok);
  return (
    <div className="mt-2 rounded-input border border-violet-200 bg-violet-50/40 p-2" data-testid="ad-ab" data-status={ab.status}>
      <div className="flex flex-wrap items-center gap-2 text-xs"><b>{ab.on ? '3안 소액 테스트' : '소재 비교'}</b>
        <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-medium', cls)} data-testid="ad-ab-status">{label}</span>
        <span className="text-ink-3">기준 {ab.metric === 'ctr' ? '클릭률' : '전환율'} · {ab.days}일 · 안마다 노출 {n0(ab.minImpressions)}회 이상</span></div>
      <div className="mt-1 overflow-x-auto"><table className="w-full min-w-[600px] text-right text-xs">
        <thead><tr className="text-ink-2"><th className="py-1 text-left font-medium">안</th><th className="text-left font-medium">제목</th><th className="font-medium">노출</th><th className="font-medium">클릭</th><th className="font-medium">클릭률</th><th className="font-medium">전환</th><th className="font-medium">비용</th><th className="pl-2 text-left font-medium">상태</th><th /></tr></thead>
        <tbody className="divide-y divide-line tabular-nums">{ab.ads.map((a) => (
          <tr key={a.adId} data-testid="ad-ab-row" data-ad={a.label}>
            <td className="py-1 text-left font-medium">{a.label}</td><td className="max-w-[12rem] truncate text-left">{a.headline}</td>
            <td>{n0(a.impressions)}</td><td>{n0(a.clicks)}</td><td>{a.ctr === null ? '—' : `${a.ctr}%`}</td><td>{n0(a.conversions)}</td><td>{won(a.cost)}</td>
            <td className="whitespace-nowrap pl-2 text-left">{ab.leader === a.adId && ab.status !== 'tie' && <span className="mr-1 rounded bg-emerald-600 px-1 text-[10px] font-semibold text-white" data-testid="ad-ab-win">이김</span>}
              {ab.losers.includes(a.adId) && <span className="mr-1 rounded bg-slate-500 px-1 text-[10px] font-semibold text-white" data-testid="ad-ab-lose">짐</span>}{a.paused ? '꺼짐' : '켜짐'}</td>
            <td>{canEdit && <button type="button" className="px-1 text-[11px] underline disabled:opacity-50" disabled={busy} data-testid="ad-ab-toggle"
              onClick={() => act({ action: a.paused ? 'ad_resume' : 'ad_pause', adIds: [a.adId] }, a.paused ? `${a.label}를 켰습니다` : `${a.label}를 껐습니다`)}>{a.paused ? '켜기' : '끄기'}</button>}</td>
          </tr>))}</tbody></table></div>
      <p className="mt-1 text-xs" data-testid="ad-ab-message">{ab.message}</p>
      {canEdit && pending.length > 0 && <Button size="sm" className="mt-1 h-auto min-h-8 whitespace-normal py-1 text-left" disabled={busy} data-testid="ad-ab-apply"
        onClick={() => confirm(`진 안 ${pending.length}개를 끄고${after ? ` 하루 예산을 ${won(p.plan.dailyBudget)} → ${won(after)}(으)로 바꿀까요? 예산을 올리면 광고비가 더 나갑니다.` : ' 남은 안에 예산을 모을까요?'}`)
          && act({ action: 'ab_apply', adIds: pending, ...(after ? { dailyBudget: after } : {}) }, '진 안을 끄고 이긴 안에 모았습니다')}>
        이긴 안에 집중 — 진 안 {pending.length}개 끄기{after ? ` + 하루 예산 ${won(p.plan.dailyBudget)} → ${won(after)}` : ''}</Button>}
    </div>
  );
}

const splitKw = (t: string) => t.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
const kwKey = (k: string) => k.replace(/\s+/g, '').toLowerCase();
/** 키워드 칸에 고른 동네 키워드 덧붙이기(띄어쓰기 무시 중복 제거) */
function mergeKw(text: string, add: string[]) { const cur = splitKw(text); const seen = new Set(cur.map(kwKey)); return [...cur, ...add.filter((k) => !seen.has(kwKey(k)) && !!seen.add(kwKey(k)))]; }

type KwRow = { keyword: string; area: string; service: string; pc: number | null; mobile: number | null; total: number; low: boolean };
/**
 * 광고 최적화 1차 ② 동네 키워드 찾기: 중심·반경 → [AI로 동네 추천](추정) → 동네 × 서비스 단어 → [검색량 확인](네이버 키워드 도구 월 검색량) → 고르기.
 * 네이버 파워링크는 반경을 직접 지정할 수 없어 '반경 안 동네 이름 키워드'로 맞춘다.
 */
function LocalFinder({ accountId, value, have, onChange, onPick, pickLabel }: { accountId: string; value: Local; have: string[]; onChange?: (v: Partial<Local>) => void; onPick: (keywords: string[], v: Local) => void; pickLabel: string }) {
  const [v, setV] = useState<Local>(value);
  const set = (patch: Partial<Local>) => { setV((x) => ({ ...x, ...patch })); onChange?.(patch); };
  const [services, setServices] = useState('');
  const [areaIn, setAreaIn] = useState('');
  const [note, setNote] = useState('');
  const [rows, setRows] = useState<KwRow[] | null>(null);
  const [related, setRelated] = useState<{ keyword: string; total: number }[]>([]);
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<'' | 'ai' | 'kw'>('');
  const haveSet = new Set(have.map(kwKey));
  const addArea = (name: string) => { const n = name.replace(/\s+/g, ''); if (n.length >= 2 && !v.areas.includes(n) && v.areas.length < 20) set({ areas: [...v.areas, n] }); };
  async function suggest() {
    setBusy('ai');
    try {
      const r = await api<{ areas: { name: string; kind: string; km: number }[]; note: string }>('/api/marketing/ad-ops/local/areas', { body: { center: v.center, radiusKm: v.radiusKm, services: splitKw(services) } });
      const names = r.areas.map((a) => a.name).filter((n) => !v.areas.includes(n));
      set({ areas: [...v.areas, ...names].slice(0, 20) }); setNote(r.areas.length ? `${r.note} (${r.areas.map((a) => `${a.name} ${a.km}km`).join(', ')})` : r.note);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(''); }
  }
  async function check() {
    setBusy('kw');
    try {
      const r = await api<{ rows: KwRow[]; related: { keyword: string; total: number }[] }>('/api/marketing/ad-ops/local/keywords', { body: { accountId, areas: v.areas, services: splitKw(services) } });
      setRows(r.rows); setRelated(r.related); setPick(new Set(r.rows.filter((x) => !x.low && !haveSet.has(kwKey(x.keyword))).map((x) => x.keyword)));
    } catch (e: any) { toast.error(e.message); } finally { setBusy(''); }
  }
  const toggle = (k: string) => setPick((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const vol = (x: KwRow) => (x.pc === null ? '자료 없음' : `${n0(x.total)} (PC ${n0(x.pc)} · 모바일 ${n0(x.mobile ?? 0)})`);
  return (
    <div className="grid gap-2 text-xs" data-testid="local-finder">
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <Field label="중심 위치(지점 주소·동네)"><input className={inputCls} value={v.center} onChange={(e) => set({ center: e.target.value })} placeholder="예: 천안 두정동 ○○점" maxLength={80} data-testid="local-center" /></Field>
        <Field label="반경"><select className={inputCls} value={v.radiusKm} onChange={(e) => set({ radiusKm: Number(e.target.value) })} data-testid="local-radius">{[1, 2, 3, 5, 10].map((k) => <option key={k} value={k}>{k}km</option>)}</select></Field>
      </div>
      <Field label="서비스 단어(쉼표로, 5개까지)"><input className={inputCls} value={services} onChange={(e) => setServices(e.target.value)} placeholder="예: 헬스장, PT" data-testid="local-services" /></Field>
      <div className="flex flex-wrap items-center gap-1.5" data-testid="local-areas">
        {v.areas.map((a) => <span key={a} className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-violet-900" data-testid="local-area">{a}
          <button type="button" aria-label={`${a} 빼기`} onClick={() => set({ areas: v.areas.filter((x) => x !== a) })}>×</button></span>)}
        <input className={cx(inputCls, 'h-7 w-28 text-xs')} value={areaIn} onChange={(e) => setAreaIn(e.target.value)} placeholder="동네 이름 + Enter" aria-label="동네 이름 추가" data-testid="local-area-input"
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addArea(areaIn); setAreaIn(''); } }} />
        <Button type="button" size="sm" variant="secondary" disabled={!v.center.trim() || busy !== ''} onClick={suggest} data-testid="local-ai">{busy === 'ai' ? '추천 중…' : 'AI로 동네 추천'}</Button>
        <Button type="button" size="sm" variant="secondary" disabled={!accountId || !v.areas.length || !splitKw(services).length || busy !== ''} onClick={check} data-testid="local-check">{busy === 'kw' ? '확인 중…' : '검색량 확인'}</Button>
      </div>
      {note && <p className="text-[11px] text-ink-3" data-testid="local-note">{note}</p>}
      {rows && <div className="overflow-x-auto" data-testid="local-rows"><table className="w-full min-w-[420px] text-left">
        <thead><tr className="text-ink-2"><th className="w-6" /><th className="py-1 font-medium">키워드</th><th className="text-right font-medium">월 검색(네이버)</th></tr></thead>
        <tbody className="divide-y divide-line tabular-nums">{rows.map((x) => { const dup = haveSet.has(kwKey(x.keyword)); return (
          <tr key={x.keyword} className={cx(x.low && 'text-ink-3')} data-testid="local-row" data-low={x.low ? '1' : '0'}>
            <td><input type="checkbox" checked={pick.has(x.keyword)} disabled={dup} onChange={() => toggle(x.keyword)} aria-label={`${x.keyword} 고르기`} /></td>
            <td className="py-1">{x.keyword}{dup && <span className="ml-1 text-ink-3">(이미 있음)</span>}{x.low && <span className="ml-1 rounded bg-slate-100 px-1 text-[10px]">검색 거의 없음</span>}</td>
            <td className="text-right">{vol(x)}</td></tr>); })}</tbody></table></div>}
      {related.length > 0 && <p className="flex flex-wrap gap-1" data-testid="local-related"><span className="text-ink-2">검색이 있는 연관 동네 키워드:</span>{related.map((r) =>
        <button key={r.keyword} type="button" className={cx('rounded-full border px-2', pick.has(r.keyword) ? 'border-violet-400 bg-violet-50' : 'border-line')} onClick={() => toggle(r.keyword)}>{r.keyword} {n0(r.total)}</button>)}</p>}
      {rows && <Button type="button" size="sm" className="justify-self-start" disabled={!pick.size} onClick={() => onPick([...pick], v)} data-testid="local-pick">{pick.size}개 {pickLabel}</Button>}
      <p className="text-[11px] text-ink-3">네이버 파워링크는 반경을 직접 지정할 수 없어 반경 안 동네 이름 키워드로 맞춥니다. 동네 이름은 AI 추정이라 실제 월 검색량(네이버 키워드 도구)으로 거릅니다. 반경은 세팅안에 남겨 두고, 구글·메타 광고를 연결하면 그대로 씁니다.</p>
    </div>
  );
}

/** 광고 지역(시·도) — 네이버 지역 타겟팅. 아무것도 안 고르면 전국(네이버 기본) */
function RegionPicker({ region, abroad, onChange }: { region: string[]; abroad: boolean; onChange: (region: string[], abroad: boolean) => void }) {
  return (
    <div className="text-xs" data-testid="region-picker"><p className="mb-1 font-medium">광고 지역(시·도) <span className="font-normal text-ink-3">— 지금: {regionLabel(region)}{abroad ? '·해외' : ''}</span></p>
      <div className="flex flex-wrap gap-1">{NAVER_REGIONS.map(([c, name]) => { const on = region.includes(c); return (
        <button key={c} type="button" aria-pressed={on} className={cx('rounded-full border px-2 py-0.5', on ? 'border-violet-500 bg-violet-600 text-white' : 'border-line bg-white')} data-testid="region-chip" data-code={c}
          onClick={() => { const next = on ? region.filter((x) => x !== c) : [...region, c]; onChange(next, next.length ? abroad : false); }}>{name}</button>); })}</div>
      {region.length > 0 && <label className="mt-1 flex items-center gap-1"><input type="checkbox" checked={abroad} onChange={(e) => onChange(region, e.target.checked)} data-testid="region-abroad" />해외에서도 보이기</label>}
      <p className="mt-0.5 text-[11px] text-ink-3">시·도를 고르면 국내 그 지역에서만 보입니다. 아무것도 안 고르면 네이버 기본(전국·해외). 시·군·구·동 단위는 네이버 API 공개 문서에 없어 동네 키워드로 맞춥니다.</p>
    </div>
  );
}
function RegionModal({ p, onClose, onSave }: { p: Plan; onClose: () => void; onSave: (region: string[], abroad: boolean) => void }) {
  const [r, setR] = useState<{ region: string[]; abroad: boolean }>({ region: p.plan.local?.region ?? [], abroad: !!p.plan.local?.abroad });
  return (
    <Modal open onClose={onClose} title="광고 지역">
      <div className="grid gap-3">
        <RegionPicker region={r.region} abroad={r.abroad} onChange={(region, abroad) => setR({ region, abroad })} />
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>취소</Button>
          <Button type="button" data-testid="region-save" onClick={() => confirm(`'${p.name}' 광고 지역을 ${regionLabel(r.region)}${r.abroad ? '·해외' : ''}(으)로 바꿀까요? (하루 예산은 그대로)`) && onSave(r.region, r.abroad)}>바꾸기</Button></div>
      </div>
    </Modal>
  );
}
