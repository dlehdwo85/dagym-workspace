'use client';
import { useState } from 'react';
import { api, useApi } from '@/components/client';
import { Button, ErrorBox, Skeleton, cx, toast } from '@/components/ui';

const C = '#7C3AED';
/** 운영실 키 → 이름 · 워크인에서 보여 줄 자리(매핑 제안 — docs/research/OPS_DATA_MAPPING.md) */
const KEY_INFO: Record<string, [string, string]> = {
  'mkt:posts:v1': ['게시물', '콘텐츠 캘린더(게시됨 기록)'],
  'mkt:requests:v1': ['제작 요청', '승인 대기 · 콘텐츠'],
  'mkt:schedule:v1': ['게시 일정', '콘텐츠 캘린더(예정)'],
  'mkt:production:v1': ['제작 진행', '콘텐츠 상태'],
  'mkt:revisions:v1': ['수정 이력', '콘텐츠 버전'],
  'mkt:daily:decisions:v1': ['일일 결정', '승인 기록'],
  'mkt:media:v1': ['미디어', '자료실'],
  'mkt:media-outputs:v1': ['미디어 결과물', '자료실'],
  'mkt:media-approval:v1': ['미디어 승인', '승인 기록'],
  'mkt:library:v1': ['자료 목록', '자료실(이미 옮김)'],
  'mkt:ads:structure-decision:v1': ['광고 구조 결정', '광고 운영(V44) 변경 기록'],
  'mkt:ads:apply-log:v1': ['광고 반영 기록', '광고 운영(V44) 변경 기록'],
  'mkt:call-records:v1': ['전화 기록(번호 가림)', '전화 문의'],
  'mkt:call-clicks:v1': ['전화 버튼 클릭', '전화 문의 · 월간 보고'],
  'mkt:call-clicks:first-seen:v1': ['클릭 첫 확인', '전화 문의 · 월간 보고'],
  'mkt:owner:actions:done:v1': ['대표 처리 기록', '승인 기록'],
  'mkt:plan-state:v1': ['계획 상태', '자동 제작 설정'],
  'mkt:plan:active:v1': ['진행 중 계획', '자동 제작 설정'],
  'mkt:approvals:dynamic:v1': ['동적 승인', '승인 대기'],
};
type Field = { name: string; filled: number; types: string[] };
type FieldsData = { keys: { key: string; count: number; objects: number; fields: Field[] }[] };
const cell = (v: unknown) => { if (v == null) return ''; const s = typeof v === 'string' ? v : JSON.stringify(v); return s.length > 80 ? `${s.slice(0, 80)}…` : s; };

/** 마케팅 운영실에서 옮겨 온 기록(관리자) — 키별 건수·칸 구조·원본 표. 정식 화면 매핑 전까지 여기서 확인 */
export function OpsHistory() {
  const { data, error, reload } = useApi<FieldsData>('/api/marketing/imported?view=fields');
  const [key, setKey] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const items = useApi<{ items: { idx: number; item: any }[] }>(key ? `/api/marketing/imported?key=${encodeURIComponent(key)}&offset=${offset}` : null, [key, offset]);
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Skeleton rows={6} />;
  const cur = data.keys.find((k) => k.key === key);
  const cols = (cur?.fields ?? []).slice(0, 6).map((f) => f.name);
  return (
    <div className="space-y-4" data-testid="ops-history">
      <div><h1 className="text-xl font-bold" style={{ color: C }}>운영실 기록</h1>
        <p className="text-xs text-ink-2">예전 마케팅 운영실에서 옮겨 온 원본입니다. 워크인 화면(콘텐츠·승인·전화 문의 등)으로 정식 연결하기 전까지 여기서 봅니다. 전화번호는 가려서 옮겼습니다.</p></div>
      {data.keys.length > 0 && <ConvertPanel />}
      {!data.keys.length ? <p className="rounded-card border border-line bg-white p-4 text-sm text-ink-3">옮겨 온 기록이 없습니다</p> : (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{data.keys.map((k) => (
          <li key={k.key}><button type="button" onClick={() => { setKey(k.key); setOffset(0); }} data-testid="ops-key"
            className={cx('w-full rounded-card border bg-white p-3 text-left shadow-card hover:border-violet-300', key === k.key ? 'border-violet-500' : 'border-line')}>
            <span className="flex items-baseline gap-2"><b className="text-sm">{KEY_INFO[k.key]?.[0] ?? k.key}</b><span className="text-xs text-ink-2">{k.count.toLocaleString('ko-KR')}건</span></span>
            <span className="mt-0.5 block text-[11px] text-ink-3">→ {KEY_INFO[k.key]?.[1] ?? '자리 미정'}</span></button></li>))}</ul>
      )}
      {cur && (
        <section className="rounded-card border border-line bg-white p-3 shadow-card" data-testid="ops-detail">
          <h2 className="text-sm font-semibold">{KEY_INFO[cur.key]?.[0] ?? cur.key} <span className="font-normal text-ink-3">({cur.key})</span></h2>
          <p className="mt-1 text-[11px] text-ink-3" data-testid="ops-fields">칸: {cur.fields.map((f) => `${f.name}(${f.filled}/${cur.count})`).join(' · ') || '없음(값만 있는 목록)'}</p>
          {!items.data ? <Skeleton rows={4} /> : (
            <div className="mt-2 overflow-x-auto"><table className="w-full text-xs">
              <thead><tr className="border-b border-line text-left text-ink-3"><th className="py-1 pr-2">#</th>{cols.length ? cols.map((c) => <th key={c} className="py-1 pr-2">{c}</th>) : <th className="py-1">값</th>}</tr></thead>
              <tbody>{items.data.items.map((r) => (
                <tr key={r.idx} className="border-b border-line/60 align-top" data-testid="ops-row"><td className="py-1 pr-2 text-ink-3">{r.idx + 1}</td>
                  {cols.length ? cols.map((c) => <td key={c} className="max-w-[16rem] break-words py-1 pr-2">{cell(r.item?.[c])}</td>) : <td className="py-1">{cell(r.item)}</td>}</tr>))}</tbody>
            </table></div>
          )}
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="secondary" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 50))}>이전 50</Button>
            <Button size="sm" variant="secondary" disabled={offset + 50 >= cur.count} onClick={() => setOffset(offset + 50)}>다음 50</Button>
          </div>
        </section>
      )}
    </div>
  );
}

type Conv = { mode: string; posts: number; daily: number; requests: number; revisions: number; newContents: number; existing: number; decisions: number; withUrl: number;
  mapping: Record<string, number>; channels: Record<string, number>; unknownBrands: string[]; sample: { title: string; channel: string; status: string; url: boolean }[]; made?: number; requestsMade?: number };
const ST: Record<string, string> = { published: '게시됨', approved: '승인', pending: '승인 대기', changes: '수정 요청', hold: '보류', canceled: '취소', draft: '초안' };
/** 운영실 기록 → 워크인 콘텐츠·결정·요청 기록(미리보기로 상태 매핑 확인 → 적용, 같은 원본은 한 번만) */
function ConvertPanel() {
  const [r, setR] = useState<Conv | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(mode: 'preview' | 'apply') {
    if (mode === 'apply' && !confirm('미리보기대로 콘텐츠·결정 기록·요청 기록을 만들까요? 같은 원본은 다시 만들지 않습니다.')) return;
    setBusy(true);
    try { const x = await api<Conv>('/api/marketing/imported/convert', { body: { mode } }); setR(x); if (mode === 'apply') toast.ok(`콘텐츠 ${x.made}건 · 요청 기록 ${x.requestsMade}건을 만들었습니다`); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  return (
    <section className="rounded-card border border-violet-200 bg-violet-50/40 p-3 text-sm" data-testid="ops-convert">
      <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">워크인 화면으로 옮기기</h2>
        <span className="text-xs text-ink-2">게시물·일일 항목 → 콘텐츠 캘린더(결정 기록 포함), 요청 → 승인 대기 아래 &lsquo;이전 요청 기록&rsquo;</span>
        <span className="ml-auto flex gap-2"><Button size="sm" variant="secondary" onClick={() => run('preview')} disabled={busy} data-testid="ops-convert-preview">미리보기</Button>
          <Button size="sm" onClick={() => run('apply')} disabled={busy || !r || r.newContents + r.requests === 0} data-testid="ops-convert-apply">옮기기</Button></span></div>
      {r && (
        <div className="mt-2 space-y-1 text-xs" data-testid="ops-convert-result">
          <p>원본: 게시물 {r.posts} · 일일 항목 {r.daily} · 요청 {r.requests} · 수정 이력 {r.revisions}(원본 화면에서만) — 새로 만들 콘텐츠 <b>{r.newContents}</b>건(이미 옮김 {r.existing}) · 결정 기록 {r.decisions}건 · 게시 주소 있음 {r.withUrl}건
            {r.mode === 'apply' && <> · <b className="text-emerald-800">만듦 {r.made} · 요청 기록 {r.requestsMade}</b></>}</p>
          <p className="font-medium">상태 매핑(원본 값 → 워크인)</p>
          <ul className="grid gap-x-4 sm:grid-cols-2">{Object.entries(r.mapping).map(([k, n]) => <li key={k}>{k.replace(/→ (\w+)$/, (_m, x) => `→ ${ST[x] ?? x}`)} · {n}건</li>)}</ul>
          <p>채널: {Object.entries(r.channels).map(([k, n]) => `${k} ${n}`).join(' · ')}</p>
          {r.unknownBrands.length > 0 && <p className="text-amber-800">브랜드 코드 확인 필요: {r.unknownBrands.join(', ')} (그대로 브랜드 이름으로 만들어짐)</p>}
          <ul className="text-ink-2">{r.sample.map((x, k) => <li key={k}>· {x.title} — {x.channel} · {ST[x.status] ?? x.status}{x.url ? ' · 주소 있음' : ''}</li>)}</ul>
        </div>)}
    </section>
  );
}
