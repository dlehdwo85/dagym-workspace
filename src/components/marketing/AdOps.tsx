'use client';
import { useState } from 'react';
import { api, useApi } from '@/components/client';
import { Button, ErrorBox, Field, Modal, Skeleton, cx, fmtDateTime, inputCls, toast } from '@/components/ui';

const C = '#7C3AED';
/** 네이버 소재 허용 문자(서버 검사와 같은 규칙) — 저장 전에 바로 표시 */
const NAVER_OK = /^[가-힣ㄱ-ㅎㅏ-ㅣA-Za-z0-9 .,!?%&()+\-/:'"~@#*\[\]]$/;
const badChars = (t: string) => [...new Set([...t].filter((c) => !NAVER_OK.test(c)))].join(' ');
const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`;
type Plan = { id: string; account_id: string; kind: string; name: string; plan: { dailyBudget: number; bidAmt: number; channelId: string; keywords: string[]; ads: { headline: string; description: string; url: string }[] };
  status: string; external: Record<string, unknown>; error: string | null; created_at: string; approved_at: string | null; account_label: string; approved_by_name: string | null; issues: string[] };
type Change = { id: string; plan_id: string | null; kind: string; before: any; after: any; money_up: boolean; status: string; error: string | null; revert_of: string | null; created_at: string; actor_name: string | null };
type Data = { canEdit: boolean; cap: { monthlyCap: number; stoppedMonth: string | null } | null; monthSpend: number; month: string; accounts: { id: string; label: string; external_id: string }[]; plans: Plan[]; changes: Change[] };
const STATUS: Record<string, [string, string]> = { draft: ['세팅안', 'bg-slate-100 text-ink-2'], creating: ['만드는 중', 'bg-sky-50 text-sky-800'], created: ['만듦 · 꺼짐', 'bg-sky-50 text-sky-800'], active: ['켜짐', 'bg-emerald-50 text-emerald-800'],
  paused: ['꺼짐', 'bg-amber-50 text-amber-800'], failed: ['만들기 실패', 'bg-red-50 text-red-800'] };
const KIND: Record<string, string> = { create: '꺼진 상태로 생성', enable: '켜기', pause: '끄기', budget: '하루 예산 변경', auto_pause: '상한 도달 자동 중지' };
const desc = (c: Change) => c.kind === 'budget' ? `${won(c.before?.dailyBudget)} → ${won(c.after?.dailyBudget)}` : c.kind === 'auto_pause' && c.after?.spend ? `이번 달 ${won(c.after.spend)} / 상한 ${won(c.after.cap)}` : '';

/**
 * V44 ① 광고 운영(네이버 검색광고 파워링크) — 세팅안 → [승인하고 시작](꺼진 상태로 생성) → [켜기](상한 검사) · 변경 기록·되돌리기.
 * 대표 결정 전 기본값: 월 상한 필수 입력, 넘으면 워크인이 켠 광고 자동 중지.
 */
export function AdOps() {
  const { data, error, reload } = useApi<Data>('/api/marketing/ad-ops');
  const [capIn, setCapIn] = useState('');
  const [form, setForm] = useState<false | true | Plan>(false); // true = 새 세팅안, Plan = 고치기
  const [busy, setBusy] = useState<string | null>(null);
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Skeleton rows={6} />;
  const pct = data.cap ? Math.min(100, (data.monthSpend / data.cap.monthlyCap) * 100) : 0;
  async function run(key: string, fn: () => Promise<unknown>, ok: string) { setBusy(key); try { await fn(); toast.ok(ok); reload(); } catch (e: any) { toast.error(e.message); reload(); } finally { setBusy(null); } }
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
      </section>

      <section className="rounded-card border border-line bg-white p-3 shadow-card">
        <div className="flex items-center gap-2"><h2 className="text-sm font-semibold">네이버 파워링크 세팅안</h2>
          {data.canEdit && <Button size="sm" className="ml-auto" onClick={() => setForm(true)} disabled={!data.accounts.length} title={data.accounts.length ? undefined : '네이버 검색광고 연결 후'} data-testid="ad-plan-new">새 세팅안</Button>}</div>
        {!data.accounts.length && <p className="mt-1 text-xs text-ink-3">먼저 설정 › 연결 계정에서 네이버 검색광고를 연결해 주세요.</p>}
        <ul className="mt-2 space-y-2">{data.plans.map((p) => {
          const [label, cls] = STATUS[p.status] ?? [p.status, 'bg-slate-100'];
          return (
            <li key={p.id} className="rounded-input border border-line p-2 text-sm" data-testid="ad-plan">
              <div className="flex flex-wrap items-center gap-2"><b>{p.name}</b><span className={cx('rounded-full px-2 py-0.5 text-[11px] font-medium', cls)} data-testid="ad-plan-status">{label}</span>
                <span className="text-xs text-ink-2">{p.account_label} · 하루 {won(p.plan.dailyBudget)} · 입찰 {won(p.plan.bidAmt)} · 키워드 {p.plan.keywords.length}개</span></div>
              <p className="mt-0.5 text-xs text-ink-2">키워드: {p.plan.keywords.join(', ')}</p>
              {p.plan.ads.map((a, k) => <p key={k} className="mt-0.5 text-xs"><b className="text-emerald-800">{a.headline}</b> {a.description} <span className="text-ink-3">{a.url}</span></p>)}
              {p.issues.length > 0 && <ul className="mt-1 space-y-0.5 text-xs text-amber-800" data-testid="ad-plan-issues">{p.issues.map((x, k) => <li key={k}>검사: {x}</li>)}</ul>}
              {p.error && <p className="mt-1 break-words text-xs text-red-700">{p.error}</p>}
              {data.canEdit && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {(p.status === 'draft' || p.status === 'failed') && <Button size="sm" variant="secondary" onClick={() => setForm(p)} data-testid="ad-plan-edit">수정</Button>}
                  {(p.status === 'draft' || p.status === 'failed') && <Button size="sm" disabled={!!p.issues.length || !data.cap || busy === p.id} data-testid="ad-plan-approve"
                    onClick={() => confirm(`'${p.name}' 을(를) 네이버에 꺼진 상태로 만들까요? 켜기 전에는 광고비가 나가지 않습니다.`) && run(p.id, () => api(`/api/marketing/ad-ops/plans/${p.id}/approve`, { body: {} }), '네이버에 꺼진 상태로 만들었습니다')}>승인하고 시작</Button>}
                  {(p.status === 'created' || p.status === 'paused') && <Button size="sm" disabled={busy === p.id} data-testid="ad-plan-enable"
                    onClick={() => confirm(`광고를 켭니다. 하루 최대 ${won(p.plan.dailyBudget)} 이 나갈 수 있습니다(이번 달 ${won(data.monthSpend)} / 상한 ${data.cap ? won(data.cap.monthlyCap) : '없음'}). 켤까요?`) && run(p.id, () => api(`/api/marketing/ad-ops/plans/${p.id}/action`, { body: { action: 'enable' } }), '광고를 켰습니다')}>켜기</Button>}
                  {p.status === 'active' && <Button size="sm" variant="secondary" disabled={busy === p.id} data-testid="ad-plan-pause" onClick={() => run(p.id, () => api(`/api/marketing/ad-ops/plans/${p.id}/action`, { body: { action: 'pause' } }), '광고를 껐습니다')}>끄기</Button>}
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
          const canRevert = data.canEdit && c.status === 'applied' && ['enable', 'pause', 'budget', 'auto_pause'].includes(c.kind) && !reverted.has(c.id);
          return (
            <li key={c.id} className="flex flex-wrap items-center gap-2 py-1.5" data-testid="ad-change">
              <span className="text-ink-3">{fmtDateTime(c.created_at)}</span><b>{KIND[c.kind] ?? c.kind}</b>{c.money_up && <span className="rounded-full bg-amber-50 px-1.5 text-[10px] text-amber-800">돈 나가는 변경</span>}
              <span>{plan?.name ?? ''} {desc(c)}</span><span className="text-ink-3">{c.actor_name ?? (c.kind === 'auto_pause' ? '워크인 자동' : '')}</span>
              {c.status === 'failed' && <span className="break-words text-red-700">실패: {c.error}</span>}
              {c.revert_of && <span className="text-ink-3">(되돌림)</span>}
              {canRevert && <Button size="sm" variant="secondary" className="ml-auto" onClick={() => confirm('이 변경 전으로 되돌릴까요?') && run(c.id, () => api(`/api/marketing/ad-ops/changes/${c.id}/revert`, { body: {} }), '되돌렸습니다')} data-testid="ad-change-revert">되돌리기</Button>}
            </li>);
        })}{!data.changes.length && <li className="py-1.5 text-ink-3">아직 변경이 없습니다</li>}</ul>
      </section>
      {form && <PlanForm accounts={data.accounts} edit={form === true ? undefined : form} onClose={() => setForm(false)} onDone={reload} />}
    </div>
  );
}

function PlanForm({ accounts, edit, onClose, onDone }: { accounts: Data['accounts']; edit?: Plan; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState(edit
    ? { accountId: edit.account_id, name: edit.name, dailyBudget: String(edit.plan.dailyBudget), bidAmt: String(edit.plan.bidAmt), channelId: edit.plan.channelId, keywords: edit.plan.keywords.join(', '), ads: edit.plan.ads.map((a) => ({ ...a })) }
    : { accountId: accounts[0]?.id ?? '', name: '', dailyBudget: '10000', bidAmt: '300', channelId: '', keywords: '', ads: [{ headline: '', description: '', url: 'https://' }] });
  const ch = useApi<{ channels: { id: string; name: string; url: string | null; type: string }[] }>(f.accountId ? `/api/marketing/ad-ops/channels?accountId=${f.accountId}` : null, [f.accountId]);
  const [busy, setBusy] = useState(false);
  const setAd = (k: number, patch: Partial<(typeof f.ads)[number]>) => setF({ ...f, ads: f.ads.map((a, i) => (i === k ? { ...a, ...patch } : a)) });
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try {
      const r = await api<{ issues: string[] }>(edit ? `/api/marketing/ad-ops/plans/${edit.id}` : '/api/marketing/ad-ops/plans', { method: edit ? 'PUT' : 'POST', body: { accountId: f.accountId, name: f.name, dailyBudget: Number(f.dailyBudget), bidAmt: Number(f.bidAmt), channelId: f.channelId,
        keywords: f.keywords.split(/[\n,]/).map((s) => s.trim()).filter(Boolean), ads: f.ads } });
      r.issues.length ? toast.error(`저장했습니다 — 검사 ${r.issues.length}건을 고쳐야 시작할 수 있습니다`) : toast.ok('세팅안을 저장했습니다');
      onDone(); onClose();
    } catch (er: any) { toast.error(er.message); } finally { setBusy(false); }
  }
  const len = (s: string) => [...s].length;
  return (
    <Modal open onClose={onClose} title={edit ? '세팅안 고치기' : '네이버 파워링크 세팅안'}>
      <form onSubmit={save} className="grid gap-3 text-sm" data-testid="ad-plan-form">
        <Field label="광고 계정"><select className={inputCls} value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value, channelId: '' })}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></Field>
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
        {f.ads.map((a, k) => (
          <fieldset key={k} className="grid gap-2 rounded-input border border-line p-2"><legend className="px-1 text-xs text-ink-2">소재 {k + 1}</legend>
            <input className={inputCls} value={a.headline} onChange={(e) => setAd(k, { headline: e.target.value })} placeholder={`제목(15자) ${len(a.headline)}/15`} aria-label={`소재 ${k + 1} 제목`} required data-testid="ad-plan-headline" />
            <input className={inputCls} value={a.description} onChange={(e) => setAd(k, { description: e.target.value })} placeholder={`설명(45자) ${len(a.description)}/45`} aria-label={`소재 ${k + 1} 설명`} required data-testid="ad-plan-desc" />
            <input className={inputCls} value={a.url} onChange={(e) => setAd(k, { url: e.target.value })} aria-label={`소재 ${k + 1} 연결 주소`} required data-testid="ad-plan-url" />
            <span className={cx('text-[11px]', len(a.headline) > 15 || len(a.description) > 45 || badChars(a.headline + a.description) ? 'text-red-700' : 'text-ink-3')} data-testid="ad-plan-len">제목 {len(a.headline)}/15 · 설명 {len(a.description)}/45{badChars(a.headline + a.description) ? ` · 쓸 수 없는 문자 ${badChars(a.headline + a.description)}` : ''}</span>
          </fieldset>))}
        {f.ads.length < 3 && <Button type="button" size="sm" variant="secondary" className="justify-self-start" onClick={() => setF({ ...f, ads: [...f.ads, { headline: '', description: '', url: f.ads[0].url }] })}>소재 추가(3개까지)</Button>}
        <p className="text-[11px] text-ink-3">저장해도 네이버에는 아직 만들지 않습니다. 목록에서 검사 결과를 확인하고 [승인하고 시작]을 누르면 꺼진 상태로 만들어집니다.</p>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>취소</Button><Button type="submit" disabled={busy} data-testid="ad-plan-save">세팅안 저장</Button></div>
      </form>
    </Modal>
  );
}
