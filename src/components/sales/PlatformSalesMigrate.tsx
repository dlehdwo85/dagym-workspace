'use client';
import { useState } from 'react';
import { api } from '@/components/client';
import { Button, cx, toast } from '@/components/ui';

type T = { name: string; count: number | null; expected: number | null; columns: string[]; skip: boolean; error: string | null };

/** V41 단계 2 영업관리 이전(플랫폼 운영자): [미리보기] = 원본 표·건수·칸 이름(저장 없음). V39 E 검수 숫자와 대조 */
export function PlatformSalesMigrate() {
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState<{ at: string; tables: T[]; related: number | null; relatedExpected: number } | null>(null);
  async function preview() {
    setBusy(true);
    try { setR(await api('/api/platform/sales-migrate', { body: {} })); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  const mism = r?.tables.filter((t) => t.expected !== null && t.count !== t.expected).length ?? 0;
  return (
    <section className="rounded-card border border-line bg-white p-4 shadow-card" data-testid="platform-sales-migrate">
      <h2 className="text-sm font-semibold">영업관리 → 워크인 이전(V41 단계 2)</h2>
      <p className="mt-1 text-xs text-ink-2">원본(Supabase, SALES_SRC_URL·SALES_SRC_SERVICE_KEY)은 읽기만 합니다. [미리보기]는 표마다 건수·칸 이름을 보여 주고 아무것도 저장하지 않습니다. 검수 숫자(V39 E)와 맞으면 대표 확인 뒤 적용 단계로.</p>
      <Button size="sm" className="mt-2" onClick={preview} disabled={busy} data-testid="sales-migrate-preview">{busy ? '읽는 중…' : '미리보기'}</Button>
      {r && (
        <>
          <p className={cx('mt-2 text-xs', mism ? 'text-amber-800' : 'text-emerald-700')}>표 {r.tables.length}개 · 검수 숫자와 다른 표 {mism}개 · 관련 공고 {r.related ?? '—'}건(기준 {r.relatedExpected})</p>
          <div className="mt-1 max-h-96 overflow-auto"><table className="w-full min-w-[760px] text-xs"><thead className="sticky top-0 bg-white text-left text-ink-2"><tr><th className="p-1">표</th><th className="p-1 text-right">원본 건수</th><th className="p-1 text-right">검수 기준</th><th className="p-1">칸 이름</th></tr></thead>
            <tbody>{r.tables.map((t) => (
              <tr key={t.name} className={cx('border-t border-line', t.skip && 'opacity-50')} data-testid="sales-migrate-row"><td className="p-1 font-mono">{t.name}{t.skip && ' (옮기지 않음)'}</td>
                <td className={cx('p-1 text-right tabular-nums', t.expected !== null && t.count !== t.expected && 'font-semibold text-red-700')}>{t.error ? <span className="text-red-700">{t.error}</span> : t.count ?? '—'}</td>
                <td className="p-1 text-right tabular-nums text-ink-3">{t.expected ?? ''}</td><td className="p-1 text-ink-3">{t.columns.join(', ')}</td></tr>))}</tbody></table></div>
        </>
      )}
    </section>
  );
}
