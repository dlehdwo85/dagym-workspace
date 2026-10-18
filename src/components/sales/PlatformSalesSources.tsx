'use client';
import { useState } from 'react';
import { api, useApi } from '@/components/client';
import { Button, ErrorBox, Skeleton, cx, fmtDateTime, inputCls, toast } from '@/components/ui';

type R = { code: string; name: string; provider: string; category: string; endpoint: string | null; params: Record<string, unknown>; field_map: Record<string, unknown>; collect: boolean; last_run_at: string | null; last_count: number | null; last_error: string | null; total: number };

/** V41 단계 3: 플랫폼 운영자 — 공공데이터 원천 수집 주소·인자·칸 이름 맞추기, 수동 실행(실제 응답 확인), 수집 켜기(하루 한 번) */
export function PlatformSalesSources() {
  const { data, error, reload } = useApi<{ sources: R[] }>('/api/platform/sales-sources');
  const [edit, setEdit] = useState<Record<string, { endpoint: string; params: string; fieldMap: string }>>({});
  const [busy, setBusy] = useState('');
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Skeleton rows={3} />;
  async function save(r: R, run: boolean, days?: number) {
    const e = edit[r.code];
    setBusy(r.code);
    try {
      const body: any = { code: r.code, run, maxPages: 1, ...(days ? { days } : {}) };
      if (e) { if (e.endpoint.trim()) body.endpoint = e.endpoint.trim(); body.params = e.params.trim() ? JSON.parse(e.params) : undefined; body.fieldMap = e.fieldMap.trim() ? JSON.parse(e.fieldMap) : undefined; }
      const out = await api<any>('/api/platform/sales-sources', { body });
      toast[out.error ? 'error' : 'ok'](run ? (out.error ? `수집 실패: ${out.error}` : `${out.count}건 모음`) : '저장했습니다'); reload();
    } catch (er: any) { toast.error(er.message); } finally { setBusy(''); }
  }
  async function toggle(r: R, collect: boolean) { try { await api('/api/platform/sales-sources', { body: { code: r.code, collect } }); reload(); } catch (er: any) { toast.error(er.message); } }
  return (
    <section className="rounded-card border border-line bg-white p-4 shadow-card" data-testid="platform-sales-sources">
      <h2 className="text-sm font-semibold">영업 공공데이터 수집(V40)</h2>
      <p className="mt-1 text-xs text-ink-2">원천마다 data.go.kr 호출 주소를 넣고 [시험 수집]으로 실제 응답을 확인한 뒤 [하루 한 번 수집]을 켭니다. 키는 운영 설정 DATA_GO_KR_SERVICE_KEY. 칸 이름이 다르면 칸 매핑(JSON, 예: {`{"name":"BPLC_NM","address":"ROAD_NM_ADDR"}`})으로 맞춥니다.</p>
      <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[900px] text-xs">
        <thead><tr className="text-left text-ink-3"><th className="py-1">원천</th><th>호출 주소</th><th>추가 인자(JSON)</th><th>칸 매핑(JSON)</th><th>최근</th><th></th></tr></thead>
        <tbody>{data.sources.map((r) => { const e = edit[r.code] ?? { endpoint: r.endpoint ?? '', params: JSON.stringify(r.params ?? {}) === '{}' ? '' : JSON.stringify(r.params), fieldMap: JSON.stringify(r.field_map ?? {}) === '{}' ? '' : JSON.stringify(r.field_map) };
          const set = (k: keyof typeof e, v: string) => setEdit((x) => ({ ...x, [r.code]: { ...e, [k]: v } }));
          return (
            <tr key={r.code} className="border-t border-line align-top">
              <td className="py-1.5 pr-2"><div className="font-medium">{r.name}</div><div className="text-ink-3">{r.code} · {r.category}</div></td>
              <td className="pr-1"><input className={cx(inputCls, 'h-7 py-0.5 text-xs')} value={e.endpoint} onChange={(x) => set('endpoint', x.target.value)} placeholder="https://apis.data.go.kr/..." aria-label={`${r.name} 주소`} /></td>
              <td className="pr-1"><input className={cx(inputCls, 'h-7 py-0.5 text-xs')} value={e.params} onChange={(x) => set('params', x.target.value)} aria-label={`${r.name} 인자`} /></td>
              <td className="pr-1"><input className={cx(inputCls, 'h-7 py-0.5 text-xs')} value={e.fieldMap} onChange={(x) => set('fieldMap', x.target.value)} aria-label={`${r.name} 칸 매핑`} /></td>
              <td className="whitespace-nowrap pr-1 text-ink-2">{r.last_run_at ? `${fmtDateTime(r.last_run_at)} · ${r.last_count ?? 0}건` : '—'} · 누적 {r.total}{r.last_error && <div className="max-w-[16rem] truncate text-red-600" title={r.last_error}>{r.last_error}</div>}</td>
              <td className="whitespace-nowrap">
                <Button size="sm" variant="secondary" disabled={busy === r.code} onClick={() => save(r, false)}>저장</Button>{' '}
                <Button size="sm" variant="secondary" disabled={busy === r.code} onClick={() => save(r, true)}>시험 수집</Button>{' '}
                {r.code === '15098547' && <><Button size="sm" variant="secondary" disabled={busy === r.code} onClick={() => confirm('최근 365일 분양공고를 처음으로 채웁니다(몇 분 걸릴 수 있음). 진행할까요?') && save(r, true, 365)} data-testid="applyhome-backfill">처음 채우기 365일</Button>{' '}</>}
                <label className="inline-flex items-center gap-1"><input type="checkbox" checked={r.collect} onChange={(x) => toggle(r, x.target.checked)} />하루 한 번</label>
              </td>
            </tr>
          ); })}</tbody>
      </table></div>
    </section>
  );
}
