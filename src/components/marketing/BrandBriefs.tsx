'use client';
import Link from 'next/link';
import { useApi } from '@/components/client';
import { ErrorBox, Skeleton, cx } from '@/components/ui';

const C = '#7C3AED';
const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`;
const n0 = (n: number) => Math.round(n).toLocaleString('ko-KR');
type Kw = { keyword: string; campaign: string; impressions: number; clicks: number; cost: number; leads: number; why?: string };
type Brief = { brandId: string | null; name: string; color: string | null; cost: number; plan: number | null; planPct: number | null; impressions: number; clicks: number; ctr: number | null; cpc: number | null;
  leads: number; calls: number; balance: { krw: number; days: number | null; level: 'ok' | 'warn' | 'action' } | null; good: Kw[]; waste: Kw[]; todos: string[] };
type Data = { month: string; day: string; elapsedPct: number; tracked: boolean; judge: boolean; coverage: number | null; brands: Brief[]; unbranded: Brief | null };
const until = (day: string) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}까지`;

function Num({ label, value, sub, warn }: { label: string; value: string; sub: string; warn?: boolean }) {
  return (
    <div className="rounded-input bg-slate-50 p-2" data-testid="brief-num">
      <dt className="text-[11px] text-ink-2">{label}</dt>
      <dd className={cx('text-lg font-bold tabular-nums leading-tight', warn ? 'text-red-700' : 'text-ink')}>{value}</dd>
      <dd className="text-[11px] leading-snug text-ink-3">{sub}</dd>
    </div>
  );
}

function Card({ b, d }: { b: Brief; d: Data }) {
  const fast = b.planPct !== null && b.planPct - d.elapsedPct >= 15;
  return (
    <article className="rounded-card border border-line bg-white p-3 shadow-card" data-testid="brief-card" data-brand={b.name}>
      <header className="flex flex-wrap items-center gap-2">
        <span className="size-2.5 shrink-0 rounded-full" style={{ background: b.color ?? '#94A3B8' }} aria-hidden />
        <h3 className="text-sm font-bold">{b.name}</h3>
        {b.brandId && <Link href={`/s/marketing/ads?brand=${b.brandId}`} className="ml-auto text-xs font-medium" style={{ color: C }} data-testid="brief-more">성과 자세히 →</Link>}
      </header>
      <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Num label="광고비" value={won(b.cost)} sub={b.plan ? `계획 ${won(b.plan)}의 ${b.planPct}%` : '이번 달 계획 없음'} warn={fast} />
        <Num label="클릭" value={n0(b.clicks)} sub={b.ctr !== null ? `클릭률 ${b.ctr}%${b.cpc !== null ? ` · 1번에 ${won(b.cpc)}` : ''}` : '노출 없음'} />
        <Num label="문의·신청" value={`${n0(b.leads)}건`} sub={`전화 기록 ${n0(b.calls)}건`} warn={b.cost > 0 && b.leads === 0 && d.tracked} />
        <Num label="광고 잔액" value={b.balance ? won(b.balance.krw) : '—'} sub={b.balance ? (b.balance.days !== null ? `지금 속도로 약 ${b.balance.days}일분` : '최근 지출 없음') : '잔액 기록 없음'} warn={b.balance?.level === 'action'} />
      </dl>
      {b.plan !== null && b.planPct !== null && (
        <div className="mt-2" data-testid="brief-plan">
          <div className="relative h-2 rounded-full bg-slate-100">
            <div className={cx('h-2 rounded-full', b.planPct >= 100 ? 'bg-red-500' : fast ? 'bg-amber-500' : 'bg-emerald-500')} style={{ width: `${Math.min(100, b.planPct)}%` }} />
            <span className="absolute -top-0.5 h-3 w-0.5 bg-slate-700" style={{ left: `${Math.min(100, d.elapsedPct)}%` }} aria-hidden />
          </div>
          <p className="mt-0.5 text-[11px] text-ink-3">계획의 {b.planPct}% 사용 · 세로 줄 = 이번 달 {d.elapsedPct}% 지남</p>
        </div>)}
      {(b.good.length > 0 || b.waste.length > 0) && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div data-testid="brief-good">
            <h4 className="text-xs font-semibold text-emerald-800">{d.judge ? '잘 되는 검색어' : '클릭 많은 검색어'}</h4>
            {b.good.length ? <ol className="mt-1 space-y-1 text-xs">{b.good.map((k, i) => (
              <li key={`${k.keyword}:${i}`} className="flex items-baseline gap-2"><span className="min-w-0 flex-1 truncate font-medium" title={k.campaign}>{i + 1}. {k.keyword}</span>
                <span className="shrink-0 tabular-nums text-ink-2">{k.leads > 0 ? `문의 ${k.leads} · ` : ''}클릭 {n0(k.clicks)} · {won(k.cost)}</span></li>))}</ol>
              : <p className="mt-1 text-xs text-ink-3">{d.judge ? '문의가 확인된 검색어가 아직 없습니다' : '클릭이 난 검색어가 아직 없습니다'}</p>}
          </div>
          <div data-testid="brief-waste">
            <h4 className="text-xs font-semibold text-red-800">{d.judge ? '돈만 쓰는 검색어' : '노출만 되고 클릭 없는 검색어'}</h4>
            {b.waste.length ? <ol className="mt-1 space-y-1 text-xs">{b.waste.map((k, i) => (
              <li key={`${k.keyword}:${i}`} className="flex items-baseline gap-2"><span className="min-w-0 flex-1 truncate font-medium" title={k.campaign}>{i + 1}. {k.keyword}</span>
                <span className="shrink-0 tabular-nums text-ink-2">{k.why}</span></li>))}</ol>
              : <p className="mt-1 text-xs text-ink-3">없음</p>}
          </div>
        </div>)}
      {b.todos.length > 0 && (
        <div className="mt-3 rounded-input bg-amber-50 p-2" data-testid="brief-todos">
          <h4 className="text-xs font-semibold text-amber-900">할 일</h4>
          <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-xs text-amber-900">{b.todos.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>)}
    </article>
  );
}

/**
 * 399차 #1025(대표 11/13 "워크인에서 보기가 어렵네요. 한눈에 보기 쉽게"): 사업(브랜드)별 한 장 요약.
 * 숫자 먼저(광고비·클릭·문의·잔액) → 잘 되는 검색어 3 · 돈만 쓰는 검색어 3 → 할 일 3. compact = 마케팅 홈용 한 줄 요약.
 */
export function BrandBriefs({ compact, only }: { compact?: boolean; only?: string }) {
  const { data, error, reload } = useApi<Data>('/api/marketing/ad-ops/brief');
  if (error) return compact ? null : <ErrorBox error={error} retry={reload} />;
  if (!data) return <Skeleton rows={compact ? 2 : 4} />;
  const rows = [...data.brands, ...(data.unbranded ? [data.unbranded] : [])];
  if (only) { // 광고 성과에서 사업을 골랐을 때: 그 사업 카드 한 장만
    const b = data.brands.find((x) => x.brandId === only);
    return b ? <section data-testid="brand-brief-one"><p className="mb-1 text-xs text-ink-3">이번 달 {until(data.day)} 요약</p><Card b={b} d={data} /></section> : null;
  }
  if (compact) {
    const live = rows.filter((b) => b.cost > 0);
    if (!live.length) return null; // 이번 달 광고 집행이 없는 회사(광고를 안 쓰는 회사 포함)는 홈에 빈 카드를 두지 않음
    return (
      <section className="rounded-card border border-line bg-white p-4 shadow-card" data-testid="mkt-home-brief">
        <h2 className="flex flex-wrap items-baseline justify-between gap-2 text-base font-bold"><span>사업별 광고 요약 <span className="text-sm font-normal text-ink-3">이번 달 {until(data.day)}</span></span>
          <Link href="/s/marketing/ad-ops" className="text-xs font-medium" style={{ color: C }}>광고 집행 →</Link></h2>
        <ul className="mt-1 divide-y divide-line">{live.map((b) => (
          <li key={b.brandId ?? 'none'} className="py-1.5" data-testid="mkt-home-brief-row" data-brand={b.name}>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm">
              {b.brandId ? <Link href={`/s/marketing/ads?brand=${b.brandId}`} className="inline-flex items-center gap-1.5 font-semibold hover:underline" data-testid="mkt-home-brief-link"><span className="size-2 rounded-full" style={{ background: b.color ?? '#94A3B8' }} aria-hidden />{b.name}</Link>
                : <span className="inline-flex items-center gap-1.5 font-semibold"><span className="size-2 rounded-full" style={{ background: '#94A3B8' }} aria-hidden />{b.name}</span>}
              <span className="tabular-nums">광고비 <b>{won(b.cost)}</b>{b.planPct !== null ? <span className="text-ink-3"> (계획의 {b.planPct}%)</span> : null}</span>
              <span className="tabular-nums text-ink-2">클릭 {n0(b.clicks)}</span>
              <span className={cx('tabular-nums', b.leads === 0 && data.tracked ? 'text-red-700' : 'text-ink-2')}>문의 {n0(b.leads)}건</span>
              {b.balance && b.balance.level !== 'ok' && b.balance.days !== null && <span className="rounded-full bg-red-50 px-1.5 text-[11px] font-medium text-red-800">잔액 약 {b.balance.days}일분</span>}
            </div>
            {b.todos[0] && <p className="mt-0.5 text-xs text-amber-900">할 일 · {b.todos[0]}</p>}
          </li>))}</ul>
      </section>
    );
  }
  return (
    <section className="space-y-2" data-testid="brand-briefs">
      <div className="flex flex-wrap items-baseline gap-2"><h2 className="text-sm font-semibold">사업별 한 장 요약</h2>
        <span className="text-xs text-ink-3">이번 달 {until(data.day)}{data.coverage !== null ? ` · 문의 추적 ${data.coverage}%` : ''}</span></div>
      {!data.tracked && rows.some((b) => b.cost > 0) && <p className="rounded-input bg-amber-50 p-2 text-xs text-amber-900" data-testid="brief-untracked">문의 추적이 꺼져 있어 문의·신청 수가 0으로 보일 수 있습니다.</p>}
      {rows.length ? <div className="grid gap-3 lg:grid-cols-2">{rows.map((b) => <Card key={b.brandId ?? 'none'} b={b} d={data} />)}</div>
        : <p className="rounded-card border border-dashed border-line p-3 text-center text-xs text-ink-2">브랜드가 없습니다 — 자동 제작에서 브랜드를 먼저 만들어 주세요.</p>}
    </section>
  );
}
