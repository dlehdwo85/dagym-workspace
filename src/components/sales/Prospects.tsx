'use client';
import { dtf } from '@/lib/dtf';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, useApi } from '@/components/client';
import { useUrlState } from '@/components/urlState';
import { ErrorBox, Skeleton, cx, inputCls, toast } from '@/components/ui';

const ST = { new: '새로', contacting: '연락 중', lead: '리드로', skip: '제외' } as const;
type P = { id: number; name: string; address: string | null; sido: string | null; biz_status: string | null; opened_on: string | null; closed_on: string | null; category: string | null; base_date: string; detail?: { households?: number | null; developer?: string | null; builder?: string | null; moveIn?: string | null; receipt?: string | null; announce?: string | null; contract?: string | null; inquiry?: string | null; url?: string | null } | null;
  source_code: string; source_name: string; attribution: string; status: keyof typeof ST; memo: string | null };

/** V41 단계 3 영업기회(공공데이터): 회사가 켠 원천의 새로 연 곳·영업 중·폐업 — 카드마다 출처·데이터 기준일, 진행 상태·메모는 회사별 */
/** 186차(로컬 10/26 19:20 B2): 입주 예정월(YYYY-MM-01)까지 남은 달 — 서울 기준 이번 달과 비교 */
function moveInLabel(moveIn: string) {
  const [y, m] = dtf('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' }).format(new Date()).split('-').map(Number);
  const diff = (Number(moveIn.slice(0, 4)) * 12 + Number(moveIn.slice(5, 7))) - (y * 12 + m);
  return diff > 0 ? `입주까지 ${diff}개월` : diff === 0 ? '이번 달 입주' : `입주 ${-diff}개월 지남`;
}

const thisYear = () => Number(dtf('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric' }).format(new Date()));
/** 242차 #759: 입주 고르기 이름 — window · YYYY · YYYY-YYYY · YYYY-MM */
function miLabel(mi: string) {
  if (mi === 'window') return '입주 시기(6개월 전~12개월 뒤)';
  if (/^\d{4}$/.test(mi)) return `${mi}년 입주`;
  if (/^\d{4}-\d{4}$/.test(mi)) return `${mi.slice(0, 4)}~${mi.slice(5)}년 입주`;
  return `${mi.slice(0, 4)}년 ${Number(mi.slice(5, 7))}월 입주`;
}
type MoveInfo = { from: string; to: string; months: { ym: string; n: number }[] };
type Kapt = { id: string; name: string; date?: string | null; completion?: string | null; moveIn?: string | null; households?: number | string | null; address?: string | null; region?: string | null };

export function Prospects() {
  const [status, setStatus] = useState('');
  const [q, setQ] = useState(''); const [query, setQuery] = useState('');
  // 242차 #759(대표 10/28 '26년도 입주 아파트 리스트'): 입주 고르기(?mi=) · 아파트만(기본 켬, ?mapt=0 끔) · 세대수 이상(?mhh=) — 주소에 남음
  const [mi, setMi] = useUrlState('mi', ''); const [aptQ, setApt] = useUrlState('mapt', ''); const [hh, setHh] = useUrlState('mhh', '');
  const move = !!mi; const apt = move && aptQ !== '0';
  const y = thisYear(); const year = /^\d{4}/.test(mi) ? mi.slice(0, 4) : '';
  const qs = `status=${status}&q=${encodeURIComponent(query)}${move ? `&moveIn=${mi}${apt ? '&apt=1' : ''}${Number(hh) > 0 ? `&minHh=${hh}` : ''}` : ''}`;
  const { data, error, reload } = useApi<{ prospects: P[]; total: number; moveIn?: MoveInfo }>(`/api/sales/prospects?${qs}`, [qs]);
  const [more, setMore] = useState<P[]>([]); const [busy, setBusy] = useState(false);
  useEffect(() => setMore([]), [qs, data]);
  const list = [...(data?.prospects ?? []), ...more];
  async function loadMore() {
    setBusy(true);
    try { const r = await api<{ prospects: P[] }>(`/api/sales/prospects?${qs}&offset=${list.length}&limit=100`); setMore((m) => [...m, ...r.prospects]); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  // 같은 해·달의 K-apt 준공·입주(사용승인) 단지 · 신규 단지 — 영업기회 허브 목록(회사 거르기·진행 상태 그대로)
  const my = /^\d{4}(-\d{2})?$/.test(mi) && !/^\d{4}-\d{4}$/.test(mi) ? mi : '';
  const fac = useApi<{ items: Kapt[]; total?: number }>(my ? `/api/sales/src?view=hub&tab=facilities&my=${my}&sort=moveIn${Number(hh) > 0 ? `&hh=${hh}` : ''}${query ? `&q=${encodeURIComponent(query)}` : ''}` : null, [my, hh, query]);
  const bld = useApi<{ items: Kapt[]; total?: number }>(my ? `/api/sales/src?view=hub&tab=buildings&my=${my}&sort=moveIn${Number(hh) > 0 ? `&hh=${hh}` : ''}${query ? `&q=${encodeURIComponent(query)}` : ''}` : null, [my, hh, query]);
  async function set(p: P, body: { status?: string; memo?: string }) {
    try { await api(`/api/sales/prospects/${p.id}`, { method: 'PATCH', body }); reload(); } catch (e: any) { toast.error(e.message); }
  }
  const chip = (on: boolean) => cx('rounded-full border px-2.5 py-1 text-xs', on ? 'border-[#2563EB] bg-[#EFF6FF] font-semibold text-[#2563EB]' : 'border-line bg-white text-ink-2');
  const kapt = [...(bld.data?.items ?? []).map((x) => ({ ...x, tab: 'buildings' as const })), ...(fac.data?.items ?? []).map((x) => ({ ...x, tab: 'facilities' as const }))];
  const kaptTotal = (bld.data?.total ?? bld.data?.items.length ?? 0) + (fac.data?.total ?? fac.data?.items.length ?? 0);
  return (
    <div className="space-y-3" data-testid="prospects">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold text-[#2563EB]">영업기회</h1>
        <div className="flex gap-1">{[['', '전체'], ['new', '새로'], ['contacting', '연락 중'], ['lead', '리드로'], ['skip', '제외']].map(([k, l]) => (
          <button key={k} type="button" onClick={() => setStatus(k)} aria-pressed={status === k} className={chip(status === k)}>{l}</button>))}</div>
        <form onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); }} className="ml-auto w-full sm:w-64"><input className={inputCls} value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름·주소 검색" aria-label="영업기회 검색" /></form>
      </div>
      {/* 242차 #759: 입주 고르기 — 올해·다음 해 바로, 다른 해는 고르기 · 6개월 전~12개월 뒤 창(186차) */}
      <div className="flex flex-wrap items-center gap-1.5" data-testid="prospects-movein-row">
        <span className="text-xs text-ink-3">입주</span>
        {[String(y), String(y + 1), `${y}-${y + 1}`].map((k) => (
          <button key={k} type="button" onClick={() => setMi(mi === k ? '' : k)} aria-pressed={mi === k || (k.length === 4 && mi.startsWith(`${k}-`) && mi.length === 7)} className={chip(mi === k || (k.length === 4 && mi.startsWith(`${k}-`) && mi.length === 7))} data-testid={`prospects-mi-${k}`}>{k.length === 4 ? `${k}년 입주` : '올해·다음 해'}</button>))}
        <select className={cx(inputCls, 'h-7 !w-auto py-0 text-xs')} value={/^\d{4}$/.test(mi) && ![String(y), String(y + 1)].includes(mi) ? mi : ''} onChange={(e) => setMi(e.target.value)} aria-label="입주 연도 고르기" data-testid="prospects-mi-year">
          <option value="">다른 해</option>{[y - 2, y - 1, y + 2, y + 3].map((v) => <option key={v} value={String(v)}>{v}년 입주</option>)}</select>
        <button type="button" onClick={() => setMi(mi === 'window' ? '' : 'window')} aria-pressed={mi === 'window'} data-testid="prospects-movein" title="청약홈 입주 예정월 기준 — 입주 6개월 전부터 입주 후 12개월까지" className={chip(mi === 'window')}>입주 시기(6개월 전~12개월 뒤)</button>
        {move && <>
          <span className="mx-0.5 hidden h-4 w-px bg-line sm:block" />
          <button type="button" onClick={() => setApt(apt ? '0' : '')} aria-pressed={apt} className={chip(apt)} data-testid="prospects-apt" title="청약홈 '아파트' 분양만(오피스텔·도시형·민간임대·생활숙박 빼기)">아파트만</button>
          <select className={cx(inputCls, 'h-7 !w-auto py-0 text-xs')} value={hh} onChange={(e) => setHh(e.target.value)} aria-label="세대수 이상" data-testid="prospects-hh">
            <option value="">세대수 전체</option>{['100', '300', '500', '1000'].map((v) => <option key={v} value={v}>{Number(v).toLocaleString('ko-KR')}세대 이상</option>)}</select>
        </>}
      </div>
      {move && data?.moveIn && (data.moveIn.months.length > 1 || mi.length === 7) && <div className="flex flex-wrap items-center gap-1 text-xs" data-testid="prospects-months">
        {mi.length === 7 && <button type="button" onClick={() => setMi(year)} className={chip(false)} data-testid="prospects-month-all">‹ {year}년 전체</button>}
        {data.moveIn.months.map((m) => <button key={m.ym} type="button" onClick={() => setMi(m.ym)} className={chip(mi === m.ym)} data-testid="prospects-month">{data.moveIn!.months.some((x) => x.ym.slice(0, 4) !== m.ym.slice(0, 4)) ? `${m.ym.slice(2, 4)}.` : ''}{Number(m.ym.slice(5, 7))}월 {m.n}</button>)}
      </div>}
      {move && data && <p className="text-xs text-ink-2" data-testid="prospects-movein-count">{mi === 'window' ? `입주 시기에 맞는 단지 ${data.total}곳` : `${miLabel(mi)} ${data.total}곳`} · 입주가 가까운 순{apt ? ' · 아파트만' : ''}{Number(hh) > 0 ? ` · ${Number(hh).toLocaleString('ko-KR')}세대 이상` : ''}</p>}
      {error ? <ErrorBox error={error} retry={reload} /> : !data ? <Skeleton rows={5} /> : !list.length ? (
        <p className="rounded-card border border-dashed border-line bg-white p-6 text-center text-sm text-ink-3">{move ? `${miLabel(mi)} 청약홈 단지가 아직 없습니다${apt ? '(아파트만)' : ''}. 청약홈 분양정보 원천을 켜면 입주 예정월로 골라 보여 줍니다.` : '아직 영업기회가 없습니다. 데이터 설정에서 원천을 켜면 매일 아침 새로 들어옵니다.'}</p>
      ) : (
        <ul className="space-y-2">{list.map((p) => ( /* #609(대표 10/25 ⑤): 허브 모든 탭 1열 */
          <li key={p.id} className="rounded-card border border-line bg-white p-3 shadow-card" data-testid="prospect-card">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{p.name}</div>
                <div className="truncate text-xs text-ink-2">{p.address ?? '주소 없음'}</div>
                <div className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
                  <span className="rounded-full bg-[#EFF6FF] px-1.5 text-[#1D4ED8]">{p.source_name}</span>
                  {p.biz_status && <span className={cx('rounded-full px-1.5', /폐업/.test(p.biz_status) ? 'bg-slate-100 text-ink-2' : 'bg-green-50 text-green-800')}>{p.biz_status}</span>}
                  {p.opened_on && <span className="text-ink-2">{p.detail ? '모집공고' : '개업'} {p.opened_on}</span>}{p.closed_on && <span className="text-ink-2">폐업 {p.closed_on}</span>}
                </div>
              </div>
              <select className="h-8 rounded-input border border-line bg-white px-1.5 text-xs" value={p.status} onChange={(e) => set(p, { status: e.target.value })} aria-label={`${p.name} 진행`}>
                {Object.entries(ST).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
            {p.detail && (
              <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-ink-2" data-testid="prospect-detail">
                {p.category && <><dt className="text-ink-3">유형</dt><dd>{p.category}</dd></>}
                {p.detail.developer && <><dt className="text-ink-3">시행</dt><dd className="truncate">{p.detail.developer}</dd></>}
                {p.detail.builder && <><dt className="text-ink-3">시공</dt><dd className="truncate">{p.detail.builder}</dd></>}
                {p.detail.moveIn && <><dt className="text-ink-3">입주 예정</dt><dd>{p.detail.moveIn.slice(0, 7)} <span className="text-ink-3" data-testid="prospect-movein-label">· {moveInLabel(p.detail.moveIn)}</span></dd></>}
                {p.detail.receipt && <><dt className="text-ink-3">접수</dt><dd>{p.detail.receipt}</dd></>}
                {p.detail.contract && <><dt className="text-ink-3">계약</dt><dd>{p.detail.contract}</dd></>}
                {p.detail.inquiry && <><dt className="text-ink-3">분양 문의</dt><dd>{p.detail.inquiry}</dd></>}
                {p.detail.url && <><dt className="text-ink-3">공고</dt><dd className="truncate"><a className="underline" href={p.detail.url} target="_blank" rel="noopener noreferrer">열기</a></dd></>}
              </dl>
            )}
            <input className={cx(inputCls, 'mt-2 h-8 py-1 text-xs')} defaultValue={p.memo ?? ''} placeholder="메모(우리 회사만 봄)" onBlur={(e) => e.target.value !== (p.memo ?? '') && set(p, { memo: e.target.value })} aria-label={`${p.name} 메모`} />
            <p className="mt-1.5 text-[10px] text-ink-3" data-testid="prospect-source">{p.attribution} · 데이터 기준일 {p.base_date}</p>
          </li>))}</ul>
      )}
      {data && list.length < data.total && <button type="button" onClick={loadMore} disabled={busy} className="w-full rounded-card border border-line bg-white py-2 text-sm text-ink-2 hover:bg-slate-50 disabled:opacity-60" data-testid="prospects-more">
        {busy ? '불러오는 중…' : `더 보기 (${list.length.toLocaleString('ko-KR')} / ${data.total.toLocaleString('ko-KR')})`}</button>}
      {/* 242차 #759: 같은 해·달 K-apt 준공·입주(사용승인) 단지·신규 단지 — 영업기회 허브 목록(회사 거르기·진행 상태 그대로) */}
      {my && (fac.data || bld.data) && <section className="space-y-1.5 rounded-card border border-line bg-white p-3" data-testid="prospects-kapt">
        <div className="flex flex-wrap items-center gap-2 text-sm"><b>K-apt·신규 단지 준공·입주 {miLabel(my).replace(' 입주', '')} {kaptTotal}곳</b>
          <span className="text-xs text-ink-3">입주일(없으면 준공·사용승인일) 기준</span>
          <Link prefetch={false} href={`/s/sales/hub?tab=facilities&my=${my}&sort=moveIn`} className="ml-auto text-xs text-[#2563EB] hover:underline" data-testid="prospects-kapt-all">허브에서 모두 보기</Link></div>
        {!kapt.length ? <p className="text-xs text-ink-3">이 기간 K-apt 준공·입주 단지가 없습니다.</p>
          : <ul className="divide-y divide-line text-sm">{kapt.slice(0, 30).map((x) => (
            <li key={`${x.tab}:${x.id}`} className="flex min-w-0 items-center gap-2 py-1.5" data-testid="prospects-kapt-row">
              <Link prefetch={false} href={`/s/sales/hub?tab=${x.tab}&id=${encodeURIComponent(String(x.id))}`} className="min-w-0 flex-1 truncate hover:underline">{x.name}</Link>
              <span className="shrink-0 text-xs text-ink-2">{[x.moveIn ? `입주 ${x.moveIn.slice(0, 7)}` : (x.completion ?? x.date) ? `준공 ${String(x.completion ?? x.date).slice(0, 7)}` : null, Number(x.households) > 0 ? `${Number(x.households).toLocaleString('ko-KR')}세대` : null, x.tab === 'buildings' ? '신규 단지' : 'K-apt'].filter(Boolean).join(' · ')}</span>
            </li>))}</ul>}
        {kapt.length > 30 && <p className="text-[11px] text-ink-3">그 밖 {kapt.length - 30}곳은 허브에서</p>}
      </section>}
    </div>
  );
}
