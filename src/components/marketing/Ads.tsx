'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api, useApi } from '@/components/client';
import { Button, ErrorBox, Field, Modal, PendingButton, Skeleton, btnCls, cx, fmtDateTime, inputCls, toast } from '@/components/ui';

const C = '#7C3AED';
const P_COLOR: Record<string, string> = { naver: '#03C75A', google: '#4285F4', meta: '#1877F2' };
type Acc = { id: string; provider: string; external_id: string; label: string; status: string; last_sync_at: string | null; last_error: string | null; brand: string | null };
type Camp = { account_id: string; provider: string; label: string; campaign_id: string; campaign_name: string; currency: string; impressions: number; clicks: number; cost: number; conversions: number };
type Data = { days: number; accounts: Acc[]; totals: { impressions: number; clicks: number; cost: number; conversions: number }; campaigns: Camp[];
  daily: { day: string; clicks: number; cost: number; conversions: number }[]; providers: { key: string; label: string; ready: boolean }[]; canEdit: boolean; callbacks: { meta: string; google: string } | null };
const n0 = (v: number) => Math.round(v).toLocaleString('ko-KR');
const won = (v: number, cur = 'KRW') => (cur === 'KRW' ? `${n0(v)}원` : `${v.toLocaleString('ko-KR', { maximumFractionDigits: 2 })} ${cur}`);
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(2)}%` : '—');

const NAVER_API_PAGE = 'https://manage.searchad.naver.com/';
/** 3단계 안내 그림(실제 화면 모양을 단순화한 그림 — 실제 캡처로 바꿀 자리: public/guide/naver-ads-{1,2,3}.png) */
function Shot({ step, children }: { step: number; children: React.ReactNode }) {
  return <div className="rounded-input border border-line bg-slate-50 p-2 text-[11px] text-ink-2" aria-hidden data-testid={`naver-shot-${step}`}>{children}</div>;
}
export function NaverForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const brands = useApi<{ brands: { id: string; name: string }[] }>('/api/marketing/brands');
  const [f, setF] = useState({ label: '', customerId: '', apiKey: '', secretKey: '', brandId: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const tried = useRef('');
  async function save(e?: React.FormEvent) {
    e?.preventDefault(); setBusy(true); setErr('');
    tried.current = `${f.customerId}|${f.apiKey}|${f.secretKey}`;
    try { await api('/api/marketing/ads/accounts', { body: { ...f, label: f.label.trim() || '네이버 검색광고', brandId: f.brandId || null } }); toast.ok('확인했습니다 — 연결하고 최근 7일 성과를 불러왔습니다'); onDone(); onClose(); }
    catch (er: any) { setErr(er.message); } finally { setBusy(false); }
  }
  // 대표(10/19): 세 값을 붙여 넣으면 바로 검증(같은 값은 한 번만 시도)
  useEffect(() => {
    const key = `${f.customerId}|${f.apiKey}|${f.secretKey}`;
    if (busy || !/^\d{4,}$/.test(f.customerId) || f.apiKey.length < 10 || f.secretKey.length < 10 || tried.current === key) return;
    const t = setTimeout(() => save(), 500);
    return () => clearTimeout(t);
  }, [f.customerId, f.apiKey, f.secretKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal open onClose={onClose} title="네이버 검색광고 연결">
      <form onSubmit={save} className="grid gap-3 text-sm" data-testid="naver-form">
        <ol className="grid gap-2 text-xs sm:grid-cols-3" data-testid="naver-steps">
          <li className="space-y-1"><b>1. 광고 관리 화면 열기</b><Shot step={1}><span className="font-semibold text-[#03C75A]">NAVER</span> 검색광고 · 로그인 후 오른쪽 위 <b>도구</b></Shot></li>
          <li className="space-y-1"><b>2. API 사용 관리</b><Shot step={2}>도구 ▾ › <b className="text-ink">API 사용 관리</b> › [네이버 검색광고 API 서비스 신청]</Shot></li>
          <li className="space-y-1"><b>3. 세 값 복사</b><Shot step={3}>CUSTOMER_ID · 액세스 라이선스 · 비밀키(보기) → 아래 칸에 붙여 넣기</Shot></li>
        </ol>
        <a href={NAVER_API_PAGE} target="_blank" rel="noopener" className="inline-flex h-9 items-center justify-center rounded-input border border-[#03C75A] px-3 text-sm font-medium text-[#03892f] hover:bg-emerald-50" data-testid="naver-open-api">네이버 광고 API 페이지 열기 ↗</a>
        <Field label="CUSTOMER_ID"><input className={inputCls} value={f.customerId} onChange={(e) => setF({ ...f, customerId: e.target.value.replace(/\D/g, '') })} required inputMode="numeric" data-testid="naver-cid" /></Field>
        <Field label="액세스 라이선스"><input className={inputCls} value={f.apiKey} onChange={(e) => setF({ ...f, apiKey: e.target.value.trim() })} required autoComplete="off" data-testid="naver-key" /></Field>
        <Field label="비밀키"><input type="password" className={inputCls} value={f.secretKey} onChange={(e) => setF({ ...f, secretKey: e.target.value.trim() })} required autoComplete="new-password" data-testid="naver-secret" /></Field>
        {busy && <p className="text-xs text-ink-2" role="status">네이버에 확인하는 중…</p>}
        {err && <p className="rounded-input bg-red-50 px-3 py-2 text-xs text-red-800" role="alert" data-testid="naver-error">{err}</p>}
        <details className="text-xs"><summary className="cursor-pointer text-ink-2">이름·브랜드(선택)</summary>
          <div className="mt-2 grid gap-2">
            <Field label="이름(예: 본점 검색광고)"><input className={inputCls} value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} maxLength={60} data-testid="naver-label" /></Field>
            <Field label="브랜드"><select className={inputCls} value={f.brandId} onChange={(e) => setF({ ...f, brandId: e.target.value })}><option value="">(없음)</option>{(brands.data?.brands ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
          </div></details>
        <p className="text-[11px] text-ink-3">비밀키는 암호화해 보관하고 다시 보여 주지 않습니다. 성과 <b>읽기</b>만 하며 광고를 바꾸지 않습니다.</p>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>취소</Button><Button type="submit" disabled={busy} data-testid="naver-save">{busy ? '확인 중…' : '확인 후 연결'}</Button></div>
      </form>
    </Modal>
  );
}

const connectMsg = (sp: URLSearchParams) => (sp.get('published') ? `인스타그램 ${sp.get('ig') ?? 0}개·페이스북 페이지 ${sp.get('pages') ?? 0}개를 연결했습니다${Number(sp.get('warn')) ? ' — 아래 확인할 항목을 봐 주세요' : ''}` : sp.get('connected') ? `${sp.get('connected') === 'meta' ? 'Meta' : 'Google Ads'} 광고 계정 ${sp.get('count') ?? ''}개를 연결했습니다` : sp.get('error') ? `연결 실패: ${sp.get('error')}` : null);

type Sum = { impressions: number; clicks: number; cost: number; conversions: number };
type Analysis = { month: string; summary: string; good: string[]; bad: string[]; proposals: { title: string; detail: string; expected: string }[]; source: 'ai' | 'template'; generatedAt: string; cardId?: string | null };
type MonthData = Data & { month: string; prevMonth: string; prev: Sum; byProvider: (Sum & { provider: string })[]; byBrand: (Sum & { brand: string })[]; months: string[]; analysis: Analysis | null };
const thisMonth = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date()).slice(0, 7);
const monthLabel = (m: string) => `${m.slice(0, 4)}년 ${Number(m.slice(5, 7))}월`;
/** 전월 대비 — 비용·클릭은 ±%, 0 이면 '신규'/'—' */
function Delta({ now, prev, invert }: { now: number; prev: number; invert?: boolean }) {
  if (!prev) return <span className="text-ink-3">{now ? '전월 0' : '—'}</span>;
  const r = Math.round(((now - prev) / prev) * 100); const up = r > 0; const good = invert ? !up : up;
  return <span className={cx('tabular-nums', r === 0 ? 'text-ink-3' : good ? 'text-emerald-700' : 'text-red-700')} data-testid="ads-delta">{r > 0 ? '+' : ''}{r}% <span className="text-ink-3">전월 대비</span></span>;
}
function SumTable({ rows, head, testid, label }: { rows: Sum[]; head: string; testid: string; label: (r: any) => string }) {
  return (
    <section className="overflow-x-auto rounded-card border border-line bg-white shadow-card">
      <table className="w-full min-w-[520px] text-sm" data-testid={testid}><thead className="bg-slate-50 text-xs text-ink-2"><tr><th className="p-2 text-left">{head}</th><th className="p-2 text-right">노출</th><th className="p-2 text-right">클릭(CTR)</th><th className="p-2 text-right">광고비</th><th className="p-2 text-right">CPC</th><th className="p-2 text-right">전환</th></tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={i} className="border-t border-line"><td className="p-2">{label(r)}</td><td className="p-2 text-right tabular-nums">{n0(r.impressions)}</td><td className="p-2 text-right tabular-nums">{n0(r.clicks)} <span className="text-ink-3">({pct(r.clicks, r.impressions)})</span></td>
            <td className="p-2 text-right tabular-nums">{won(r.cost)}</td><td className="p-2 text-right tabular-nums">{r.clicks ? won(r.cost / r.clicks) : '—'}</td><td className="p-2 text-right tabular-nums">{n0(r.conversions)}</td></tr>))}
          {!rows.length && <tr><td colSpan={6} className="p-4 text-center text-xs text-ink-3">이달 기록이 없습니다</td></tr>}</tbody></table>
    </section>
  );
}

/** 대표 10/21 ①: 월마다 AI 마케터(30년차) 분석 — 좋았던 점·나빴던 점·다음 달 제안 3개 → [승인 요청 카드로 보내기] */
function MonthAnalysis({ month, analysis, canEdit, onChange }: { month: string; analysis: Analysis | null; canEdit: boolean; onChange: (a: Analysis) => void }) {
  const [busy, setBusy] = useState<'' | 'run' | 'card'>('');
  async function run(force = false) { setBusy('run'); try { onChange(await api<Analysis>('/api/marketing/ads/analysis', { body: { month, force } })); } catch (e: any) { toast.error(e.message); } finally { setBusy(''); } }
  async function card() { setBusy('card'); try { const r = await api<{ id: string; created: boolean }>('/api/marketing/ads/analysis/card', { body: { month } }); toast.ok(r.created ? '승인함에 분석 카드를 보냈습니다' : '이미 승인 대기 중인 카드가 있습니다'); if (analysis) onChange({ ...analysis, cardId: r.id }); } catch (e: any) { toast.error(e.message); } finally { setBusy(''); } }
  return (
    <section className="rounded-card border border-violet-200 bg-violet-50/40 p-3 shadow-card" data-testid="ads-analysis">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold" style={{ color: C }}>AI 마케터 월 분석 · {monthLabel(month)}</h2>
        {analysis && <span className="text-[11px] text-ink-3">{analysis.source === 'ai' ? 'AI 분석' : '숫자 기준 기본 분석'} · {fmtDateTime(analysis.generatedAt)}</span>}
        <span className="ml-auto flex flex-wrap gap-1">
          {!analysis && <Button size="sm" onClick={() => run(false)} disabled={!!busy} data-testid="ads-analysis-run">{busy === 'run' ? '분석 중…' : 'AI 분석 만들기'}</Button>}
          {analysis && canEdit && <Button size="sm" variant="secondary" onClick={() => run(true)} disabled={!!busy} data-testid="ads-analysis-rerun">{busy === 'run' ? '분석 중…' : '다시 분석'}</Button>}
          {analysis && canEdit && (analysis.cardId
            ? <Link href="/s/marketing/approvals?tab=proposals" className={btnCls('secondary', 'sm')} data-testid="ads-analysis-card-link">승인함에서 보기</Link>
            : <Button size="sm" onClick={card} disabled={!!busy} data-testid="ads-analysis-card">{busy === 'card' ? '보내는 중…' : '승인 요청 카드로 보내기'}</Button>)}
        </span>
      </div>
      {!analysis ? <p className="mt-2 text-xs text-ink-2">이달 숫자(매체·브랜드·캠페인·전월 대비)를 읽고 좋았던 점·나빴던 점·다음 달 제안 3개를 씁니다. 제안은 승인 요청 카드로 보내 대표 승인 뒤 실행합니다.</p> : (
        <div className="mt-2 grid gap-3 text-sm md:grid-cols-3">
          <p className="md:col-span-3 text-ink" data-testid="ads-analysis-summary">{analysis.summary}</p>
          <div><h3 className="text-xs font-semibold text-emerald-800">좋았던 점</h3><ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs">{analysis.good.map((g, i) => <li key={i}>{g}</li>)}</ul></div>
          <div><h3 className="text-xs font-semibold text-red-800">나빴던 점</h3><ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs">{analysis.bad.map((g, i) => <li key={i}>{g}</li>)}</ul></div>
          <div><h3 className="text-xs font-semibold" style={{ color: C }}>다음 달 제안 3개</h3><ol className="mt-1 list-decimal space-y-1 pl-4 text-xs" data-testid="ads-analysis-proposals">{analysis.proposals.map((p, i) => <li key={i}><b>{p.title}</b> — {p.detail}<span className="block text-ink-3">기대: {p.expected}</span></li>)}</ol></div>
        </div>)}
    </section>
  );
}

/** V41 4-2 광고 성과(읽기 전용) — 회사별로 직접 연결한 네이버·Google·Meta 광고 계정. 대표 10/21 ①: 월별 보기 기본(전월 대비·매체/캠페인/브랜드·AI 월 분석) */
export function Ads() {
  const sp = useSearchParams();
  const [month, setMonth] = useState<string | null>(() => (sp.get('days') ? null : (/^\d{4}-\d{2}$/.test(sp.get('month') ?? '') ? sp.get('month')! : thisMonth())));
  const [days, setDays] = useState(Number(sp.get('days')) || 7);
  const query = month ? `month=${month}` : `days=${days}`;
  const { data, error, reload, setData } = useApi<MonthData>(`/api/marketing/ads?${query}`, [query]);
  const msg = connectMsg(sp);
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Skeleton rows={5} />;
  const t = data.totals; const p = data.month ? data.prev : null;
  const cards: [string, string, React.ReactNode][] = [
    ['노출', n0(t.impressions), p && <Delta now={t.impressions} prev={p.impressions} />],
    ['클릭', `${n0(t.clicks)} · ${pct(t.clicks, t.impressions)}`, p && <Delta now={t.clicks} prev={p.clicks} />],
    ['광고비', won(t.cost), p && <Delta now={t.cost} prev={p.cost} invert />],
    ['전환', `${n0(t.conversions)}${t.conversions ? ` · ${won(t.cost / t.conversions)}/건` : ''}`, p && <Delta now={t.conversions} prev={p.conversions} />]];
  const max = Math.max(1, ...data.daily.map((d) => d.cost));
  const months = data.months ?? [thisMonth()];
  return (
    <div className="space-y-4" data-testid="mkt-ads">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold" style={{ color: C }}>광고 성과</h1>
        <span className="text-xs text-ink-2">{data.month ? `${monthLabel(data.month)} · 전월(${monthLabel(data.prevMonth)}) 대비` : `최근 ${data.days}일`}</span>
        <span className="ml-auto flex flex-wrap items-center gap-1">
          <select className={cx(inputCls, 'h-8 w-auto py-0 text-xs')} value={month ?? ''} onChange={(e) => setMonth(e.target.value || null)} aria-label="월 선택" data-testid="ads-month">
            {!month && <option value="">기간 보기</option>}{months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</select>
          {[7, 30, 90].map((d) => <Button key={d} size="sm" variant={!month && days === d ? 'primary' : 'secondary'} onClick={() => { setMonth(null); setDays(d); }} data-testid={`ads-days-${d}`}>최근 {d}일</Button>)}
        </span>
      </div>
      {msg && <p className={cx('rounded-input px-3 py-2 text-sm', sp.get('error') ? 'bg-red-50 text-red-800' : 'bg-emerald-50 text-emerald-800')} role="status">{msg}</p>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{cards.map(([l, v, d]) => <div key={l} className="rounded-card border border-line bg-white p-3 shadow-card" data-testid="ads-card"><div className="text-xs text-ink-2">{l}</div><div className="mt-1 text-lg font-bold tabular-nums" style={{ color: C }}>{v}</div>{d && <div className="mt-0.5 text-[11px]">{d}</div>}</div>)}</div>
      {data.month && <MonthAnalysis month={data.month} analysis={data.analysis} canEdit={data.canEdit} onChange={(a) => setData({ ...data, analysis: a })} />}
      {data.month && (
        <div className="grid gap-3 lg:grid-cols-2">
          <SumTable rows={data.byProvider} head="매체" testid="ads-by-provider" label={(r) => <><span className="mr-1.5 inline-block size-2 rounded-full" style={{ background: P_COLOR[r.provider] }} />{data.providers.find((x) => x.key === r.provider)?.label ?? r.provider}</> as unknown as string} />
          <SumTable rows={data.byBrand} head="브랜드" testid="ads-by-brand" label={(r) => r.brand} />
        </div>)}
      {!!data.daily.length && (
        <section className="rounded-card border border-line bg-white p-3 shadow-card"><h2 className="mb-2 text-sm font-semibold">날짜별 광고비</h2>
          <div className="flex h-24 items-end gap-1">{data.daily.map((d) => <div key={d.day} className="flex-1 rounded-t" style={{ height: `${Math.max(3, (d.cost / max) * 100)}%`, background: C, opacity: 0.75 }} title={`${d.day} · ${won(d.cost)} · 클릭 ${n0(d.clicks)} · 전환 ${n0(d.conversions)}`} />)}</div>
          <div className="mt-1 flex justify-between text-[10px] text-ink-3"><span>{data.daily[0].day}</span><span>{data.daily[data.daily.length - 1].day}</span></div></section>
      )}
      <section className="overflow-x-auto rounded-card border border-line bg-white shadow-card">
        <table className="w-full min-w-[640px] text-sm" data-testid="ads-table"><thead className="bg-slate-50 text-xs text-ink-2"><tr><th className="p-2 text-left">캠페인</th><th className="p-2 text-right">노출</th><th className="p-2 text-right">클릭(CTR)</th><th className="p-2 text-right">광고비</th><th className="p-2 text-right">CPC</th><th className="p-2 text-right">전환</th></tr></thead>
          <tbody>{data.campaigns.map((c) => (
            <tr key={`${c.account_id}:${c.campaign_id}`} className="border-t border-line"><td className="p-2"><span className="mr-1.5 inline-block size-2 rounded-full" style={{ background: P_COLOR[c.provider] }} />{c.campaign_name || c.campaign_id}<span className="ml-1 text-xs text-ink-3">{c.label}{(c as any).brand ? ` · ${(c as any).brand}` : ''}</span></td>
              <td className="p-2 text-right tabular-nums">{n0(c.impressions)}</td><td className="p-2 text-right tabular-nums">{n0(c.clicks)} <span className="text-ink-3">({pct(c.clicks, c.impressions)})</span></td>
              <td className="p-2 text-right tabular-nums">{won(c.cost, c.currency)}</td><td className="p-2 text-right tabular-nums">{c.clicks ? won(c.cost / c.clicks, c.currency) : '—'}</td><td className="p-2 text-right tabular-nums">{n0(c.conversions)}</td></tr>))}
            {!data.campaigns.length && <tr><td colSpan={6} className="p-6 text-center text-ink-3">{data.accounts.length ? '이 기간 성과가 없습니다' : '광고 계정을 연결하면 매일 아침 성과가 들어옵니다'}</td></tr>}</tbody></table>
      </section>
      {/* 로컬 검수 10/19: 계정 연결은 설정 › 연결 계정으로 — 여기는 숫자만 */}
      <p className="flex flex-wrap items-center gap-2 text-xs text-ink-2" data-testid="ads-accounts-link">
        <span>연결된 광고 계정 {data.accounts.length}개{data.accounts.some((a) => a.status === 'error') && <b className="ml-1 text-red-700">· 읽기 실패 {data.accounts.filter((a) => a.status === 'error').length}개</b>}</span>
        <Link href="/s/marketing/connections" className="font-medium underline" style={{ color: C }}>계정 연결은 설정 › 연결 계정</Link>
        {data.month && <Link href={`/s/marketing/report?month=${data.month}`} className="ml-auto font-medium underline" style={{ color: C }} data-testid="ads-report-link">{monthLabel(data.month)} 월간 보고 →</Link>}
      </p>
    </div>
  );
}

/** 로컬 검수 10/19: 마케팅 설정 › 연결 계정 — 광고 계정(네이버·Google·Meta)과 게시 채널을 한 화면에 */
export function Connections() {
  const sp = useSearchParams();
  const [naver, setNaver] = useState(false);
  const [busy, setBusy] = useState(false);
  const { data, error, reload } = useApi<Data>('/api/marketing/ads?days=7');
  const msg = connectMsg(sp);
  async function sync() { setBusy(true); try { const r = await api<{ results: { error?: string }[] }>('/api/marketing/ads/sync', { body: {} }); const bad = r.results.filter((x) => x.error).length; bad ? toast.error(`${bad}개 계정을 읽지 못했습니다`) : toast.ok('최근 7일 성과를 다시 불러왔습니다'); reload(); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); } }
  async function remove(a: Acc) { if (!confirm(`${a.label} 연결을 끊을까요? 모은 성과도 함께 지워집니다.`)) return; try { await api(`/api/marketing/ads/accounts/${a.id}`, { method: 'DELETE' }); reload(); } catch (e: any) { toast.error(e.message); } }
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Skeleton rows={5} />;
  return (
    <div className="space-y-4" data-testid="mkt-connections">
      <h1 className="text-xl font-bold" style={{ color: C }}>연결 계정</h1>
      {msg && <p className={cx('rounded-input px-3 py-2 text-sm', sp.get('error') ? 'bg-red-50 text-red-800' : 'bg-emerald-50 text-emerald-800')} role="status">{msg}</p>}
      <section className="rounded-card border border-line bg-white p-3 shadow-card" data-testid="ads-accounts">
        <div className="mb-2 flex items-center gap-2"><h2 className="text-sm font-semibold">광고 계정(성과 읽기)</h2>{data.canEdit && !!data.accounts.length && <Button size="sm" variant="secondary" className="ml-auto" onClick={sync} disabled={busy} data-testid="ads-sync">{busy ? '불러오는 중…' : '다시 불러오기'}</Button>}</div>
        <ul className="divide-y divide-line text-sm">{data.accounts.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-2 py-2" data-testid="ads-account"><span className="size-2 rounded-full" style={{ background: P_COLOR[a.provider] }} /><span className="font-medium">{a.label}</span>
            <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-medium', a.status === 'error' ? 'bg-red-50 text-red-800' : 'bg-emerald-50 text-emerald-800')}>{a.status === 'error' ? '읽기 실패' : '연결됨'}</span>
            <span className="text-xs text-ink-2">{data.providers.find((p) => p.key === a.provider)?.label} · {a.external_id}{a.brand ? ` · ${a.brand}` : ''} · {a.last_sync_at ? `읽은 시각 ${fmtDateTime(a.last_sync_at)}` : '아직 안 읽음'}</span>
            {a.status === 'error' && <span className="w-full break-words text-xs text-red-700" data-testid="ads-account-error">{a.last_error}</span>}
            {data.canEdit && <Button size="sm" variant="secondary" className="ml-auto" onClick={() => remove(a)}>끊기</Button>}</li>))}
          {!data.accounts.length && <li className="py-2 text-xs text-ink-3">연결된 광고 계정이 없습니다</li>}</ul>
        {data.canEdit ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setNaver(true)} data-testid="ads-add-naver">네이버 검색광고 연결</Button>
            {data.providers.filter((p) => p.key !== 'naver').map((p) => p.ready
              ? <a key={p.key} href={`/api/marketing/ads/connect/${p.key}`} className={btnCls('primary', 'sm')} data-testid={`ads-add-${p.key}`}>{p.label} 연결</a>
              : <PendingButton key={p.key} label={`${p.label} 연결`} reason="심사 후 열림" />)}
          </div>
        ) : <p className="mt-2 text-xs text-ink-3">광고 계정 연결은 관리자가 합니다.</p>}
        <p className="mt-2 text-[11px] text-ink-3">성과는 각 광고 플랫폼에서 하루 한 번 읽기만 합니다(최근 7일을 다시 읽어 늦게 잡힌 전환까지 반영). 예산·입찰은 바꾸지 않습니다.</p>
      </section>
      <PublishChannels />
      {data.callbacks && (
        <details className="rounded-card border border-line bg-white p-3 text-xs text-ink-2 shadow-card" data-testid="ads-callbacks"><summary className="cursor-pointer font-medium">관리자: Google·Meta 콘솔에 등록할 콜백 주소</summary>
          <ul className="mt-1 space-y-0.5">{(['google', 'meta'] as const).map((k) => <li key={k}><span className="inline-block w-14">{k === 'google' ? 'Google' : 'Meta'}</span><code className="select-all break-all rounded bg-slate-100 px-1">{data.callbacks![k]}</code></li>)}</ul>
          <p className="mt-1 text-[11px] text-ink-3">운영 주소(APP_URL)를 바꾸면 이 주소도 바뀌니 콘솔에도 다시 등록해야 합니다.</p></details>
      )}
      {naver && <NaverForm onClose={() => setNaver(false)} onDone={reload} />}
    </div>
  );
}

type Ch = { key: string; label: string; note: string; kind: string; enabled: boolean; connectable: boolean; ready: boolean; mode: 'helper' | 'auto' | 'later';
  accounts: { id: string; provider: string; label: string; status: string; lastError: string | null; warnings: string[]; brandId: string | null; brand: string | null; shared: boolean }[] };
type ChData = { canEdit: boolean; metaDevMode: boolean; channels: Ch[]; tech: { metaCallback: string; metaDeletion: string; metaScopes: string[]; metaReady: boolean; metaLive: boolean } | null };
const CONNECT_URL: Record<string, string> = { meta: '/api/marketing/publish/connect/meta', threads: '/api/marketing/publish/connect/threads', google: '/api/marketing/publish/connect/youtube' };

/**
 * ⑤-2 게시 채널(대표 결정 10/19: 모든 채널 직접 연동, 구독형 미사용). 채널마다 켜기/끄기 + [연결] 하나.
 * 심사 통과 전에는 연결해도 '게시 도우미'로 운영(사람이 올리고 [게시 확인]). 기술 단계는 플랫폼 관리자에게만.
 */
function PublishChannels() {
  const { data: raw, error, reload } = useApi<ChData>('/api/marketing/publish/channels');
  const brands = useApi<{ brands: { id: string; name: string }[] }>('/api/marketing/brands');
  const [over, setOver] = useState<Record<string, boolean>>({}); // 켜기/끄기는 바로 반영(실패하면 되돌림)
  // 로컬 10/21 08:10: 계정마다 브랜드(또는 공용) — 게시 대상은 브랜드 계정 + 공용 계정만, 미지정 계정은 제외
  async function setBrand(id: string, v: string) {
    try { await api(`/api/marketing/publish/accounts/${id}`, { method: 'PATCH', body: v === 'shared' ? { shared: true, brandId: null } : { shared: false, brandId: v || null } }); toast.ok(v === 'shared' ? '공용 계정으로 표시했습니다' : v ? '브랜드를 지정했습니다' : '미지정으로 바꿨습니다 — 게시 대상에서 빠집니다'); reload(); }
    catch (e: any) { toast.error(e.message); }
  }
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!raw) return <Skeleton rows={4} />;
  const data = { ...raw, channels: raw.channels.map((c) => (c.key in over ? { ...c, enabled: over[c.key] } : c)) };
  async function toggle(c: Ch) {
    const next = !c.enabled; setOver((o) => ({ ...o, [c.key]: next }));
    try { await api('/api/marketing/publish/channels', { method: 'PUT', body: { channel: c.key, enabled: next } }); }
    catch (e: any) { setOver((o) => ({ ...o, [c.key]: !next })); toast.error(e.message); }
  }
  async function remove(id: string, label: string) { if (!confirm(`${label} 연결을 끊을까요? 저장된 권한(토큰)을 바로 지웁니다.`)) return; try { await api(`/api/marketing/publish/accounts/${id}`, { method: 'DELETE' }); reload(); } catch (e: any) { toast.error(e.message); } }
  const metaNone = !data.channels.some((c) => c.kind === 'meta' && c.accounts.length);
  return (
    <section className="rounded-card border border-line bg-white p-3 shadow-card" data-testid="publish-channels">
      <h2 className="text-sm font-semibold">게시 채널</h2>
      <p className="mt-0.5 text-[11px] text-ink-3">쓰는 채널만 켜 두세요. 연결한 채널은 승인된 글을 <b>워크인 서버가 게시</b>합니다(콘텐츠 상세 [지금 게시] 또는 자동 제작 설정 “자동 게시”). 연결 전에는 <b>게시 도우미</b>(글 복사·사진 내려받기·앱 열기 → 올린 뒤 주소 붙여 [게시 확인])로 올립니다. 연결해 두면 플랫폼 심사가 끝나는 대로 워크인에서 바로 게시됩니다.</p>
      <ul className="mt-2 divide-y divide-line text-sm">{data.channels.map((c) => (
        <li key={c.key} className={cx('py-2', !c.enabled && 'opacity-60')} data-testid="publish-channel" data-channel={c.key}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{c.label}</span>
            <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-medium', !c.enabled ? 'bg-slate-100 text-ink-3' : c.mode === 'auto' ? 'bg-violet-50 text-violet-800' : c.mode === 'later' ? 'bg-slate-100 text-ink-2' : 'bg-emerald-50 text-emerald-800')} data-testid="publish-channel-mode">
              {!c.enabled ? '꺼짐' : c.mode === 'auto' ? '자동 게시' : c.mode === 'later' ? '준비 중' : '게시 도우미'}</span>
            {c.accounts.length > 0 && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800">연결됨 {c.accounts.length}</span>}
            <span className="ml-auto flex items-center gap-2">
              {data.canEdit && c.enabled && c.connectable && (c.ready && CONNECT_URL[c.kind]
                ? <a href={CONNECT_URL[c.kind]} className={btnCls(c.accounts.length ? 'secondary' : 'primary', 'sm')} data-testid={`publish-connect-${c.key}`}>{c.accounts.length ? '다시 연결' : '연결'}</a>
                : <PendingButton label="연결" reason={c.kind === 'meta' ? '심사 후 열림 — 그동안 게시 도우미' : c.kind === 'threads' ? 'Threads 앱 등록·심사 뒤 열림 — 그동안 게시 도우미' : c.kind === 'google' ? 'Google 동의 화면 검증 뒤 열림 — 그동안 게시 도우미' : '준비 중 — 그동안 게시 도우미'} testId={`publish-connect-${c.key}`} />)}
              {data.canEdit && <label className={cx('inline-flex min-h-[32px] cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium', c.enabled ? 'border-brand-200 bg-brand-50 text-brand-700' : 'border-line bg-white text-ink-3')}>
                <input type="checkbox" className="size-4 accent-brand-600" checked={c.enabled} onChange={() => toggle(c)} aria-label={`${c.label} 사용`} data-testid="publish-channel-toggle" />{c.enabled ? '사용 중' : '사용 안 함'}</label>}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-ink-3">{c.note}</p>
          {c.accounts.map((a) => (
            <div key={a.id} className="mt-1 rounded-input bg-slate-50 px-2 py-1 text-xs" data-testid="publish-account">
              <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{a.label}</span>{a.status === 'error' && <span className="text-red-700">{a.lastError}</span>}
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800">연결됨</span>
                {data.canEdit ? <label className="inline-flex items-center gap-1 text-[11px] text-ink-2">브랜드
                  <select className={cx(inputCls, 'h-7 w-auto py-0 text-[11px]', !a.shared && !a.brandId && 'border-amber-400 bg-amber-50')} value={a.shared ? 'shared' : (a.brandId ?? '')} onChange={(e) => setBrand(a.id, e.target.value)} aria-label={`${a.label} 브랜드`} data-testid="publish-account-brand">
                    <option value="">미지정(게시 안 함)</option><option value="shared">공용(모든 브랜드)</option>{(brands.data?.brands ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
                  : <span className="text-[11px] text-ink-3">{a.shared ? '공용' : a.brand ?? '브랜드 미지정'}</span>}
                {!a.shared && !a.brandId && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800" data-testid="publish-account-unassigned">브랜드를 지정하세요 — 지정 전엔 게시 대상에서 제외</span>}
                {data.canEdit && <Button size="sm" variant="secondary" className="ml-auto" onClick={() => remove(a.id, a.label)}>끊기</Button>}</div>
              {a.warnings.map((w, k) => <p key={k} className="mt-0.5 text-amber-800" data-testid="publish-warning">확인 필요: {w}</p>)}
            </div>))}
        </li>))}</ul>
      {data.canEdit && data.metaDevMode && <p className="mt-2 rounded-input bg-amber-50 px-3 py-2 text-xs text-amber-900" data-testid="meta-dev-mode">개발 모드: 워크인 Meta 앱의 앱 역할(개발자·테스터)에 등록된 Facebook 계정만 인스타그램·페이스북을 연결할 수 있습니다. 심사를 마치면 모든 계정이 연결됩니다.</p>}
      {data.canEdit && metaNone && (
        <details className="mt-2 rounded-input border border-line p-2 text-xs text-ink-2" data-testid="meta-precheck"><summary className="cursor-pointer font-medium text-ink">인스타그램·페이스북 연결 전 확인할 것 3가지</summary>
          <ol className="mt-1 list-decimal space-y-0.5 pl-4">
            <li>인스타그램이 <b>비즈니스</b> 또는 <b>크리에이터</b> 계정 — 인스타 앱 › 설정 › 계정 유형 및 도구</li>
            <li>인스타그램이 <b>페이스북 페이지와 연결</b>됨 — 페이지 설정 › 연결된 계정 › Instagram</li>
            <li>연결하는 사람이 그 페이지의 <b>관리자</b>(전체 권한)</li>
          </ol>
          <p className="mt-1 text-ink-3">연결한 뒤 안 된 항목이 있으면 그 항목만 이곳에 안내합니다.</p></details>
      )}
      {data.tech && (
        <details className="mt-2 rounded-input bg-slate-50 p-2 text-[11px] text-ink-2" data-testid="publish-tech"><summary className="cursor-pointer font-medium">플랫폼 관리자: Meta 앱 설정 값</summary>
          <ul className="mt-1 space-y-0.5">
            <li>상태: 앱 ID {data.tech.metaReady ? '있음' : '없음(META_APP_ID/SECRET 넣으면 [연결] 열림)'} · 자동 게시 {data.tech.metaLive ? '켜짐' : '꺼짐(앱 심사 통과 후 META_PUBLISH_LIVE=1)'}</li>
            <li>OAuth 리디렉션 URI <code className="select-all break-all rounded bg-white px-1">{data.tech.metaCallback}</code></li>
            <li>데이터 삭제 콜백 <code className="select-all break-all rounded bg-white px-1">{data.tech.metaDeletion}</code></li>
            <li>권한 {data.tech.metaScopes.join(', ')}</li>
          </ul></details>
      )}
    </section>
  );
}
