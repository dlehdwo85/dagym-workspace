'use client';
import { useState } from 'react';
import { api, useApi } from '@/components/client';
import { Button, cx, toast } from '@/components/ui';

type T = { name: string; count: number | null; expected: number | null; columns: string[]; skip: boolean; error: string | null };

/** V41 단계 2 영업관리 이전(플랫폼 운영자): [미리보기] = 원본 표·건수·칸 이름(저장 없음). V39 E 검수 숫자와 대조 */
export function PlatformSalesMigrate() {
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState<{ at: string; base?: string; specError?: string | null; tables: T[]; related: number | null; relatedExpected: number } | null>(null);
  async function preview() {
    setBusy(true);
    try { setR(await api('/api/platform/sales-migrate', { body: {} })); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  const st = useApi<{ applied: { tenant: string; at: string; daily: boolean } | null; sync: any[]; users: any[] }>('/api/platform/sales-migrate');
  const [tenant, setTenant] = useState('default');
  const [ap, setAp] = useState<any>(null);
  async function apply() {
    if (!confirm(`${tenant} 회사로 영업관리 원본을 옮깁니다(원본은 읽기만, 다시 눌러도 중복 없음). 진행할까요?`)) return;
    setBusy(true);
    try { const x = await api<any>('/api/platform/sales-migrate', { body: { action: 'apply', tenant } }); setAp(x); toast[x.results.every((t: any) => t.ok) ? 'ok' : 'error'](`표 ${x.results.length}개 중 일치 ${x.results.filter((t: any) => t.ok).length}개 · ${x.seconds}초`); st.reload(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  async function daily(on: boolean) { try { await api('/api/platform/sales-migrate', { body: { action: 'daily', daily: on } }); st.reload(); } catch (e: any) { toast.error(e.message); } }
  const mism = r?.tables.filter((t) => t.expected !== null && t.count !== t.expected).length ?? 0;
  return (
    <section className="rounded-card border border-line bg-white p-4 shadow-card" data-testid="platform-sales-migrate">
      <h2 className="text-sm font-semibold">영업관리 → 워크인 이전(V41 단계 2)</h2>
      <p className="mt-1 text-xs text-ink-2">원본(Supabase, SALES_SRC_URL·SALES_SRC_SERVICE_KEY)은 읽기만 합니다. [미리보기]는 표마다 건수·칸 이름을 보여 주고 아무것도 저장하지 않습니다. 검수 숫자(V39 E)와 맞으면 대표 확인 뒤 적용 단계로.</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={preview} disabled={busy} data-testid="sales-migrate-preview">{busy ? '읽는 중…' : '미리보기'}</Button>
        <input className="h-8 w-32 rounded-input border border-line px-2 text-xs" value={tenant} onChange={(e) => setTenant(e.target.value.trim())} aria-label="옮길 회사 ID" />
        <Button size="sm" onClick={apply} disabled={busy} data-testid="sales-migrate-apply">적용(옮기기)</Button>
        {st.data?.applied && <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={!!st.data.applied.daily} onChange={(e) => daily(e.target.checked)} />전환일까지 매일 차이분 다시 가져오기</label>}
      </div>
      {(ap?.results ?? st.data?.sync ?? []).length > 0 && (
        <div className="mt-2 max-h-80 overflow-auto"><p className="text-xs text-ink-2">{ap ? `적용 ${ap.tenant} · ${ap.seconds}초 · 관련 공고 ${ap.related} · 사용자 ${ap.users.matched}/${ap.users.total}명 연결(나머지는 대표)` : `마지막 적용 ${st.data?.applied?.tenant ?? ''}`} · 옮기지 않음: {(ap?.notMoved ?? []).join(', ') || '관측·실행 이력·백업·AI 기록'}</p>
          <table className="w-full min-w-[560px] text-xs" data-testid="sales-migrate-result"><thead className="text-left text-ink-2"><tr><th className="p-1">표</th><th className="p-1">구분</th><th className="p-1 text-right">원본</th><th className="p-1 text-right">워크인</th><th className="p-1">대조</th></tr></thead>
            <tbody>{(ap?.results ?? st.data?.sync ?? []).map((t: any) => (
              <tr key={t.tbl} className="border-t border-line"><td className="p-1 font-mono">{t.tbl}</td><td className="p-1">{t.scope === 'global' ? '공용' : t.scope === 'tenant' ? '회사별' : ''}{t.progress ? ` · 진행 칸 ${t.progress}` : ''}</td>
                <td className="p-1 text-right tabular-nums">{t.src ?? t.src_count ?? '—'}</td><td className="p-1 text-right tabular-nums">{t.dst ?? t.dst_count ?? '—'}</td>
                <td className={cx('p-1', t.error && /PGRST205|표 없음/.test(t.error) ? 'text-ink-3' : t.error ? 'text-red-700' : (t.ok ?? t.src_count === t.dst_count) ? 'text-emerald-700' : 'font-semibold text-red-700')}>{t.error && /PGRST205|표 없음/.test(t.error) ? '원본에 없음' : t.error ?? ((t.ok ?? t.src_count === t.dst_count) ? '일치' : '다름')}</td></tr>))}</tbody></table></div>
      )}
      {r && (
        <>
          {r.specError && <p className="mt-2 text-xs text-amber-800">설명서(/rest/v1/)를 못 읽어 알려진 표 27개로 셌습니다 — {r.specError}</p>}
          <p className={cx('mt-2 text-xs', mism ? 'text-amber-800' : 'text-emerald-700')}>원본 {r.base} · 표 {r.tables.length}개 · 검수 숫자와 다른 표 {mism}개 · 관련 공고 {r.related ?? '—'}건(기준 {r.relatedExpected})</p>
          <div className="mt-1 max-h-96 overflow-auto"><table className="w-full min-w-[760px] text-xs"><thead className="sticky top-0 bg-white text-left text-ink-2"><tr><th className="p-1">표</th><th className="p-1 text-right">원본 건수</th><th className="p-1 text-right">검수 기준</th><th className="p-1">칸 이름</th></tr></thead>
            <tbody>{r.tables.map((t) => (
              <tr key={t.name} className={cx('border-t border-line', t.skip && 'opacity-50')} data-testid="sales-migrate-row"><td className="p-1 font-mono">{t.name}{t.skip && ' (옮기지 않음)'}</td>
                <td className={cx('p-1 text-right tabular-nums', t.expected !== null && t.count !== t.expected && 'font-semibold text-red-700')}>{t.error ? <span className="text-red-700">{t.error}</span> : t.count ?? '—'}</td>
                <td className="p-1 text-right tabular-nums text-ink-3">{t.expected ?? ''}</td><td className="p-1 text-ink-3">{t.columns.join(', ')}</td></tr>))}</tbody></table></div>
        </>
      )}
      <SalesCutover />
    </section>
  );
}

/** V41 단계 2 전환(T-1·T-3·T-5): 동결 시점 원본 건수 기록 → 정식 표 변환·대조 → (대표 결정 뒤) 쓰기 열기 */
function SalesCutover() {
  const st = useApi<{ cutovers: any[] }>('/api/platform/sales-cutover');
  const [busy, setBusy] = useState(false);
  const c = st.data?.cutovers.find((x) => x.tenant === 'default');
  async function run(action: string) {
    if (action === 'open' && !confirm('영업 쓰기를 엽니다. 원본 영업관리가 읽기 전용(동결)인지, 대표가 전환을 결정했는지 확인하셨나요?')) return;
    setBusy(true);
    try { const r = await api<any>('/api/platform/sales-cutover', { body: { action, tenant: 'default' } });
      toast.ok(action === 'snapshot' ? '동결 시점 원본 건수를 기록했습니다' : action === 'convert' ? (r.ok ? '대조 일치' : `대조 불일치 ${r.mismatches.length}건`) : action === 'open' ? '쓰기를 열었습니다' : '쓰기를 닫았습니다'); st.reload(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  return (
    <div className="mt-4 border-t border-line pt-3" data-testid="sales-cutover">
      <h3 className="text-sm font-semibold">전환(쓰기) — 우리 회사</h3>
      <p className="mt-1 text-xs text-ink-2">순서: 원본 영업관리 동결 → [동결 시점 원본 건수 기록] → [적용] → [변환·대조] → 일치하면 대표 결정 뒤 [쓰기 열기]. 대조 기준은 그때 원본의 실제 건수입니다.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => run('snapshot')} data-testid="cutover-snapshot">동결 시점 원본 건수 기록</Button>
        <Button size="sm" variant="secondary" disabled={busy || !c?.src_counts} onClick={() => run('convert')} data-testid="cutover-convert">변환·대조</Button>
        {c?.writes_open ? <Button size="sm" variant="secondary" disabled={busy} onClick={() => run('close')}>쓰기 닫기</Button>
          : <Button size="sm" disabled={busy || !c?.ok} onClick={() => run('open')} data-testid="cutover-open">쓰기 열기</Button>}
      </div>
      {c && <p className={cx('mt-2 text-xs', c.ok ? 'text-emerald-700' : 'text-amber-800')}>기준 기록 {c.frozen_at ? new Date(c.frozen_at).toLocaleString('ko-KR') : '—'} · 대조 {c.converted_at ? (c.ok ? '일치' : `불일치 ${c.mismatches?.length ?? 0}건`) : '안 함'} · 쓰기 {c.writes_open ? '열림' : '잠김'}</p>}
      {!!c?.mismatches?.length && <ul className="mt-1 space-y-0.5 text-xs text-red-700">{c.mismatches.map((m: any) => <li key={m.item}>{m.item}: 원본 {m.source ?? '없음'} · 옮김 {m.copied}{m.formal !== undefined ? ` · 정식 표 ${m.formal}` : ''}</li>)}</ul>}
    </div>
  );
}
