'use client';
// 226차 #497 R21-4(21라인 레퍼런스 '낙찰 결과·낙찰가·경쟁업체 분석'): 영업기회 › 입찰 [낙찰 분석] — 관련 공고의 낙찰 업체별 건수·금액·낙찰률·참가 수·지역 · 우리 회사 표시
import Link from 'next/link';
import { useState } from 'react';
import { ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import { useApi } from '@/components/client';
import { useUrlState } from '@/components/urlState';
import { ErrorBox, Skeleton, cx } from '@/components/ui';

type Rec = { id: string; title: string; date: string | null; amount: number | null; rate: number | null; bidders: number | null; region: string | null; issuer: string | null; url: string | null };
type Co = { key: string; rank: number; name: string; ours: boolean; wins: number; amount: number | null; rate: number | null; bidders: number | null; regions: string[]; last: string | null; recent: Rec[] };
type Stats = { days: number; total: number; awarded: number; failed: number; companies: number; ours: number; top5Share: number; items: Co[] };
const C = '#2563EB'; // 영업 색(SalesSrc 와 같음)
const DAYS: [string, string][] = [['30', '30일'], ['90', '90일'], ['180', '180일'], ['365', '1년']];
const won = (n: number | null) => (n == null ? null : n >= 1e8 ? `${(n / 1e8).toFixed(1).replace(/\.0$/, '')}억` : n >= 1e4 ? `${Math.round(n / 1e4).toLocaleString('ko-KR')}만원` : `${n.toLocaleString('ko-KR')}원`);
const md = (d: string | null) => (d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : null);

export function AwardStats({ onOpen }: { onOpen: (id: string) => void }) {
  const [daysQ, setDays] = useUrlState('ad', '90'); const days = DAYS.some(([k]) => k === daysQ) ? daysQ : '90';
  const { data, error, reload } = useApi<Stats>(`/api/sales/award-stats?days=${days}`, [days]);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const max = Math.max(1, ...(data?.items ?? []).map((x) => x.wins));
  return (
    <div className="space-y-2" data-testid="award-stats">
      <div className="flex flex-wrap items-center gap-1.5"><b className="text-sm">낙찰 분석 — 관련 공고를 누가 따 가나</b>
        <span className="ml-auto flex gap-1">{DAYS.map(([k, l]) => <button key={k} type="button" onClick={() => setDays(k)} data-testid={`award-days-${k}`}
          className={cx('rounded-full border px-2.5 py-0.5 text-xs', days === k ? 'border-transparent font-semibold text-white' : 'border-line bg-white text-ink-2')} style={days === k ? { background: C } : undefined}>{l}</button>)}</span></div>
      {error ? <ErrorBox error={error} retry={reload} /> : !data ? <Skeleton rows={5} /> : <>
        <p className="text-xs text-ink-2" data-testid="award-summary">관련 결과 <b>{data.total}</b>건 · 낙찰 {data.awarded} · 유찰 {data.failed} · 낙찰 업체 {data.companies}곳{data.awarded ? ` · 상위 5곳이 낙찰의 ${data.top5Share}%` : ''} · 우리 회사 낙찰 <b>{data.ours}</b>건</p>
        {!data.items.length ? <p className="rounded-card border border-dashed border-line bg-white p-4 text-center text-sm text-ink-3" data-testid="award-empty">이 기간 관련 공고의 낙찰 결과가 없습니다. 낙찰 결과는 수집기(K-apt 입찰결과·나라장터 낙찰정보 등)가 모읍니다 — <Link href="/s/sales/sources#collectors" className="underline">데이터 설정 › 수집기</Link></p>
          : <ol className="space-y-1.5">{data.items.map((x) => { const on = openKey === x.key; return (
            <li key={x.key} className={cx('rounded-card border bg-white text-sm', x.ours ? 'border-blue-300 bg-blue-50/40' : 'border-line')} data-testid="award-row" data-ours={x.ours || undefined}>
              <button type="button" onClick={() => setOpenKey(on ? null : x.key)} className="block w-full px-3 py-2 text-left" aria-expanded={on}>
                <span className="flex min-w-0 items-center gap-2"><span className="w-5 shrink-0 text-right text-xs text-ink-3">{x.rank}</span>
                  <b className="min-w-0 truncate">{x.name}</b>{x.ours && <span className="shrink-0 rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-semibold text-white" data-testid="award-ours">우리 회사</span>}
                  <span className="ml-auto shrink-0 text-xs font-semibold" style={{ color: C }}>낙찰 {x.wins}건</span>{on ? <ChevronUp className="size-4 shrink-0 text-ink-3" aria-hidden /> : <ChevronDown className="size-4 shrink-0 text-ink-3" aria-hidden />}</span>
                <span className="mt-1 ml-7 block h-1 rounded-full bg-slate-100" aria-hidden><span className="block h-full rounded-full" style={{ width: `${Math.round((x.wins / max) * 100)}%`, background: C }} /></span>
                <span className="mt-1 ml-7 block text-xs text-ink-2" data-testid="award-row-meta">{[won(x.amount) && `낙찰금액 합 ${won(x.amount)}`, x.rate != null && `평균 낙찰률 ${x.rate}%`, x.bidders != null && `평균 참가 ${x.bidders}곳`, x.regions.length ? x.regions.join('·') : null, md(x.last) && `최근 ${md(x.last)}`].filter(Boolean).join(' · ') || '금액·낙찰률 정보 없음'}</span>
              </button>
              {on && <ul className="space-y-1 border-t border-line px-3 py-2 pl-10 text-xs" data-testid="award-recent">{x.recent.map((r) => (
                <li key={r.id} className="flex min-w-0 items-start gap-1.5"><button type="button" onClick={() => onOpen(r.id)} className="min-w-0 flex-1 text-left hover:underline" data-testid="award-recent-open">
                  <span className="text-ink-3">{md(r.date) ?? '날짜 없음'}{r.region ? ` · ${r.region}` : ''}</span> {r.title}<span className="text-ink-2">{[won(r.amount), r.rate != null && `${r.rate}%`, r.bidders != null && `참가 ${r.bidders}곳`].filter(Boolean).map((v) => ` · ${v}`).join('')}</span></button>
                  {r.url && <a href={r.url} target="_blank" rel="noopener noreferrer" className="shrink-0 text-ink-3 hover:text-ink" aria-label="원문 보기"><ExternalLink className="size-3.5" /></a>}</li>))}
                {x.wins > x.recent.length && <li className="text-ink-3">그 밖 {x.wins - x.recent.length}건</li>}</ul>}
            </li>); })}</ol>}
        <p className="text-[11px] text-ink-3">맞춤 조건(관심 검색어·제외어·지역 등)에 맞는 공고의 결과만 셉니다 · 업체는 법인 표시(㈜·주식회사 등)를 빼고 같은 이름끼리 묶습니다 · 낙찰률·참가 수·금액은 원천에 있을 때만</p>
      </>}
    </div>
  );
}
