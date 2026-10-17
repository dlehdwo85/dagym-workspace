'use client';
import { useState } from 'react';
import { api, useApi } from '@/components/client';
import { ErrorBox, Skeleton, cx, inputCls, toast } from '@/components/ui';

const ST = { new: '새로', contacting: '연락 중', lead: '리드로', skip: '제외' } as const;
type P = { id: number; name: string; address: string | null; sido: string | null; biz_status: string | null; opened_on: string | null; closed_on: string | null; category: string | null; base_date: string;
  source_code: string; source_name: string; attribution: string; status: keyof typeof ST; memo: string | null };

/** V41 단계 3 영업기회(공공데이터): 회사가 켠 원천의 새로 연 곳·영업 중·폐업 — 카드마다 출처·데이터 기준일, 진행 상태·메모는 회사별 */
export function Prospects() {
  const [status, setStatus] = useState('');
  const [q, setQ] = useState(''); const [query, setQuery] = useState('');
  const { data, error, reload } = useApi<{ prospects: P[] }>(`/api/sales/prospects?status=${status}&q=${encodeURIComponent(query)}`, [status, query]);
  async function set(p: P, body: { status?: string; memo?: string }) {
    try { await api(`/api/sales/prospects/${p.id}`, { method: 'PATCH', body }); reload(); } catch (e: any) { toast.error(e.message); }
  }
  return (
    <div className="space-y-3" data-testid="prospects">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold text-[#2563EB]">영업기회</h1>
        <div className="flex gap-1">{[['', '전체'], ['new', '새로'], ['contacting', '연락 중'], ['lead', '리드로'], ['skip', '제외']].map(([k, l]) => (
          <button key={k} type="button" onClick={() => setStatus(k)} aria-pressed={status === k} className={cx('rounded-full border px-2.5 py-1 text-xs', status === k ? 'border-[#2563EB] bg-[#EFF6FF] font-semibold text-[#2563EB]' : 'border-line bg-white text-ink-2')}>{l}</button>))}</div>
        <form onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); }} className="ml-auto w-full sm:w-64"><input className={inputCls} value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름·주소 검색" aria-label="영업기회 검색" /></form>
      </div>
      {error ? <ErrorBox error={error} retry={reload} /> : !data ? <Skeleton rows={5} /> : !data.prospects.length ? (
        <p className="rounded-card border border-dashed border-line bg-white p-6 text-center text-sm text-ink-3">아직 영업기회가 없습니다. 데이터 설정에서 원천을 켜면 매일 아침 새로 들어옵니다.</p>
      ) : (
        <ul className="grid gap-2 lg:grid-cols-2">{data.prospects.map((p) => (
          <li key={p.id} className="rounded-card border border-line bg-white p-3 shadow-card" data-testid="prospect-card">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{p.name}</div>
                <div className="truncate text-xs text-ink-2">{p.address ?? '주소 없음'}</div>
                <div className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
                  <span className="rounded-full bg-[#EFF6FF] px-1.5 text-[#1D4ED8]">{p.source_name}</span>
                  {p.biz_status && <span className={cx('rounded-full px-1.5', /폐업/.test(p.biz_status) ? 'bg-slate-100 text-ink-2' : 'bg-green-50 text-green-800')}>{p.biz_status}</span>}
                  {p.opened_on && <span className="text-ink-2">개업 {p.opened_on}</span>}{p.closed_on && <span className="text-ink-2">폐업 {p.closed_on}</span>}
                </div>
              </div>
              <select className="h-8 rounded-input border border-line bg-white px-1.5 text-xs" value={p.status} onChange={(e) => set(p, { status: e.target.value })} aria-label={`${p.name} 진행`}>
                {Object.entries(ST).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
            <input className={cx(inputCls, 'mt-2 h-8 py-1 text-xs')} defaultValue={p.memo ?? ''} placeholder="메모(우리 회사만 봄)" onBlur={(e) => e.target.value !== (p.memo ?? '') && set(p, { memo: e.target.value })} aria-label={`${p.name} 메모`} />
            <p className="mt-1.5 text-[10px] text-ink-3" data-testid="prospect-source">{p.attribution} · 데이터 기준일 {p.base_date}</p>
          </li>))}</ul>
      )}
    </div>
  );
}
