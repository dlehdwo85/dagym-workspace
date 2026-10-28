'use client';
import { useState } from 'react';
import { api } from '@/components/client';
import { Button, cx, inputCls, toast } from '@/components/ui';

/** #754(대표 10/28 '다짐과 DAGYM 은 같은 브랜드'): 이 브랜드를 다른 브랜드로 합치기 — 시안·콘텐츠·광고 연결·목표·주간 규칙을 옮기고 이 브랜드 이름은 남길 브랜드의 '찾는 낱말'로. 되돌리기 없음 */
export function BrandMerge({ brand, brands, onDone }: { brand: { id: string; name: string }; brands: { id: string; name: string }[]; onDone: () => void }) {
  const [into, setInto] = useState(''); const [busy, setBusy] = useState(false);
  const others = brands.filter((b) => b.id !== brand.id);
  if (!others.length) return null;
  async function go() {
    const t = others.find((b) => b.id === into); if (!t) return;
    if (!confirm(`'${brand.name}' 브랜드를 '${t.name}' 브랜드로 합칠까요?\n\n'${brand.name}'의 시안·콘텐츠·광고 계정·캠페인 연결·광고 계획·목표·주간 규칙이 '${t.name}'(으)로 옮겨지고 '${brand.name}' 브랜드는 지워집니다. '${brand.name}'은 '${t.name}'의 찾는 낱말이 되어, 광고 캠페인 이름에 있으면 '${t.name}'(으)로 셉니다. 되돌릴 수 없습니다.`)) return;
    setBusy(true);
    try {
      const r = await api<{ moved: Record<string, number> }>(`/api/marketing/auto/brands/${brand.id}/merge`, { body: { into } });
      const n = Object.values(r.moved ?? {}).reduce((a, b) => a + b, 0);
      toast.ok(`'${brand.name}' 브랜드를 '${t.name}'(으)로 합쳤습니다 — 옮긴 항목 ${n}건`); onDone();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  return (
    <details className="text-xs sm:col-span-4 sm:pl-[8.5rem]" data-testid={`brand-merge-${brand.name}`}>
      <summary className="cursor-pointer text-ink-3">같은 브랜드면 합치기</summary>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <span>이 브랜드를</span>
        <select className={cx(inputCls, 'h-8 w-auto py-0 text-xs')} value={into} onChange={(e) => setInto(e.target.value)} aria-label={`${brand.name} 합칠 브랜드`}>
          <option value="">남길 브랜드 고르기</option>{others.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <span>(으)로</span>
        <Button type="button" size="sm" variant="secondary" disabled={!into || busy} onClick={go} data-testid="brand-merge-go">합치기</Button>
      </div>
    </details>
  );
}
