'use client';
import { useState } from 'react';
import { Button, cx, inputCls } from '@/components/ui';

type Band = { upTo: number; krw: number; storageGb: number; aiBudgetKrw: number };
type Lim = { bands: Band[]; overPerUserKrw?: number; overPerUserStorageGb?: number; overPerUserAiBudgetKrw?: number; salesPerUserKrw?: number | null; annualOffPct?: number } & Record<string, unknown>;
const small = cx(inputCls, 'h-8 w-20 px-2 py-1 text-xs');
const toNum = (v: string) => (v.trim() === '' ? NaN : Number(v.replace(/,/g, '')));

/** 355차 #939 ①② 플랫폼 운영 › 요금제: 구간 정액 요금제의 구간(인원 상한·월 금액·저장·회사 AI 예산 원) + 51인~ 1인 값. 저장하면 바로 결제 견적·한도에 반영(배포 없음) */
export function PlanBands({ plan, onSave }: { plan: { code: string; name: string; public: boolean; limits: Lim }; onSave: (body: unknown, done: () => void) => void }) {
  const lim = plan.limits;
  const init = () => ({ bands: lim.bands.map((b) => ({ upTo: String(b.upTo), krw: String(b.krw), storageGb: String(b.storageGb), aiBudgetKrw: String(b.aiBudgetKrw) })),
    over: String(lim.overPerUserKrw ?? ''), overGb: String(lim.overPerUserStorageGb ?? ''), overAi: String(lim.overPerUserAiBudgetKrw ?? ''), sales: lim.salesPerUserKrw ? String(lim.salesPerUserKrw) : '', annual: String(lim.annualOffPct ?? 20) });
  const [e, setE] = useState(init);
  const setBand = (i: number, k: keyof Band, v: string) => setE((x) => ({ ...x, bands: x.bands.map((b, j) => (j === i ? { ...b, [k]: v } : b)) }));
  const bands = e.bands.map((b) => ({ upTo: toNum(b.upTo), krw: toNum(b.krw), storageGb: toNum(b.storageGb), aiBudgetKrw: toNum(b.aiBudgetKrw) }));
  const bad = bands.some((b) => Object.values(b).some((v) => !Number.isFinite(v) || v < 0)) || [e.over, e.overGb, e.overAi, e.annual].some((v) => !Number.isFinite(toNum(v)));
  const save = () => onSave({ name: plan.name, monthlyKrw: bands[0]?.krw ?? null, perUserKrw: null, public: plan.public,
    limits: { users: null, storageGb: null, aiRequests: null, bands, overPerUserKrw: toNum(e.over), overPerUserStorageGb: toNum(e.overGb), overPerUserAiBudgetKrw: toNum(e.overAi),
      salesPerUserKrw: e.sales.trim() === '' ? null : toNum(e.sales), annualOffPct: toNum(e.annual) } }, () => {});
  return (
    <div className="space-y-1.5 rounded-input border border-line bg-slate-50 p-2 text-xs" data-testid={`plan-bands-edit-${plan.code}`}>
      <div className="font-medium text-ink-2">{plan.name} 구간 정액 — 활성 인원 기준(구간 안에서는 인원이 늘어도 같은 금액) · AI 예산(원)은 내부 기준, 고객 화면에는 %만</div>
      <div className="flex flex-wrap gap-2">
        {e.bands.map((b, i) => (
          <div key={i} className="flex items-center gap-1 rounded border border-line bg-white px-1.5 py-1">
            <span className="text-ink-3">~</span><input className={cx(small, 'w-12')} inputMode="numeric" value={b.upTo} onChange={(x) => setBand(i, 'upTo', x.target.value)} aria-label={`${plan.code} 구간 ${i + 1} 인원 상한`} /><span className="text-ink-3">인</span>
            <input className={small} inputMode="numeric" value={b.krw} onChange={(x) => setBand(i, 'krw', x.target.value)} aria-label={`${plan.code} 구간 ${i + 1} 월 금액`} /><span className="text-ink-3">원</span>
            <input className={cx(small, 'w-14')} inputMode="numeric" value={b.storageGb} onChange={(x) => setBand(i, 'storageGb', x.target.value)} aria-label={`${plan.code} 구간 ${i + 1} 저장GB`} /><span className="text-ink-3">GB</span>
            <input className={small} inputMode="numeric" value={b.aiBudgetKrw} onChange={(x) => setBand(i, 'aiBudgetKrw', x.target.value)} aria-label={`${plan.code} 구간 ${i + 1} 회사 AI 예산(원)`} /><span className="text-ink-3">AI원</span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-ink-3">넘으면 1인</span><input className={small} inputMode="numeric" value={e.over} onChange={(x) => setE({ ...e, over: x.target.value })} aria-label={`${plan.code} 넘으면 1인 금액`} /><span className="text-ink-3">원 ·</span>
        <input className={cx(small, 'w-14')} inputMode="numeric" value={e.overGb} onChange={(x) => setE({ ...e, overGb: x.target.value })} aria-label={`${plan.code} 넘으면 1인 저장GB`} /><span className="text-ink-3">GB ·</span>
        <input className={small} inputMode="numeric" value={e.overAi} onChange={(x) => setE({ ...e, overAi: x.target.value })} aria-label={`${plan.code} 넘으면 1인 AI 예산(원)`} /><span className="text-ink-3">AI원 · 영업 사용자 1인</span>
        <input className={small} inputMode="numeric" value={e.sales} placeholder="없음" onChange={(x) => setE({ ...e, sales: x.target.value })} aria-label={`${plan.code} 영업 사용자 1인 추가 금액`} /><span className="text-ink-3">원 · 연간 할인</span>
        <input className={cx(small, 'w-12')} inputMode="numeric" value={e.annual} onChange={(x) => setE({ ...e, annual: x.target.value })} aria-label={`${plan.code} 연간 할인 %`} /><span className="text-ink-3">%</span>
        <Button size="sm" variant="secondary" disabled={bad} onClick={save} data-testid={`plan-bands-save-${plan.code}`}>구간 저장</Button>
      </div>
    </div>
  );
}
