'use client';
import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { api, useApi } from '@/components/client';
import { Button, ErrorBox, Field, Modal, Skeleton, cx, fmtDateTime, inputCls, toast } from '@/components/ui';
import { NAVER_REGIONS, regionLabel } from '@/lib/naverRegions';
import { PLAN_KEYWORDS_MAX, combineKeywords } from '@/lib/kwCombine';
import { MetaAuto } from './MetaAuto';

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
/** #499-2 광고 설정(서버 adOps setupInput 과 같은 칸) */
type Setup = { tracking: boolean; media: 'all' | 'naver'; pcWeight: number; mobileWeight: number; rolling: 'PERFORMANCE' | 'ROUND_ROBIN'; expSearch: boolean; expRatio: number; aiMax: boolean; negatives: string[] };
/** 새 세팅안 추천값(테크트리 EP.7, 대표 결정 전): 자동 추적 켬 · 네이버 매체만 · PC 60/모바일 120 · 확장 검색 100%(ADVoost Max 는 네이버 기본 켬) · 성과 기반 */
const SETUP_NEW: Setup = { tracking: true, media: 'naver', pcWeight: 60, mobileWeight: 120, rolling: 'PERFORMANCE', expSearch: true, expRatio: 100, aiMax: true, negatives: [] };
const WEIGHT_PRESETS: [string, number, number][] = [['모바일 중심 60·120(영상 권고)', 60, 120], ['같게 100·100(네이버 기본)', 100, 100], ['PC 중심 120·60', 120, 60]];
const NEG_STARTERS = ['구인', '채용', '알바', '아르바이트', '모집', '중고']; // 제외 키워드 시작 예(업종에 맞게 고침)
const setupText = (s: Setup | undefined, abTest: boolean) => !s ? '네이버 기본값(광고 설정 칸이 생기기 전 세팅안)' : [
  s.tracking ? '자동 추적 켬' : '자동 추적 끔', s.media === 'naver' ? '네이버 매체만' : '전체 매체', `PC ${s.pcWeight}%·모바일 ${s.mobileWeight}%`,
  s.expSearch ? `확장 검색 켬(예산 ${s.expRatio}%${s.aiMax ? '' : ' · ADVoost Max 끔'}${s.negatives.length ? ` · 제외 키워드 ${s.negatives.length}개` : ''})` : '확장 검색 끔',
  abTest ? '소재 동일 비중(3안 테스트)' : s.rolling === 'PERFORMANCE' ? '소재 성과 기반' : '소재 동일 비중'].join(' · ');
type Plan = { id: string; account_id: string; brand_id?: string | null; brand?: string | null; kind: string; name: string; plan: { dailyBudget: number; bidAmt: number; channelId: string; keywords: string[]; ads: { headline: string; description: string; url: string }[]; test?: Test; local?: Local; setup?: Setup };
  status: string; external: Record<string, unknown>; error: string | null; created_at: string; approved_at: string | null; account_label: string; approved_by_name: string | null; issues: string[]; advice?: string[]; ab?: Ab | null };
type Change = { id: string; plan_id: string | null; kind: string; before: any; after: any; money_up: boolean; status: string; error: string | null; revert_of: string | null; created_at: string; actor_name: string | null };
type Data = { canEdit: boolean; cap: { monthlyCap: number; stoppedMonth: string | null } | null; monthSpend: number; month: string; accounts: { id: string; label: string; external_id: string }[]; brands: { id: string; name: string }[]; plans: Plan[]; changes: Change[];
  savings?: { pct: number; spend: number; amount: number; custom: boolean }; budgetHint?: { naver: number; brands: Record<string, number> } | null };
const STATUS: Record<string, [string, string]> = { draft: ['세팅안', 'bg-slate-100 text-ink-2'], creating: ['만드는 중', 'bg-sky-50 text-sky-800'], created: ['만듦 · 꺼짐', 'bg-sky-50 text-sky-800'], active: ['켜짐', 'bg-emerald-50 text-emerald-800'],
  paused: ['꺼짐', 'bg-amber-50 text-amber-800'], failed: ['만들기 실패', 'bg-red-50 text-red-800'] };
const kwOk = (x: unknown) => Array.isArray(x) && x.length > 0 && x.every((v) => typeof v === 'string' && v && v !== 'undefined');
/** 카드 키워드 줄: 끈 키워드는 '(꺼짐)', 조합기로 수백 개면 앞 20개 + 외 n개 */
const kwLabel = (p: Plan) => {
  const locks = p.external?.kwLocks as Record<string, boolean> | undefined; const ids = p.external?.keywordIds as string[] | undefined;
  const all = p.plan.keywords.map((k, j) => (locks?.[ids?.[j] ?? ''] ? `${k}(꺼짐)` : k));
  return all.length > 20 ? `${all.slice(0, 20).join(', ')} 외 ${all.length - 20}개` : all.join(', ');
};
const negFailed = (p: Plan) => (Array.isArray(p.external?.negFailed) ? (p.external.negFailed as string[]) : []);
const KIND: Record<string, string> = { create: '꺼진 상태로 생성', enable: '켜기', pause: '끄기', budget: '하루 예산 변경', auto_pause: '상한 도달 자동 중지', sync: '키워드 다시 읽기', ad_pause: '소재 끄기', ad_resume: '소재 켜기',
  region: '광고 지역 변경', keywords_add: '키워드 추가', keywords_remove: '키워드 빼기', kw_pause: '키워드 끄기', kw_resume: '키워드 켜기' };
const REVERTIBLE = ['enable', 'pause', 'budget', 'auto_pause', 'ad_pause', 'ad_resume', 'region', 'keywords_add', 'kw_pause', 'kw_resume'];
const kwList = (k: string[] = []) => (k.length > 3 ? `${k.slice(0, 3).join(', ')} 외 ${k.length - 3}개` : k.join(', '));
const adName = (plans: Plan[], c: Change, id: string) => { const p = plans.find((x) => x.id === c.plan_id); const k = ((p?.external?.adIds as string[] | undefined) ?? []).indexOf(id); return k >= 0 ? `안 ${'ABC'[k] ?? k + 1}` : id; };
const desc = (c: Change, plans: Plan[] = []) => c.kind === 'budget' ? `${won(c.before?.dailyBudget)} → ${won(c.after?.dailyBudget)}` : c.kind === 'auto_pause' && c.after?.spend ? `이번 달 ${won(c.after.spend)} / 상한 ${won(c.after.cap)}`
  : (c.kind === 'ad_pause' || c.kind === 'ad_resume') ? `${((c.after?.adIds ?? []) as string[]).map((x) => adName(plans, c, x)).join(', ')}${c.after?.ab ? ' (3안 테스트 결과)' : ''}`
  : c.kind === 'region' && c.after?.KR ? `${c.before ? `${regionLabel(c.before.KR)} → ` : ''}${regionLabel(c.after.KR)}${c.after.OTHERS?.includes('00') || c.after.abroad ? ' · 해외 포함' : ''}`
  : c.kind === 'keywords_add' || c.kind === 'kw_pause' || c.kind === 'kw_resume' ? kwList(c.after?.keywords) : c.kind === 'keywords_remove' ? kwList(c.before?.keywords) : '';
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
              <p className="mt-0.5 text-xs text-ink-2" data-testid="ad-plan-kw-line">키워드: {kwLabel(p)}</p>
              {p.plan.ads.map((a, k) => <p key={k} className="mt-0.5 text-xs"><b className="text-emerald-800">{a.headline}</b> {a.description} <span className="text-ink-3">{a.url}</span></p>)}
              <p className="mt-0.5 text-xs text-ink-2" data-testid="ad-plan-setup">광고 설정: {setupText(p.plan.setup, !!p.plan.test?.on)}</p>
              {p.issues.length > 0 && <ul className="mt-1 space-y-0.5 text-xs text-amber-800" data-testid="ad-plan-issues">{p.issues.map((x, k) => <li key={k}>검사: {x}</li>)}</ul>}
              {/* #499-2 권고는 시작을 막지 않음(연결 주소·광고형 문구·질문형 제목·제외 키워드) */}
              {!!p.advice?.length && ['draft', 'failed'].includes(p.status) && <ul className="mt-1 space-y-0.5 text-xs text-sky-900" data-testid="ad-plan-advice">{p.advice.map((x, k) => <li key={k}>권고: {x}</li>)}</ul>}
              {negFailed(p).length > 0 && <p className="mt-1 break-words text-xs text-amber-800" data-testid="ad-plan-neg-failed">제외 키워드 {negFailed(p).length}개는 네이버가 받지 않았습니다 — {negFailed(p).join(' / ')} · 네이버 광고 시스템에서 직접 넣어 주세요</p>}
              {['created', 'active', 'paused'].includes(p.status) && <p className="mt-0.5 text-xs text-ink-3" data-testid="ad-plan-manual">직접 할 일(권장): 파워링크 이미지(썸네일 확장 소재)는 네이버 API로 만들 수 없어, 네이버 광고 시스템에서 이 광고그룹에 등록합니다.</p>}
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

      <MetaAuto />

      <LeadsBox run={run} />

      <LeadAdsBox run={run} />

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
      {form && <PlanForm accounts={data.accounts} brands={data.brands ?? []} budgetHint={data.budgetHint ?? null} edit={form === true ? undefined : form} onClose={() => setForm(false)} onDone={reload} />}
      {local?.mode === 'keywords' && <Modal open onClose={() => setLocal(null)} title="동네 키워드 추가">
        <LocalFinder accountId={local.p.account_id} value={{ ...NO_LOCAL, ...(local.p.plan.local ?? {}) }} have={local.p.plan.keywords} pickLabel="광고에 키워드 추가"
          onPick={(keywords, v) => { const lp = local.p; setLocal(null); run(lp.id, () => api(`/api/marketing/ad-ops/plans/${lp.id}/action`, { body: { action: 'keywords_add', keywords, local: { center: v.center, radiusKm: v.radiusKm, areas: v.areas } } }), `키워드 ${keywords.length}개를 광고에 넣었습니다(그룹 입찰가)`); }} />
      </Modal>}
      {local?.mode === 'region' && <RegionModal p={local.p} onClose={() => setLocal(null)} onSave={(region, abroad) => { const lp = local.p; setLocal(null);
        run(lp.id, () => api(`/api/marketing/ad-ops/plans/${lp.id}/action`, { body: { action: 'region', region, abroad } }), `광고 지역을 ${regionLabel(region)}${abroad ? '·해외' : ''}(으)로 바꿨습니다`); }} />}
    </div>
  );
}

function PlanForm({ accounts, brands, budgetHint, edit, onClose, onDone }: { accounts: Data['accounts']; brands: Data['brands']; budgetHint: Data['budgetHint']; edit?: Plan; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState(edit
    ? { accountId: edit.account_id, brandId: edit.brand_id ?? '', name: edit.name, dailyBudget: String(edit.plan.dailyBudget), bidAmt: String(edit.plan.bidAmt), channelId: edit.plan.channelId, keywords: edit.plan.keywords.join(', '), ads: edit.plan.ads.map((a) => ({ ...a })),
        test: { on: !!edit.plan.test?.on, days: String(edit.plan.test?.days ?? 7), min: String(edit.plan.test?.minImpressions ?? 300), after: edit.plan.test?.afterBudget ? String(edit.plan.test.afterBudget) : '' }, local: { ...NO_LOCAL, ...(edit.plan.local ?? {}) },
        setup: { ...SETUP_NEW, ...(edit.plan.setup ?? {}) }, negText: (edit.plan.setup?.negatives ?? []).join(', ') }
    : { accountId: accounts[0]?.id ?? '', brandId: '', name: '', dailyBudget: '10000', bidAmt: '300', channelId: '', keywords: '', ads: [{ headline: '', description: '', url: 'https://' }], test: { on: false, days: '7', min: '300', after: '' }, local: NO_LOCAL,
        setup: SETUP_NEW, negText: '' });
  const ch = useApi<{ channels: { id: string; name: string; url: string | null; type: string }[] }>(f.accountId ? `/api/marketing/ad-ops/channels?accountId=${f.accountId}` : null, [f.accountId]);
  const [busy, setBusy] = useState(false);
  const setAd = (k: number, patch: Partial<(typeof f.ads)[number]>) => setF({ ...f, ads: f.ads.map((a, i) => (i === k ? { ...a, ...patch } : a)) });
  const setS = (patch: Partial<Setup>) => setF((x) => ({ ...x, setup: { ...x.setup, ...patch } }));
  /** 키워드 칸에 덧붙이기(띄어쓰기 무시 중복 제거) — 세팅안 한도를 넘는 것은 넣지 않고 알림 */
  const addKw = (add: string[]) => {
    const n = mergeKw(f.keywords, add).length;
    if (n > PLAN_KEYWORDS_MAX) toast.error(`키워드는 ${PLAN_KEYWORDS_MAX}개까지입니다 — 넘는 ${n - PLAN_KEYWORDS_MAX}개는 넣지 않았습니다`);
    setF((x) => ({ ...x, keywords: mergeKw(x.keywords, add).slice(0, PLAN_KEYWORDS_MAX).join(', ') }));
  };
  const kwCount = splitKw(f.keywords).length;
  const negs = splitKw(f.negText);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const bad = kwCount > PLAN_KEYWORDS_MAX ? `키워드는 ${PLAN_KEYWORDS_MAX}개까지입니다(지금 ${kwCount}개)` : [f.setup.pcWeight, f.setup.mobileWeight].some((w) => w < 10 || w > 500) ? 'PC·모바일 입찰 가중치는 10~500% 입니다'
      : f.setup.expRatio < 1 || f.setup.expRatio > 100 ? '확장 검색 예산 비율은 1~100% 입니다' : negs.length > 100 ? '제외 키워드는 100개까지입니다' : '';
    if (bad) { toast.error(bad); return; }
    setBusy(true);
    try {
      const r = await api<{ issues: string[] }>(edit ? `/api/marketing/ad-ops/plans/${edit.id}` : '/api/marketing/ad-ops/plans', { method: edit ? 'PUT' : 'POST', body: { accountId: f.accountId, brandId: f.brandId || null, name: f.name, dailyBudget: Number(f.dailyBudget), bidAmt: Number(f.bidAmt), channelId: f.channelId,
        keywords: splitKw(f.keywords), ads: f.ads,
        test: { on: f.test.on, days: Number(f.test.days) || 7, minImpressions: Number(f.test.min) || 300, afterBudget: f.test.after ? Number(f.test.after) : null },
        ...(f.local.center || f.local.areas.length || f.local.region.length ? { local: f.local } : {}), setup: { ...f.setup, negatives: negs } } });
      r.issues.length ? toast.error(`저장했습니다 — 검사 ${r.issues.length}건을 고쳐야 시작할 수 있습니다`) : toast.ok('세팅안을 저장했습니다');
      onDone(); onClose();
    } catch (er: any) { toast.error(er.message); } finally { setBusy(false); }
  }
  const len = (s: string) => [...s].length;
  // #499-2 하루 예산 권장 = 월 예산 ÷ 30 × 1.5(테크트리 3장 C — 넘치는 날을 받아 주고 마지막 방어선은 월 상한). 월 = 이번 달 승인된 광고 예산의 네이버 몫(브랜드를 고르면 그 브랜드 몫)
  const brandMonthly = f.brandId ? budgetHint?.brands?.[f.brandId] : undefined;
  const monthly = brandMonthly ?? budgetHint?.naver ?? 0;
  const daily = monthly ? Math.max(100, Math.round(((monthly / 30) * 1.5) / 100) * 100) : 0;
  const bid = Number(f.bidAmt) || 0;
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
        <p className="-mt-2 text-[11px] text-ink-3" data-testid="ad-plan-budget-hint">{daily
          ? <>권장 하루 예산 {won(daily)} — 이번 달 승인된 네이버 예산{brandMonthly !== undefined ? '(이 브랜드 몫)' : ''} {won(monthly)} ÷ 30 × 1.5. 마지막 방어선은 월 상한입니다. <button type="button" className="underline" onClick={() => setF({ ...f, dailyBudget: String(daily) })} data-testid="ad-plan-budget-apply">넣기</button></>
          : '권장 하루 예산 = 월 예산 ÷ 30 × 1.5(넘치는 날을 받아 줌). 마지막 방어선은 월 상한입니다.'}</p>
        <Field label="광고할 웹사이트(네이버에 등록된 비즈채널)">
          {ch.data?.channels.length ? <select className={inputCls} value={f.channelId} onChange={(e) => setF({ ...f, channelId: e.target.value })} required data-testid="ad-plan-channel"><option value="">고르기</option>{ch.data.channels.map((c) => <option key={c.id} value={c.id}>{c.name}{c.url ? ` (${c.url})` : ''}{c.type && !/SITE/i.test(c.type) ? ` · ${c.type}` : ''}</option>)}</select>
            : <><input className={inputCls} value={f.channelId} onChange={(e) => setF({ ...f, channelId: e.target.value })} required data-testid="ad-plan-channel"
                placeholder={!ch.data && !ch.error ? '불러오는 중…' : '비즈채널 id(bsn-…) 직접 입력'} />
              {(ch.error || ch.data) && <span className="mt-1 block text-[11px] text-amber-800" data-testid="ad-plan-channel-hint">{ch.error ? `목록을 못 읽었습니다: ${ch.error.message}` : '이 계정에서 웹사이트 비즈채널을 찾지 못했습니다'} — 네이버 광고 시스템 › 도구 › 비즈채널 관리에서 id 를 복사해 넣어 주세요.</span>}</>}
        </Field>
        <Field label={`키워드(쉼표·줄바꿈으로 구분, ${PLAN_KEYWORDS_MAX}개까지) — 지금 ${kwCount}개`}><textarea className={cx(inputCls, kwCount > PLAN_KEYWORDS_MAX && 'border-red-400')} rows={3} value={f.keywords} onChange={(e) => setF({ ...f, keywords: e.target.value })} required data-testid="ad-plan-keywords" /></Field>
        {/* #499-2 키워드 N단 조합기 */}
        <details className="rounded-input border border-line p-2" data-testid="kw-combiner-section">
          <summary className="cursor-pointer text-xs font-medium">키워드 조합기(선택) — 단어 그룹 2~4개를 곱해 롱테일 키워드 만들기</summary>
          <div className="mt-2"><KwCombiner accountId={f.accountId} have={splitKw(f.keywords)} onPick={addKw} /></div>
        </details>
        {/* 광고 최적화 1차 ② 동네 타깃 */}
        <details className="rounded-input border border-line p-2" data-testid="ad-plan-local-section" open={!!(f.local.center || f.local.areas.length || f.local.region.length)}>
          <summary className="cursor-pointer text-xs font-medium">동네 타깃(선택) — 반경 안 동네 키워드 · 광고 지역</summary>
          <div className="mt-2 grid gap-3">
            <LocalFinder accountId={f.accountId} value={f.local} have={splitKw(f.keywords)} onChange={(v) => setF((x) => ({ ...x, local: { ...x.local, ...v } }))} pickLabel="키워드에 넣기" onPick={(keywords) => addKw(keywords)} />
            <RegionPicker region={f.local.region} abroad={f.local.abroad} onChange={(region, abroad) => setF((x) => ({ ...x, local: { ...x.local, region, abroad } }))} />
          </div>
        </details>
        {/* #499-2 광고 설정(테크트리 EP.7) — 네이버 공식 API 칸, 새 세팅안은 추천값 */}
        <details className="rounded-input border border-line p-2" data-testid="ad-setup" open>
          <summary className="cursor-pointer text-xs font-medium">광고 설정 — <span className="font-normal text-ink-2" data-testid="ad-setup-summary">{setupText({ ...f.setup, negatives: negs }, f.test.on)}</span></summary>
          <div className="mt-2 grid gap-2 text-xs">
            <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5" checked={f.setup.tracking} onChange={(e) => setS({ tracking: e.target.checked })} data-testid="setup-tracking" />
              <span><b>자동 추적 URL 파라미터</b>(추천) — 광고로 들어온 문의·전화에 검색 키워드가 함께 남아 키워드별 문의를 셉니다.</span></label>
            <Field label="노출 매체"><select className={inputCls} value={f.setup.media} onChange={(e) => setS({ media: e.target.value as Setup['media'] })} data-testid="setup-media">
              <option value="naver">네이버 매체만(추천 · 파트너 제외)</option><option value="all">전체 매체(네이버 기본 · 파트너 포함)</option></select>
              <span className="mt-1 block text-[11px] text-ink-3">네이버 매체만 = 검색·콘텐츠 모두 네이버 안에서만 보입니다(네이버와 제휴한 파트너 사이트 제외).</span></Field>
            <div><p className="mb-1 font-medium">PC·모바일 입찰 가중치</p>
              <div className="flex flex-wrap gap-1">{WEIGHT_PRESETS.map(([label, pc, mo]) => { const on = f.setup.pcWeight === pc && f.setup.mobileWeight === mo; return (
                <button key={label} type="button" aria-pressed={on} className={cx('rounded-full border px-2 py-0.5', on ? 'border-violet-500 bg-violet-600 text-white' : 'border-line bg-white')} onClick={() => setS({ pcWeight: pc, mobileWeight: mo })} data-testid="setup-weight-preset">{label}</button>); })}</div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1 whitespace-nowrap">PC <PctInput value={f.setup.pcWeight} onChange={(n) => setS({ pcWeight: n })} label="PC 입찰 가중치(%)" testId="setup-pc" />%</label>
                <label className="flex items-center gap-1 whitespace-nowrap">모바일 <PctInput value={f.setup.mobileWeight} onChange={(n) => setS({ mobileWeight: n })} label="모바일 입찰 가중치(%)" testId="setup-mobile" />%</label>
                <span className="text-ink-3" data-testid="setup-weight-bid">입찰 {won(bid)} → PC 약 {won((bid * f.setup.pcWeight) / 100)} · 모바일 약 {won((bid * f.setup.mobileWeight) / 100)} (10~500%)</span></div>
              <p className="mt-0.5 text-[11px] text-ink-3">60·120 은 영상(의류 쇼핑몰)의 값입니다 — 우리 업종 PC·모바일 문의 실적을 보고 조정하세요.</p></div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <label className="flex items-center gap-1"><input type="checkbox" checked={f.setup.expSearch} onChange={(e) => setS({ expSearch: e.target.checked })} data-testid="setup-exp" /><b>확장 검색</b>(네이버 기본 켬)</label>
              {f.setup.expSearch && <label className="flex items-center gap-1 whitespace-nowrap">예산 비율 <PctInput value={f.setup.expRatio} onChange={(n) => setS({ expRatio: n })} label="확장 검색 예산 비율(%)" testId="setup-exp-ratio" />%</label>}
              {f.setup.expSearch && <label className="flex items-center gap-1"><input type="checkbox" checked={f.setup.aiMax} onChange={(e) => setS({ aiMax: e.target.checked })} data-testid="setup-aimax" />ADVoost Max(네이버 기본 켬)</label>}
            </div>
            {f.setup.expSearch && <p className="text-[11px] text-ink-3">확장 검색은 등록 키워드와 비슷한 검색어에도 광고를 내고, 연결 페이지 내용으로 검색어를 맞춥니다. 예산 비율은 예산 중 확장 검색에 쓸 수 있는 몫(입찰 가중치가 아님)입니다. ADVoost Max 는 네이버가 확장 검색 그룹에 기본으로 켜는 AI 설정입니다.</p>}
            {f.setup.expSearch && <Field label={`확장 검색 제외 키워드(쉼표로, 100개까지) — ${negs.length}개`}><textarea className={inputCls} rows={2} value={f.negText} onChange={(e) => setF({ ...f, negText: e.target.value })} placeholder="예: 구인, 채용, 알바" data-testid="setup-negatives" />
              <span className="mt-1 flex flex-wrap gap-1">{NEG_STARTERS.filter((w) => !negs.includes(w)).map((w) => <button key={w} type="button" className="rounded-full border border-line px-2 py-0.5 text-[11px]" onClick={() => setF((x) => ({ ...x, negText: [...splitKw(x.negText), w].join(', ') }))} data-testid="setup-neg-chip">+ {w}</button>)}</span></Field>}
            <Field label="소재 노출 방식"><select className={inputCls} value={f.test.on ? 'ROUND_ROBIN' : f.setup.rolling} disabled={f.test.on} onChange={(e) => setS({ rolling: e.target.value as Setup['rolling'] })} data-testid="setup-rolling">
              <option value="PERFORMANCE">성과 기반(추천 — 성과 좋은 소재를 더 자주)</option><option value="ROUND_ROBIN">동일 비중(번갈아)</option></select>
              {f.test.on && <span className="mt-1 block text-[11px] text-ink-3">3안 소액 테스트 중에는 공정하게 비교하도록 동일 비중으로 만듭니다.</span>}</Field>
            <p className="text-[11px] text-ink-3">파워링크 이미지(썸네일 확장 소재)는 네이버 API로 만들 수 없어, 만든 뒤 네이버 광고 시스템에서 직접 등록합니다.</p>
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
        <p className="text-[11px] text-ink-3">문구 팁: 연결 주소는 서비스별 페이지로, 제목엔 소구점(+ 물음표 질문형 한 안), 설명엔 무엇을 주는지(무료 상담·진단 등) — 저장하면 광고형 점수와 권고를 보여 드립니다(시작은 막지 않음).</p>
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

/** 좁은 % 칸 — inputCls 의 w-full 을 감싸는 폭으로 제한 */
function PctInput({ value, onChange, label, testId }: { value: number; onChange: (n: number) => void; label: string; testId: string }) {
  return <span className="inline-block w-20"><input className={cx(inputCls, 'h-8 py-1')} inputMode="numeric" value={value || ''} onChange={(e) => onChange(Number(e.target.value.replace(/\D/g, '')) || 0)} aria-label={label} data-testid={testId} /></span>;
}

type CombRow = { keyword: string; pc: number | null; mobile: number | null; total: number; low: boolean };
const GROUP_HINT = ['예: 아파트, 신축아파트, 단지', '예: 커뮤니티, 헬스장, 골프연습장', '예: 운영, 위탁운영, 운영업체', '(선택) 네 번째 그룹'];
/**
 * #499-2 키워드 N단 조합기(테크트리 EP.7): 단어 그룹 2~4개 → 조합(화면에서 바로 셈, 최대 300개) → [검색량 확인](네이버 키워드 도구) → 고르기.
 * 영상 절차: 같은 그룹 안 단어끼리 꾸밀 수 없으면 그 단어를 앞 그룹에도 넣는다. '빼도 됨' 그룹은 그 그룹 없는 조합도 만든다.
 */
function KwCombiner({ accountId, have, onPick }: { accountId: string; have: string[]; onPick: (keywords: string[]) => void }) {
  const [groups, setGroups] = useState(GROUP_HINT.map(() => ({ text: '', optional: false })));
  const [rows, setRows] = useState<CombRow[] | null>(null);
  const [related, setRelated] = useState<{ keyword: string; total: number }[]>([]);
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [low, setLow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const gs = useMemo(() => groups.map((g) => ({ words: splitKw(g.text).filter((w) => [...w].length <= 20).slice(0, 20), optional: g.optional })).filter((g) => g.words.length), [groups]);
  const comb = useMemo(() => combineKeywords(gs), [gs]);
  const haveSet = new Set(have.map(kwKey));
  const setG = (i: number, patch: Partial<{ text: string; optional: boolean }>) => { setGroups((g) => g.map((x, j) => (j === i ? { ...x, ...patch } : x))); setRows(null); };
  async function check() {
    setBusy(true);
    try {
      const r = await api<{ rows: CombRow[]; truncated: boolean; failed: number; related: { keyword: string; total: number }[] }>('/api/marketing/ad-ops/keywords/combine', { body: { accountId, groups: gs } });
      setRows(r.rows); setRelated(r.related); setPick(new Set(r.rows.filter((x) => !haveSet.has(kwKey(x.keyword)) && (low || !x.low)).map((x) => x.keyword)));
      setNote(r.failed ? `검색량을 읽지 못한 조합 ${r.failed}개는 '자료 없음'으로 표시했습니다(네이버 키워드 도구 응답 실패 — 다시 확인하거나 그대로 넣을 수 있습니다).` : '');
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  const toggle = (k: string) => setPick((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const toggleLow = (on: boolean) => { setLow(on); if (rows) setPick((s) => { const n = new Set(s); for (const x of rows) if (x.low && !haveSet.has(kwKey(x.keyword))) { if (on) n.add(x.keyword); else n.delete(x.keyword); } return n; }); };
  const fresh = comb.keywords.filter((k) => !haveSet.has(kwKey(k)));
  return (
    <div className="grid gap-2 text-xs" data-testid="kw-combiner">
      {groups.map((g, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-12 shrink-0 text-ink-2">그룹 {i + 1}</span>
          <input className={cx(inputCls, 'h-8 min-w-0 flex-1 text-xs')} value={g.text} onChange={(e) => setG(i, { text: e.target.value })} placeholder={GROUP_HINT[i]} aria-label={`단어 그룹 ${i + 1}`} data-testid="kw-group" />
          <label className="flex shrink-0 items-center gap-1 whitespace-nowrap"><input type="checkbox" checked={g.optional} onChange={(e) => setG(i, { optional: e.target.checked })} data-testid="kw-group-optional" />빼도 됨</label>
        </div>))}
      <p className="text-ink-2" data-testid="kw-comb-count">조합 {comb.keywords.length}개{comb.truncated ? `(${PLAN_KEYWORDS_MAX}개에서 자름 — 그룹 단어를 줄이세요)` : ''}{comb.keywords.length ? ` · 예: ${comb.keywords.slice(0, 3).join(', ')}` : ' — 그룹 2개 이상에 단어를 쉼표로 넣으세요'}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="secondary" disabled={!accountId || gs.length < 2 || !comb.keywords.length || busy} onClick={check} data-testid="kw-comb-check">{busy ? '확인 중…' : '검색량 확인'}</Button>
        <Button type="button" size="sm" variant="secondary" disabled={!fresh.length || busy} onClick={() => onPick(fresh)} data-testid="kw-comb-all">조합 {fresh.length}개 모두 넣기(검색량 확인 없이)</Button>
      </div>
      {busy && comb.keywords.length > 50 && <p className="text-[11px] text-ink-3">조합이 많으면 30초 넘게 걸릴 수 있습니다.</p>}
      {note && <p className="text-[11px] text-amber-800" data-testid="kw-comb-note">{note}</p>}
      {rows && <>
        <label className="flex items-start gap-1"><input type="checkbox" className="mt-0.5" checked={low} onChange={(e) => toggleLow(e.target.checked)} data-testid="kw-comb-low" />
          <span>검색량 낮음(월 20 미만)도 함께 넣기 — 영상은 검색량 0인 조합도 등록하지만, 확장 검색을 켜면 그 이득이 줄어듭니다.</span></label>
        <div className="max-h-64 overflow-auto rounded-input border border-line" data-testid="kw-comb-rows"><table className="w-full min-w-[360px] text-left">
          <thead className="sticky top-0 bg-white"><tr className="text-ink-2"><th className="w-6" /><th className="py-1 font-medium">조합</th><th className="pr-1 text-right font-medium">월 검색(네이버)</th></tr></thead>
          <tbody className="divide-y divide-line tabular-nums">{rows.map((x) => { const dup = haveSet.has(kwKey(x.keyword)); return (
            <tr key={x.keyword} className={cx(x.low && 'text-ink-3')} data-testid="kw-comb-row" data-low={x.low ? '1' : '0'}>
              <td className="pl-1"><input type="checkbox" checked={pick.has(x.keyword)} disabled={dup} onChange={() => toggle(x.keyword)} aria-label={`${x.keyword} 고르기`} /></td>
              <td className="py-1">{x.keyword}{dup && <span className="ml-1 text-ink-3">(이미 있음)</span>}{x.low && <span className="ml-1 rounded bg-slate-100 px-1 text-[10px]">검색 거의 없음</span>}</td>
              <td className="pr-1 text-right">{x.pc === null ? '자료 없음' : `${n0(x.total)} (PC ${n0(x.pc)} · 모바일 ${n0(x.mobile ?? 0)})`}</td></tr>); })}</tbody></table></div>
        {related.length > 0 && <p className="flex flex-wrap gap-1" data-testid="kw-comb-related"><span className="text-ink-2">검색이 있는 연관 키워드:</span>{related.map((r) =>
          <button key={r.keyword} type="button" className={cx('rounded-full border px-2', pick.has(r.keyword) ? 'border-violet-400 bg-violet-50' : 'border-line')} onClick={() => toggle(r.keyword)}>{r.keyword} {n0(r.total)}</button>)}</p>}
        <Button type="button" size="sm" className="justify-self-start" disabled={!pick.size} onClick={() => onPick([...pick])} data-testid="kw-comb-pick">{pick.size}개 키워드에 넣기</Button>
      </>}
      <p className="text-[11px] text-ink-3">순서: 핵심 키워드를 단어 그룹 3~4개로 나눔 → 같은 그룹끼리 꾸밀 수 없는 단어는 앞 그룹에도 넣음 → 조합 → 검색량 확인 → 넣기. 말이 안 되는 조합은 검색이 없어 넣어도 돈이 나가지 않습니다.</p>
    </div>
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

type LeadRow = { key: string; provider: string; itemId: string | null; keyword: string; campaign: string; clicks: number; cost: number; tel: number; calls: number; phone: number; inquiries: number; leads: number;
  cpa: number | null; flag: 'waste' | 'high' | 'good' | null; planId: string | null; paused: boolean };
type Leads = { days: number; canEdit: boolean; totals: { cost: number; tel: number; calls: number; phone: number; inquiries: number; leads: number; cpa: number | null }; unknown: { tel: number; calls: number; inquiries: number };
  coverage: number | null; judge: boolean; target: { cpa: number | null; custom: boolean; avg: number | null }; tracking: { beacon: boolean; naverIds: boolean; calls: boolean }; rows: LeadRow[] };
const FLAG: Record<string, [string, string]> = { waste: ['0건 — 끄기 제안', 'bg-red-50 text-red-800'], high: ['비용 높음', 'bg-amber-50 text-amber-800'], good: ['잘 됨', 'bg-emerald-50 text-emerald-800'] };
const PROVIDER: Record<string, string> = { naver: '네이버', google: '구글', meta: '메타', other: '기타' };
/**
 * 광고 최적화 1차 ③ 통화 기반 최적화: 키워드별 광고비 × 광고로 들어온 전화(클릭·기록)·문의 → 전환당 비용과 판단(서버 숫자).
 * 0건인데 돈만 쓴 키워드는 '끄기 제안' — 워크인이 만든 세팅안의 키워드는 바로 [끄기](되돌리기 가능), 나머지는 네이버 화면에서.
 */
function LeadsBox({ run }: { run: (key: string, fn: () => Promise<unknown>, ok: string) => void }) {
  const [days, setDays] = useState(30);
  const { data, error, reload } = useApi<Leads>(`/api/marketing/ad-ops/leads?days=${days}`, [days]);
  const t = data?.totals;
  return (
    <section className="rounded-card border border-line bg-white p-3 shadow-card" data-testid="ad-leads">
      <div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-semibold">전화·문의 기준 키워드 점검</h2>
        <span className="w-28"><select className={cx(inputCls, 'h-8 text-xs')} value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="기간" data-testid="ad-leads-days">{[7, 30, 90].map((d) => <option key={d} value={d}>최근 {d}일</option>)}</select></span></div>
      {error ? <ErrorBox error={error} retry={reload} /> : !data || !t ? <Skeleton rows={3} /> : <>
        <p className="mt-1 text-xs text-ink-2" data-testid="ad-leads-summary">광고비 {won(t.cost)} · 전화 {n0(t.phone)}건(클릭 {n0(t.tel)} · 기록 {n0(t.calls)}) · 문의 {n0(t.inquiries)}건 → 전환당 비용 <b>{t.cpa === null ? '—' : won(t.cpa)}</b>
          {' · '}목표 {data.target.cpa === null ? '없음' : won(data.target.cpa)}({data.target.custom ? '회사 설정' : '기간 평균'})
          {data.canEdit && <> · <button type="button" className="underline" data-testid="ad-leads-target" onClick={() => { const v = prompt('목표 전환당 비용(원) — 비우면 기간 평균', data.target.custom ? String(data.target.cpa) : ''); if (v === null) return;
            const n = Number(v.replace(/\D/g, '')); if (v.trim() && !(n >= 1000)) return toast.error('1,000원 이상 숫자로 적어 주세요');
            run('cpa', async () => { await api('/api/marketing/ad-ops/target-cpa', { method: 'PUT', body: { cpa: v.trim() ? n : null } }); reload(); }, '목표 전환당 비용을 저장했습니다'); }}>목표 바꾸기</button></>}</p>
        <p className="text-[11px] text-ink-3" data-testid="ad-leads-coverage">광고 키워드를 모르는 전화 클릭 {n0(data.unknown.tel)} · 전화 기록 {n0(data.unknown.calls)} · 문의 {n0(data.unknown.inquiries)}
          {data.coverage !== null ? ` — 키워드를 아는 비율 ${data.coverage}%` : ''}{!data.judge ? ' · 추적이 절반이 안 돼 0건 키워드 판단은 하지 않습니다' : ''}. 전화 = 전화 클릭과 전화 기록 중 큰 값(같은 전화를 두 번 세지 않게).</p>
        {data.rows.length ? <div className="mt-1 overflow-x-auto"><table className="w-full min-w-[720px] text-right text-xs">
          <thead><tr className="text-ink-2"><th className="py-1 text-left font-medium">키워드</th><th className="text-left font-medium">매체</th><th className="font-medium">광고비</th><th className="font-medium">클릭</th><th className="font-medium">전화</th><th className="font-medium">문의</th><th className="font-medium">전환당 비용</th><th className="pl-2 text-left font-medium">판단</th><th /></tr></thead>
          <tbody className="divide-y divide-line tabular-nums">{data.rows.map((r) => (
            <tr key={r.key} data-testid="ad-leads-row" data-flag={r.flag ?? ''}>
              <td className="max-w-[14rem] py-1 text-left"><span className="font-medium">{r.keyword || '(키워드 없음)'}</span>{r.paused && <span className="ml-1 text-ink-3">(꺼짐)</span>}<span className="block truncate text-[11px] text-ink-3">{r.campaign || (r.itemId ? '' : '광고비 자료 없음')}</span></td>
              <td className="text-left">{PROVIDER[r.provider] ?? r.provider}</td><td>{won(r.cost)}</td><td>{n0(r.clicks)}</td>
              <td title={`클릭 ${r.tel} · 기록 ${r.calls}`}>{n0(r.phone)}</td><td>{n0(r.inquiries)}</td><td>{r.cpa === null ? '—' : won(r.cpa)}</td>
              <td className="whitespace-nowrap pl-2 text-left">{r.flag && <span className={cx('rounded-full px-1.5 py-0.5 text-[10px] font-medium', FLAG[r.flag][1])} data-testid="ad-leads-flag">{FLAG[r.flag][0]}</span>}</td>
              <td className="whitespace-nowrap pl-1">{data.canEdit && r.planId && r.itemId ? <button type="button" className="px-1 text-[11px] underline" data-testid="ad-leads-pause"
                onClick={() => { const lp = r.planId!; run(lp, async () => { await api(`/api/marketing/ad-ops/plans/${lp}/action`, { body: { action: r.paused ? 'kw_resume' : 'kw_pause', keywordIds: [r.itemId] } }); reload(); }, r.paused ? `'${r.keyword}' 키워드를 켰습니다` : `'${r.keyword}' 키워드를 껐습니다`); }}>{r.paused ? '켜기' : '끄기'}</button>
                : r.flag === 'waste' ? <span className="text-[11px] text-ink-3">네이버 화면에서 끄기</span> : null}</td>
            </tr>))}</tbody></table></div>
          : <p className="mt-1 text-xs text-ink-3">아직 키워드별 광고 성과가 없습니다 — 매체 키워드 성과는 하루 한 번 읽어 옵니다.</p>}
        <details className="mt-2 text-xs" data-testid="ad-leads-guide" open={!data.tracking.beacon && !data.tracking.calls}>
          <summary className="cursor-pointer font-medium">키워드별로 전화·문의를 세는 법</summary>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-ink-2">
            <li>네이버 광고 시스템 › 도구 › 추적 기능에서 <b>자동 추적 URL</b>을 켭니다 — 광고로 들어오면 주소 끝에 n_keyword_id 등이 붙습니다{data.tracking.naverIds ? ' (✓ 들어오고 있음)' : ''}.</li>
            <li>브랜드 사이트 비콘이 전화·버튼 클릭을 보낼 때 <b>처음 들어온 주소</b>를 landing 으로 함께 보냅니다 — 예: {'{'}event: &apos;cta&apos;, label: &apos;tel&apos;, landing: 처음 주소{'}'}{data.tracking.beacon ? ' (✓ 들어오고 있음)' : ''}. 웹 문의는 이미 유입 주소를 받습니다.</li>
            <li>전화 문의를 기록할 때 <b>광고 키워드</b>(“어떻게 알고 전화하셨어요?”)를 적으면 같이 셉니다{data.tracking.calls ? ' (✓ 기록 있음)' : ''}.</li>
          </ol>
        </details>
      </>}
    </section>
  );
}

type LeadAdsPage = { accountId: string; label: string; scopes: boolean; enabled: boolean; subscribed: boolean; webhookAt: string | null; polledAt: string | null; error: string | null };
type LeadAdsRow = { id: string; at: string; status: string; via: string; test: boolean; name: string | null; form: string | null; ad: string | null; owner: string | null; contactMin: number | null; contactVia: string | null;
  late: boolean; error: string | null; leadId: string | null };
type LeadAds = { days: number; canEdit: boolean; canSales: boolean; setup: { app: boolean; webhook: boolean; devMode?: boolean }; pages: LeadAdsPage[];
  summary: { leads: number; created: number; merged: number; problems: number; fast: number; waiting: number; medianMin: number | null };
  byAd: { key: string; ad: string; campaign: string; leads: number; fast: number; cost: number | null; cpl: number | null }[]; recent: LeadAdsRow[] };
const LEAD_CONNECT = '/api/marketing/publish/connect/meta?leads=1'; // 서버가 Facebook 동의 화면으로 보냄(페이지 이동)
const LA_STATUS: Record<string, [string, string]> = { created: ['영업 리드 만듦', 'bg-emerald-50 text-emerald-800'], merged: ['기존 리드에 붙임', 'bg-sky-50 text-sky-800'], pending: ['처리 중', 'bg-slate-100 text-ink-2'],
  working: ['처리 중', 'bg-slate-100 text-ink-2'], failed: ['실패', 'bg-red-50 text-red-800'], skipped: ['건너뜀', 'bg-amber-50 text-amber-800'] };
/**
 * 광고 2차 ① Meta 리드 광고 → 영업 리드: 페이지별 받기 상태(웹후크 마지막 수신·놓친 리드 불러오기) · 최근 신청(이름 가림) · 5분 안 첫 연락 · 광고별 리드당 비용.
 * 연결은 연결 계정의 [리드 광고 받기], 확인은 [시험 리드 보내기](Meta test_leads API — 리드 광고 테스트 도구는 개발 모드 앱에서 못 씀).
 */
function LeadAdsBox({ run }: { run: (key: string, fn: () => Promise<unknown>, ok: string) => void }) {
  const [days, setDays] = useState(30);
  const { data, error, reload } = useApi<LeadAds>(`/api/marketing/lead-ads?days=${days}`, [days]);
  const [test, setTest] = useState<{ accountId: string; label: string; forms: { id: string; name: string; status: string }[] | null; formId: string } | null>(null);
  async function openTest(p: LeadAdsPage) {
    setTest({ accountId: p.accountId, label: p.label, forms: null, formId: '' });
    try { const r = await api<{ forms: { id: string; name: string; status: string }[] }>(`/api/marketing/lead-ads/forms?accountId=${p.accountId}`); setTest({ accountId: p.accountId, label: p.label, forms: r.forms, formId: r.forms[0]?.id ?? '' }); }
    catch (e: any) { toast.error(e.message); setTest(null); }
  }
  const s = data?.summary;
  return (
    <section className="rounded-card border border-line bg-white p-3 shadow-card" data-testid="lead-ads">
      <div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-semibold">리드 광고(메타) → 영업 리드</h2>
        <span className="w-28"><select className={cx(inputCls, 'h-8 text-xs')} value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="기간" data-testid="lead-ads-days">{[7, 30, 90].map((d) => <option key={d} value={d}>최근 {d}일</option>)}</select></span>
        {data?.canEdit && data.pages.some((p) => p.enabled) && <Button size="sm" variant="secondary" className="ml-auto" data-testid="lead-ads-pull"
          onClick={() => run('lead-pull', async () => { await api('/api/marketing/lead-ads/pull', { body: { days: 3 } }); reload(); }, '최근 3일 리드를 다시 확인했습니다')}>지금 불러오기</Button>}</div>
      {error ? <ErrorBox error={error} retry={reload} /> : !data || !s ? <Skeleton rows={3} /> : <>
        <p className="mt-1 text-xs text-ink-2" data-testid="lead-ads-summary">신청 {n0(s.leads)}건(새 리드 {n0(s.created)} · 기존 리드에 붙임 {n0(s.merged)}) · 5분 안 첫 연락 <b>{n0(s.fast)}/{n0(s.leads)}</b>
          {' · '}첫 연락까지 중간값 {s.medianMin === null ? '—' : `${s.medianMin}분`} · 연락 전 {n0(s.waiting)}건{s.problems ? <span className="text-red-700"> · 처리 못 함 {n0(s.problems)}건</span> : null}</p>
        <ul className="mt-2 space-y-1 text-xs" data-testid="lead-ads-pages">{data.pages.map((p) => (
          <li key={p.accountId} className="flex flex-wrap items-center gap-2 rounded-input bg-slate-50 px-2 py-1.5" data-testid="lead-ads-page" data-state={p.enabled ? 'on' : p.scopes ? 'off' : 'scopes'}>
            <span className="font-medium">{p.label}</span>
            <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-medium', p.enabled ? 'bg-emerald-50 text-emerald-800' : p.scopes ? 'bg-slate-100 text-ink-2' : 'bg-amber-50 text-amber-800')}>{p.enabled ? '받는 중' : p.scopes ? '꺼짐' : '리드 권한 필요'}</span>
            {p.enabled && <span className="text-ink-3" data-testid="lead-ads-webhook">웹후크 {p.webhookAt ? `마지막 수신 ${fmtDateTime(p.webhookAt)}` : '아직 받은 적 없음'} · 놓친 리드 확인 {p.polledAt ? fmtDateTime(p.polledAt) : '아직'}</span>}
            {p.enabled && data.setup.devMode && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-900" data-testid="lead-ads-devmode">개발 모드: 실제 광고 리드는 30분마다 불러오기로 들어옵니다(앱 심사·라이브 뒤 실시간)</span>}
            {data.canEdit && <span className="ml-auto flex flex-wrap gap-1.5">
              {p.enabled ? <><Button size="sm" variant="secondary" onClick={() => openTest(p)} data-testid="lead-ads-test">시험 리드 보내기</Button>
                <Button size="sm" variant="secondary" data-testid="lead-ads-off" onClick={() => confirm(`'${p.label}' 의 리드 광고 받기를 끌까요? 새 신청이 영업 리드로 들어오지 않습니다.`) && run(`lp-${p.accountId}`, async () => { await api(`/api/marketing/lead-ads/pages/${p.accountId}`, { method: 'PUT', body: { enabled: false } }); reload(); }, '리드 광고 받기를 껐습니다')}>끄기</Button></>
                : p.scopes ? <Button size="sm" data-testid="lead-ads-on" onClick={() => run(`lp-${p.accountId}`, async () => { await api(`/api/marketing/lead-ads/pages/${p.accountId}`, { method: 'PUT', body: { enabled: true } }); reload(); }, '리드 광고 받기를 켰습니다')}>켜기</Button>
                : <a href={LEAD_CONNECT} className="inline-flex min-h-8 items-center rounded-input bg-violet-600 px-3 text-xs font-medium text-white" data-testid="lead-ads-connect">리드 광고 받기</a>}</span>}
            {p.error && <span className="w-full break-words text-amber-800" data-testid="lead-ads-page-error">{p.error}</span>}
          </li>))}
          {!data.pages.length && <li className="text-ink-3">연결된 페이스북 페이지가 없습니다 — 설정 › 연결 계정에서 페이스북 페이지를 연결한 뒤 [리드 광고 받기]를 눌러 주세요.</li>}</ul>
        {data.canEdit && !data.setup.webhook && data.pages.some((p) => p.enabled) && <p className="mt-1 text-[11px] text-amber-800" data-testid="lead-ads-no-webhook">웹후크 확인 토큰이 아직 설정되지 않았습니다(플랫폼 설정) — 그동안은 30분마다 놓친 리드를 불러와 등록합니다.</p>}
        {data.recent.length ? <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[680px] text-left text-xs">
          <thead><tr className="text-ink-2"><th className="py-1 font-medium">신청</th><th className="font-medium">이름</th><th className="font-medium">양식 · 광고</th><th className="font-medium">담당</th><th className="font-medium">첫 연락</th><th className="font-medium">처리</th></tr></thead>
          <tbody className="divide-y divide-line">{data.recent.map((r) => (
            <tr key={r.id} data-testid="lead-ads-row" data-status={r.status}>
              <td className="whitespace-nowrap py-1 text-ink-2">{fmtDateTime(r.at)}</td>
              <td className="whitespace-nowrap">{r.test && <span className="mr-1 rounded-full bg-slate-100 px-1.5 text-[10px]">시험</span>}{r.leadId ? <Link href={`/s/sales/leads?id=${r.leadId}`} className="underline" style={{ color: C }}>{r.name ?? '리드'}</Link> : (r.name ?? '—')}</td>
              <td className="max-w-[14rem] truncate">{[r.form, r.ad].filter(Boolean).join(' · ') || '—'}</td>
              <td className="whitespace-nowrap">{r.owner ?? '—'}</td>
              <td className="whitespace-nowrap" data-testid="lead-ads-contact">{r.contactMin !== null ? <span className={r.contactMin <= 5 ? 'text-emerald-800' : 'text-amber-800'}>{r.contactMin}분 · {r.contactVia}</span>
                : r.status === 'created' || r.status === 'merged' ? <span className={r.late ? 'font-medium text-red-700' : 'text-ink-3'}>{r.late ? '연락 전(재알림 보냄)' : '연락 전'}</span> : '—'}</td>
              <td className="whitespace-nowrap"><span className={cx('rounded-full px-1.5 py-0.5 text-[10px] font-medium', (LA_STATUS[r.status] ?? [r.status, 'bg-slate-100'])[1])}>{(LA_STATUS[r.status] ?? [r.status])[0]}</span>
                {(r.status === 'failed' || r.status === 'skipped') && data.canEdit && <button type="button" className="ml-1 text-[11px] underline" data-testid="lead-ads-retry"
                  onClick={() => run(`lr-${r.id}`, async () => { await api(`/api/marketing/lead-ads/${r.id}/retry`, { body: {} }); reload(); }, '다시 처리했습니다')}>다시 처리</button>}
                {r.error && <span className="block max-w-[16rem] whitespace-normal break-words text-[11px] text-red-700">{r.error}</span>}</td>
            </tr>))}</tbody></table></div>
          : <p className="mt-2 text-xs text-ink-3" data-testid="lead-ads-empty">이 기간에 들어온 리드 광고 신청이 없습니다.</p>}
        {data.byAd.length > 0 && <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[560px] text-right text-xs" data-testid="lead-ads-by-ad">
          <thead><tr className="text-ink-2"><th className="py-1 text-left font-medium">광고</th><th className="font-medium">리드</th><th className="font-medium">5분 안 연락</th><th className="font-medium">광고비</th><th className="font-medium">리드당 비용</th></tr></thead>
          <tbody className="divide-y divide-line tabular-nums">{data.byAd.map((g) => (
            <tr key={g.key} data-testid="lead-ads-ad"><td className="max-w-[16rem] py-1 text-left"><span className="font-medium">{g.ad}</span>{g.campaign && <span className="block truncate text-[11px] text-ink-3">{g.campaign}</span>}</td>
              <td>{n0(g.leads)}</td><td>{n0(g.fast)}/{n0(g.leads)}</td><td>{g.cost === null ? '—' : won(g.cost)}</td><td>{g.cpl === null ? '—' : won(g.cpl)}</td></tr>))}</tbody></table>
          <p className="mt-0.5 text-[11px] text-ink-3">광고비는 메타 광고 계정 성과(하루 한 번 읽음)에서 — 광고 계정이 연결되지 않았으면 “—”.</p></div>}
        <details className="mt-2 text-xs" data-testid="lead-ads-guide" open={!data.pages.some((p) => p.enabled)}>
          <summary className="cursor-pointer font-medium">리드 광고를 영업 리드로 받는 법</summary>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-ink-2">
            <li>설정 › 연결 계정 › 페이스북 페이지 [리드 광고 받기] — 페이지 관리자 계정으로 리드 권한까지 모두 허용합니다.</li>
            <li>메타 광고 관리자에서 목표 &apos;잠재 고객 확보&apos; 광고와 인스턴트 양식(이름·전화번호 질문 포함)을 만듭니다.</li>
            <li>신청이 들어오면 바로 영업 › 리드에 &apos;신규리드&apos;로 등록되고, 담당에게 업무 &apos;5분 안에 첫 연락&apos;과 알림이 갑니다. 같은 전화번호 리드가 있으면 그 리드에 기록으로 붙습니다.</li>
            <li>담당은 관리 › 사용자 관리 › 담당자 지정의 &apos;영업 담당(원천별) · 리드&apos;를 따릅니다(없으면 리드 광고를 켠 관리자).</li>
            <li>5분이 지나도 [전화]·[문자]·상담 기록·단계 변경이 없으면 담당과 관리자에게 다시 알립니다(점검 간격 때문에 최대 15분 늦을 수 있음).</li>
            <li>[시험 리드 보내기]로 흐름을 확인할 수 있습니다 — 이름 앞에 [시험]이 붙고 알림은 누른 사람에게만 갑니다.</li>
          </ol>
        </details>
      </>}
      <CapiBox run={run} />
      {test && <Modal open onClose={() => setTest(null)} title="시험 리드 보내기">
        <div className="space-y-3 text-sm" data-testid="lead-ads-test-dialog">
          <p className="text-xs text-ink-2">{test.label} 의 인스턴트 양식에 Meta 시험 리드를 하나 만들고(양식마다 1개 — 전에 만든 시험 리드는 지움) 바로 영업 리드로 등록합니다. 광고비는 들지 않습니다.</p>
          {!test.forms ? <Skeleton rows={2} /> : test.forms.length ? <Field label="양식"><select className={inputCls} value={test.formId} onChange={(e) => setTest({ ...test, formId: e.target.value })} data-testid="lead-ads-test-form">
            {test.forms.map((f) => <option key={f.id} value={f.id}>{f.name}{f.status && f.status !== 'ACTIVE' ? ` (${f.status})` : ''}</option>)}</select></Field>
            : <p className="text-xs text-amber-800">이 페이지에 인스턴트 양식이 없습니다 — 메타 광고 관리자(또는 비즈니스 스위트 › 인스턴트 양식)에서 먼저 만들어 주세요.</p>}
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setTest(null)}>취소</Button>
            <Button disabled={!test.formId} data-testid="lead-ads-test-send" onClick={() => { const t = test; setTest(null); run('lead-test', async () => { await api('/api/marketing/lead-ads/test', { body: { accountId: t.accountId, formId: t.formId } }); reload(); }, '시험 리드를 보냈습니다 — 영업 › 리드에 [시험] 리드가 생겼습니다'); }}>보내기</Button></div>
        </div>
      </Modal>}
    </section>
  );
}

type CapiRow = { id: string; event_name: string; stage: string; event_time: string; status: string; attempts: number; error: string | null; sent_at: string | null; lead_tail: string };
type Capi = { canEdit: boolean; on: boolean; datasetId: string; source: string; map: Record<string, string>; defaults: Record<string, string>; stages: string[]; hasToken: boolean; since: string | null;
  stats: { sent7: number; pending: number; failed: number; skipped7: number; lastSent: string | null; lastError: string | null }; recent: CapiRow[] };
const CAPI_STATUS: Record<string, [string, string]> = { pending: ['대기', 'bg-slate-100 text-ink-2'], sent: ['보냄', 'bg-emerald-50 text-emerald-800'], failed: ['실패', 'bg-red-50 text-red-800'], skipped: ['건너뜀', 'bg-amber-50 text-amber-800'] };
/**
 * #499-3 리드 단계 → Meta 전환 API(CAPI for CRM): 리드 광고로 들어온 영업 리드의 단계를 메타에 돌려보내 신청만 하는 사람보다 미팅·계약까지 가는 사람을 더 찾게 함.
 * 보내는 것 = 메타 리드 번호·단계 이름·시각. 기본 꺼짐 — 켜기·데이터 세트·토큰·이름표는 관리자, 처리방침 문구는 대표 결정.
 */
function CapiBox({ run }: { run: (key: string, fn: () => Promise<unknown>, ok: string) => void }) {
  const { data, error, reload } = useApi<Capi>('/api/marketing/lead-ads/capi');
  const [f, setF] = useState<{ on: boolean; datasetId: string; token: string; source: string; map: Record<string, string> } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState('');
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Skeleton rows={2} />;
  const v = f ?? { on: data.on, datasetId: data.datasetId, token: '', source: data.source, map: data.map };
  const set = (p: Partial<typeof v>) => setF({ ...v, ...p });
  const save = () => run('capi', async () => {
    await api('/api/marketing/lead-ads/capi', { method: 'PUT', body: { on: v.on, datasetId: v.datasetId.trim(), ...(v.token.trim() ? { token: v.token.trim() } : {}), source: v.source.trim() || 'Workin', map: v.map } });
    await reload(); setF(null); // 저장된 값을 받아 온 뒤에 입력 칸을 비움(잠깐 옛 값이 보이지 않게)
  }, v.on ? '전환 API 를 켰습니다 — 리드 단계가 바뀌면 메타로 보냅니다' : '전환 API 설정을 저장했습니다');
  async function act(kind: 'send' | 'test') {
    setBusy(kind);
    try {
      if (kind === 'send') { const r = await api<{ queued: number; sent: number; failed: number }>('/api/marketing/lead-ads/capi/send', { body: {} }); toast.ok(`새 이벤트 ${r.queued}건 · 보냄 ${r.sent}건${r.failed ? ` · 실패 ${r.failed}건` : ''}`); }
      else { const r = await api<{ received: number; eventName: string; leadTail: string }>('/api/marketing/lead-ads/capi/test', { body: { testEventCode: code } }); toast.ok(`시험 이벤트를 보냈습니다 — 메타가 받음 ${r.received}건('${r.eventName}', 리드 …${r.leadTail}). 이벤트 테스트 탭에서 확인하세요`); }
      reload();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(''); }
  }
  return (
    <div className="mt-3 rounded-input border border-line p-2 text-xs" data-testid="capi" data-on={data.on ? '1' : '0'}>
      <div className="flex flex-wrap items-center gap-2"><b className="text-sm">리드 단계 → 메타에 알리기(전환 API)</b>
        <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-medium', data.on ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-ink-2')} data-testid="capi-state">{data.on ? '보내는 중' : '꺼짐'}</span>
        {data.canEdit && data.on && <Button size="sm" variant="secondary" className="ml-auto" disabled={busy !== ''} onClick={() => act('send')} data-testid="capi-send">{busy === 'send' ? '보내는 중…' : '지금 보내기'}</Button>}</div>
      <p className="mt-1 text-ink-2">영업 리드 단계(새 리드 → 1차 연락 → 미팅 … → 계약)를 메타에 돌려보내, 메타가 신청만 하는 사람보다 실제로 미팅·계약까지 가는 사람을 더 찾게 합니다(메타 &apos;전환 리드&apos; 최적화). 보내는 것은 <b>메타 리드 번호·단계 이름·바뀐 시각</b>뿐 — 이름·전화·이메일은 보내지 않습니다.</p>
      <p className="mt-1 text-ink-2" data-testid="capi-stats">지난 7일 보냄 {n0(data.stats.sent7)}건 · 대기 {n0(data.stats.pending)} · 실패 {n0(data.stats.failed)}{data.stats.skipped7 ? ` · 건너뜀 ${n0(data.stats.skipped7)}` : ''}{data.stats.lastSent ? ` · 마지막 ${fmtDateTime(data.stats.lastSent)}` : ''}</p>
      {data.stats.lastError && <p className="mt-0.5 break-words text-amber-800" data-testid="capi-error">최근 오류: {data.stats.lastError}</p>}
      {data.canEdit && <details className="mt-2" open={!data.on} data-testid="capi-setup">
        <summary className="cursor-pointer font-medium">설정 · 단계 이름표</summary>
        <div className="mt-2 grid gap-2">
          <label className="flex items-start gap-1.5"><input type="checkbox" className="mt-0.5" checked={v.on} onChange={(e) => set({ on: e.target.checked })} data-testid="capi-on" /><span><b>켜기</b> — 리드 광고로 들어온 리드의 단계가 바뀌면 메타로 보냅니다(하루 여러 번)</span></label>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="데이터 세트(픽셀) ID"><input className={inputCls} inputMode="numeric" value={v.datasetId} onChange={(e) => set({ datasetId: e.target.value.replace(/\D/g, '') })} placeholder="예: 1234567890123456" data-testid="capi-dataset" /></Field>
            <Field label="전환 API 토큰"><input className={inputCls} type="password" autoComplete="off" value={v.token} onChange={(e) => set({ token: e.target.value })} placeholder={data.hasToken ? '저장됨 — 바꿀 때만 넣기' : '이벤트 관리자에서 만든 토큰'} data-testid="capi-token" /></Field>
          </div>
          <Field label="CRM 이름(메타 이벤트에 보이는 이름)"><input className={inputCls} value={v.source} maxLength={40} onChange={(e) => set({ source: e.target.value })} data-testid="capi-source" /></Field>
          <div className="overflow-x-auto"><table className="w-full min-w-[300px] text-left" data-testid="capi-map">
            <thead><tr className="text-ink-2"><th className="py-1 font-medium">워크인 단계</th><th className="font-medium">메타 이벤트 이름(비우면 안 보냄)</th></tr></thead>
            <tbody className="divide-y divide-line">{data.stages.map((s) => (
              <tr key={s}><td className="whitespace-nowrap py-1 pr-2">{s}</td>
                <td><input className={cx(inputCls, 'h-8 py-1 text-xs')} value={v.map[s] ?? ''} maxLength={40} onChange={(e) => set({ map: { ...v.map, [s]: e.target.value } })} aria-label={`${s} 이벤트 이름`} placeholder="보내지 않음" data-testid="capi-map-input" /></td></tr>))}</tbody></table></div>
          <p className="text-[11px] text-ink-3">같은 이름은 리드마다 한 번만 보냅니다. 단계를 건너뛰면(예: 새 리드 → 미팅) 건너뛴 앞 단계도 같은 시각으로 보냅니다. 메타 이벤트 관리자의 &apos;세일즈 퍼널 설정&apos;에서 이 이름들로 단계 순서를 고릅니다.</p>
          <div className="flex flex-wrap gap-2"><Button size="sm" onClick={save} data-testid="capi-save">저장</Button>
            {f && <Button size="sm" variant="secondary" onClick={() => setF(null)}>되돌리기</Button>}</div>
          <div className="flex flex-wrap items-end gap-2 border-t border-line pt-2">
            <Field label="시험 이벤트 코드(이벤트 관리자 › 이벤트 테스트)"><input className={cx(inputCls, 'h-8 py-1 text-xs')} value={code} onChange={(e) => setCode(e.target.value.trim())} placeholder="예: TEST12345" data-testid="capi-test-code" /></Field>
            <Button size="sm" variant="secondary" disabled={!code || !data.datasetId || !data.hasToken || busy !== ''} onClick={() => act('test')} data-testid="capi-test">{busy === 'test' ? '보내는 중…' : '시험 보내기'}</Button>
          </div>
          <ol className="list-decimal space-y-0.5 pl-5 text-[11px] text-ink-2" data-testid="capi-guide">
            <li>메타 이벤트 관리자 › 데이터 소스 연결 › <b>CRM</b> 으로 데이터 세트를 만들고(기존 것을 CRM 으로 바꿔도 됨) ID 를 넣습니다. 한 번 연결한 뒤에는 바꾸지 마세요(학습이 처음부터 다시 시작됨).</li>
            <li>그 데이터 세트의 설정 › 전환 API › <b>액세스 토큰 생성</b> → 위 칸에 붙여 넣고 저장합니다(워크인은 암호화해 보관하고 다시 보여 주지 않음).</li>
            <li>[시험 보내기] 뒤 이벤트 테스트 탭에 보이면 [켜기] — 켠 때로부터 7일 전 신청까지 보냅니다(메타가 받는 한도).</li>
            <li><b>켜기 전 대표 확인:</b> 개인정보 처리방침에 &apos;광고 성과 측정을 위해 리드 진행 단계(메타 리드 번호·단계·시각)를 Meta 에 보냅니다&apos; 문구.</li>
            <li>메타 &apos;전환 리드&apos; 최적화 기준: 월 리드 200건 이상 · 목표 단계가 28일 안 · 도달률 1~40%. 모자라도 지금부터 보내 두면 보고에 쓰입니다.</li>
          </ol>
        </div>
      </details>}
      {data.recent.length > 0 && <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[480px] text-left" data-testid="capi-recent">
        <thead><tr className="text-ink-2"><th className="py-1 font-medium">단계 시각</th><th className="font-medium">이벤트</th><th className="font-medium">리드</th><th className="font-medium">상태</th></tr></thead>
        <tbody className="divide-y divide-line">{data.recent.map((r) => { const [label, cls] = CAPI_STATUS[r.status] ?? [r.status, 'bg-slate-100']; return (
          <tr key={r.id} data-testid="capi-row" data-status={r.status}><td className="whitespace-nowrap py-1 text-ink-2">{fmtDateTime(r.event_time)}</td><td>{r.event_name} <span className="text-ink-3">({r.stage})</span></td><td className="text-ink-3">…{r.lead_tail}</td>
            <td><span className={cx('rounded-full px-1.5 py-0.5 text-[10px] font-medium', cls)}>{label}</span>{r.error && <span className="block max-w-[18rem] whitespace-normal break-words text-[11px] text-red-700">{r.error}</span>}</td></tr>); })}</tbody></table></div>}
    </div>
  );
}
