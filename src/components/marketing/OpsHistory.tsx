'use client';
import { useState } from 'react';
import { useApi } from '@/components/client';
import { Button, ErrorBox, Skeleton, cx } from '@/components/ui';

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
