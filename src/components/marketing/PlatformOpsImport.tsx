'use client';
import { useState } from 'react';
import { api, useApi } from '@/components/client';
import { Button, ErrorBox, Skeleton, cx, fmtDateTime, inputCls, toast } from '@/components/ui';

type Res = { key: string; missing?: true; kind?: string; expectedCount?: number; count?: number; countOk?: boolean; shaOk?: boolean; pageSha?: boolean; sample?: string[] };
type Run = { id: string; tenant: string; mode: string; status: string; frozen: boolean | null; generated_at: string | null; results: Res[]; error: string | null; created_at: string; started_by_name: string | null };

/** V41 4-2 운영실 → 워크인 이관(플랫폼 운영자): 회사 지정 → [미리보기](건수·해시 대조, 저장 없음) → [적용](대조가 모두 맞을 때만 저장, 여러 번 해도 같음) */
export function PlatformOpsImport() {
  const { data, error, reload } = useApi<{ configured: boolean; runs: Run[]; stored: { tenant: string; key: string; count: number; imported_at: string }[] }>('/api/platform/ops-import');
  const [tenant, setTenant] = useState('default');
  const [busy, setBusy] = useState('');
  const [last, setLast] = useState<{ status: string; applied: boolean; frozen: boolean; results: Res[] } | null>(null);
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Skeleton rows={2} />;
  async function run(mode: 'preview' | 'apply') {
    if (mode === 'apply' && !confirm(`${tenant} 회사에 운영실 데이터를 저장할까요? 같은 키의 예전 가져오기는 이번 것으로 바뀝니다.`)) return;
    setBusy(mode);
    try { const r = await api<any>('/api/platform/ops-import', { body: { tenant, mode } }); setLast(r); toast[r.status === 'ok' ? 'ok' : 'error'](r.status === 'ok' ? (mode === 'apply' ? '저장했습니다 — 건수·해시 일치' : '미리보기: 건수·해시 모두 일치') : '건수 또는 해시가 다릅니다 — 저장하지 않았습니다'); reload(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(''); }
  }
  const rows = last?.results ?? data.runs[0]?.results ?? [];
  return (
    <section className="rounded-card border border-line bg-white p-4 shadow-card" data-testid="platform-ops-import">
      <h2 className="text-sm font-semibold">마케팅 운영실 데이터 이관(V41 4-2)</h2>
      <p className="mt-1 text-xs text-ink-2">운영실 내보내기 API(OPS_EXPORT_URL·OPS_EXPORT_TOKEN, 서명 요청)로 18개 키를 읽어 건수·해시를 대조합니다. 전화 기록은 개인정보 — 회사 안에서는 마케팅 관리자만 보고, 보관 기간이 지나면 지웁니다. 표 매핑(게시물 → 콘텐츠 등)은 아래 칸 이름을 보고 다음 단계에서.</p>
      {!data.configured ? <p className="mt-2 text-xs text-amber-800">OPS_EXPORT_URL·OPS_EXPORT_TOKEN 설정 전입니다(대표 입력).</p> : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input className={cx(inputCls, 'h-8 w-40 py-1 text-xs')} value={tenant} onChange={(e) => setTenant(e.target.value.trim())} aria-label="가져올 회사 ID" />
          <Button size="sm" variant="secondary" onClick={() => run('preview')} disabled={!!busy} data-testid="ops-preview">{busy === 'preview' ? '읽는 중…' : '미리보기'}</Button>
          <Button size="sm" onClick={() => run('apply')} disabled={!!busy} data-testid="ops-apply">{busy === 'apply' ? '저장 중…' : '적용'}</Button>
          {last && <span className="text-xs text-ink-2">{last.frozen ? '운영실 쓰기 동결 중(최종 복사)' : '동결 전(연습 복사)'}</span>}
        </div>
      )}
      {!!rows.length && (
        <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[760px] text-xs"><thead className="text-left text-ink-2"><tr><th className="p-1">키</th><th className="p-1 text-right">운영실</th><th className="p-1 text-right">받은 건수</th><th className="p-1">해시</th><th className="p-1">칸 이름(값 없이)</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.key} className="border-t border-line" data-testid="ops-row"><td className="p-1 font-mono">{r.key}</td>
              {r.missing ? <td colSpan={4} className="p-1 text-amber-700">운영실 목록에 없음</td> : <>
                <td className="p-1 text-right tabular-nums">{r.expectedCount}</td><td className={cx('p-1 text-right tabular-nums', !r.countOk && 'font-semibold text-red-700')}>{r.count}</td>
                <td className={cx('p-1', r.shaOk ? 'text-emerald-700' : 'font-semibold text-red-700')}>{r.shaOk ? '일치' : r.pageSha ? '다름(계산 방식 확인)' : '다름'}</td>
                <td className="p-1 text-ink-3">{r.sample?.join(', ') ?? '—'}</td></>}
            </tr>))}</tbody></table></div>
      )}
      {!!data.stored.length && <p className="mt-2 text-[11px] text-ink-3">저장됨: {data.stored.map((s) => `${s.tenant} ${s.key.replace(/^mkt:|:v1$/g, '')} ${s.count}`).join(' · ')}</p>}
      {!!data.runs.length && <p className="mt-1 text-[11px] text-ink-3">최근 실행: {data.runs.slice(0, 3).map((r) => `${fmtDateTime(r.created_at)} ${r.mode === 'apply' ? '적용' : '미리보기'} ${r.status}${r.error ? `(${r.error})` : ''}`).join(' · ')}</p>}
    </section>
  );
}
