'use client';
import { useEffect, useState } from 'react';
import { api, useApi } from '@/components/client';
import { Button, cx, inputCls, toast } from '@/components/ui';

/**
 * 206차(#461 ⑦ 기존 거래처끼리 합치기, SALES_LEADS_REVAMP 4절) — 리드 상세 › 정보 아래, 관리자만.
 * 겹쳐 보이는 거래처(같은 사업자번호·전화·메일 / 비슷한 이름)를 먼저 보여 주고 이름으로도 찾는다 → 고르면 두 거래처를 나란히(단계·담당·딸린 것 수) →
 * 남길 거래처를 고르고(제안 = 딸린 것이 많은 쪽) [합치기]. 다른 쪽의 상담·업무·일정·단계 기록·입찰 연결을 남길 쪽으로 옮기고 빈 칸만 채운다(다른 값은 메모 한 줄)
 */
type Cand = { id: string; name: string; status: string | null; region: string | null; by: string };
type Side = { id: string; name: string; status: string | null; region: string | null; owner: string | null; next: string | null; created: string; counts: Record<string, number> };
type Plan = { fill: string[]; diff: string[]; owner: boolean };
type Preview = { a: Side; b: Side; keep: 'a' | 'b'; aIntoB: Plan; bIntoA: Plan };
const BY: Record<string, string> = { bizNo: '같은 사업자번호', phone: '같은 전화', email: '같은 메일', name: '비슷한 이름', search: '' };
const COUNTS: [string, string][] = [['acts', '상담'], ['tasks', '업무'], ['events', '일정'], ['deals', '제안·계약'], ['work', '입찰 연결'], ['records', '기타 기록'], ['adLeads', '광고 문의'], ['quotes', '견적'], ['statusLog', '단계 기록']];
const countText = (c: Record<string, number>) => COUNTS.filter(([k]) => c[k]).map(([k, l]) => `${l} ${c[k]}`).join(' · ') || '딸린 기록 없음';
const btnCls = 'inline-flex min-h-[32px] items-center rounded-input border border-line bg-white px-2.5 text-xs font-medium';

export function LeadMergeBox({ id, onMerged }: { id: string; onMerged: (into: string) => void }) {
  const [open, setOpen] = useState(false); const [q, setQ] = useState(''); const [qq, setQq] = useState(''); const [pick, setPick] = useState<string | null>(null);
  useEffect(() => { const h = setTimeout(() => setQq(q.trim()), 300); return () => clearTimeout(h); }, [q]);
  const { data } = useApi<{ candidates: Cand[] }>(open ? `/api/sales/leads/${id}/merge${qq.length >= 2 ? `?q=${encodeURIComponent(qq)}` : ''}` : null);
  if (!open) return <div className="flex justify-end"><button type="button" onClick={() => setOpen(true)} className="text-xs text-ink-2 underline" data-testid="lead-merge">중복 합치기</button></div>;
  return (
    <div className="space-y-1.5 rounded-input border border-amber-200 bg-amber-50/60 p-2 text-xs" data-testid="lead-merge-box">
      <div className="flex items-center justify-between gap-2"><b className="text-sm">중복 합치기</b><button type="button" onClick={() => { setOpen(false); setPick(null); }} className="text-ink-3 underline">닫기</button></div>
      <p className="text-ink-2">같은 곳이 두 번 들어가 있으면 하나로 합칩니다 — 상담·업무·일정·단계 기록을 남길 거래처로 옮기고, 다른 하나는 목록에서 빠집니다.</p>
      <input className={cx(inputCls, 'h-8 py-1')} value={q} onChange={(e) => { setQ(e.target.value); setPick(null); }} placeholder="거래처 이름으로 찾기" aria-label="합칠 거래처 찾기" data-testid="lead-merge-q" />
      <p className="text-ink-3">{qq.length >= 2 ? '찾은 거래처' : '겹쳐 보이는 거래처(같은 사업자번호·전화·메일 / 비슷한 이름)'}</p>
      <ul className="space-y-1">{(data?.candidates ?? []).map((c) => (
        <li key={c.id}><button type="button" onClick={() => setPick(c.id)} className={cx('rounded-input border px-2 py-1 text-left', pick === c.id ? 'border-blue-400 bg-blue-50' : 'border-line bg-white')} data-testid="lead-merge-cand">
          <b>{c.name}</b>{c.status && <span className="ml-1 text-ink-3">{c.status}</span>}{c.region && <span className="ml-1 text-ink-3">{c.region}</span>}{BY[c.by] && <span className="ml-1 font-semibold text-amber-800">{BY[c.by]}</span>}</button></li>))}
        {data && !data.candidates.length && <li className="text-ink-3">없음</li>}</ul>
      {pick && <MergePreview key={pick} id={id} other={pick} onCancel={() => setPick(null)} onDone={(into) => { setOpen(false); setPick(null); onMerged(into); }} />}
    </div>
  );
}

function MergePreview({ id, other, onCancel, onDone }: { id: string; other: string; onCancel: () => void; onDone: (into: string) => void }) {
  const { data, error } = useApi<Preview>(`/api/sales/leads/${id}/merge?with=${other}`);
  const [keep, setKeep] = useState<'a' | 'b' | null>(null); const [busy, setBusy] = useState(false);
  if (error) return <p className="text-red-700" role="alert">{error.message}</p>;
  if (!data) return <p className="text-ink-3">두 거래처를 비교하는 중…</p>;
  const k = keep ?? data.keep; const kept = data[k]; const gone = data[k === 'a' ? 'b' : 'a']; const plan = k === 'a' ? data.bIntoA : data.aIntoB;
  async function go() {
    setBusy(true);
    try { const r = await api<{ into: string }>(`/api/sales/leads/${gone.id}/merge`, { body: { into: kept.id } }); toast.ok(`‘${gone.name}’을(를) ‘${kept.name}’(으)로 합쳤습니다`); onDone(r.into); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-1.5 rounded-input border border-line bg-white p-2" data-testid="lead-merge-preview">
      <p className="font-semibold">남길 거래처를 고르세요</p>
      <div className="grid gap-1.5 sm:grid-cols-2">{(['a', 'b'] as const).map((x) => { const L = data[x]; return (
        <label key={x} className={cx('cursor-pointer rounded-input border p-2', k === x ? 'border-blue-400 bg-blue-50' : 'border-line')} data-testid="lead-merge-side" data-keep={k === x ? '1' : '0'}>
          <span className="flex items-center gap-1.5"><input type="radio" name={`merge-keep-${id}`} checked={k === x} onChange={() => setKeep(x)} /><b>{L.name}</b>{x === 'a' && <span className="text-ink-3">(이 거래처)</span>}</span>
          <span className="block text-ink-2">{[L.status, L.owner ?? '담당 없음', L.region, `등록 ${L.created}`].filter(Boolean).join(' · ')}</span>
          <span className="block text-ink-3">{countText(L.counts)}</span>
        </label>); })}</div>
      <p className="text-ink-2" data-testid="lead-merge-summary">‘{gone.name}’의 {countText(gone.counts)}을(를) ‘{kept.name}’(으)로 옮깁니다 ·{' '}
        {plan.fill.length ? `빈 칸 채움: ${plan.fill.join('·')}` : '채울 빈 칸 없음'}{plan.owner ? ' · 담당도 가져옴' : ''}{plan.diff.length ? ` · 다른 값은 바꾸지 않고 메모에: ${plan.diff.join(' · ')}` : ''}.
        {' '}‘{gone.name}’은(는) 목록에서 빠지고, 예전 링크는 ‘{kept.name}’(으)로 열립니다. 되돌릴 수 없습니다.</p>
      <div className="flex flex-wrap justify-end gap-2"><button type="button" className={btnCls} onClick={onCancel}>취소</button>
        <Button size="sm" variant="danger" onClick={go} disabled={busy} data-testid="lead-merge-go">‘{kept.name}’(으)로 합치기</Button></div>
    </div>
  );
}
