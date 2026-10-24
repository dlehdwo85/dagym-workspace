'use client';
import { useEffect, useState } from 'react';
import { api, useApi } from '@/components/client';
import { Button, ErrorBox, Skeleton, cx, inputCls, toast } from '@/components/ui';

type Plan = { code: string; label: string; price: number | null; weekly: Record<string, number>; monthlyCredits: number; videoMonthly: number; regenMonthly: number; aiMonthlyUsd: number | null; extraCreditKrw: number | null; costMin: number; costMax: number; rateMin: number | null; rateMax: number | null; images: number; videos: number; writeTier: Tier | null };
type Tier = 'fast' | 'default' | 'deep';
const TIER: Record<Tier, string> = { fast: '빠른 모델', default: '표준 모델', deep: '최상 모델' };
type Cost = { imageCredits: number; videoCredits: number; krwPerCreditMin: number; krwPerCreditMax: number };
const KINDS: [string, string][] = [['feed', '피드'], ['blog', '블로그'], ['reels', '릴스'], ['shorts', '쇼츠'], ['story', '스토리']];
const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`;
/** 대표 10/20 15:40 (#103): 요금제별 마케팅 제작 범위·금액 — 숫자만 바꾸면 바로 적용(배포 없음). 실측 원가로 한도별 원가율 */
export function PlatformMktPlans() {
  const { data, error, reload, setData } = useApi<{ plans: Plan[]; cost: Cost; writeCost?: Record<Tier, number> }>('/api/platform/mkt-plans');
  const [ed, setEd] = useState<Record<string, Record<string, string>>>({}); const [cost, setCost] = useState<Record<string, string>>({}); const [busy, setBusy] = useState('');
  useEffect(() => { if (data) setCost({ imageCredits: String(data.cost.imageCredits), videoCredits: String(data.cost.videoCredits), krwPerCreditMin: String(data.cost.krwPerCreditMin), krwPerCreditMax: String(data.cost.krwPerCreditMax) }); }, [data]);
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Skeleton rows={3} />;
  const val = (p: Plan, k: string, base: string | number | null | undefined) => ed[p.code]?.[k] ?? (base === null || base === undefined ? '' : String(base));
  const set = (code: string, k: string, v: string) => setEd((x) => ({ ...x, [code]: { ...(x[code] ?? {}), [k]: v } }));
  const n = (v: string) => (v.trim() === '' ? null : Number(v));
  async function save(p: Plan) {
    setBusy(p.code);
    try {
      const weekly = Object.fromEntries(KINDS.map(([k]) => [k, Number(val(p, `w:${k}`, p.weekly[k] ?? 0)) || 0]));
      const out = await api<{ plans: Plan[]; cost: Cost }>('/api/platform/mkt-plans', { method: 'PUT', body: { plan: { code: p.code, label: val(p, 'label', p.label) || p.label, priceKrw: n(val(p, 'price', p.price)), monthlyCredits: Number(val(p, 'monthlyCredits', p.monthlyCredits)), weekly, videoMonthly: Number(val(p, 'videoMonthly', p.videoMonthly)), regenMonthly: Number(val(p, 'regenMonthly', p.regenMonthly)), aiMonthlyUsd: n(val(p, 'aiMonthlyUsd', p.aiMonthlyUsd)), writeTier: (val(p, 'writeTier', p.writeTier) || null) as Tier | null, extraCreditKrw: n(val(p, 'extraCreditKrw', p.extraCreditKrw)) } } });
      setData(out); setEd((x) => ({ ...x, [p.code]: {} })); toast.ok(`${p.label} 저장 — 고객 화면에 바로 적용`);
    } catch (er: any) { toast.error(er.message); } finally { setBusy(''); }
  }
  async function saveCost() {
    setBusy('cost');
    try { const out = await api<{ plans: Plan[]; cost: Cost }>('/api/platform/mkt-plans', { method: 'PUT', body: { cost: { imageCredits: Number(cost.imageCredits), videoCredits: Number(cost.videoCredits), krwPerCreditMin: Number(cost.krwPerCreditMin), krwPerCreditMax: Number(cost.krwPerCreditMax) } } }); setData(out); toast.ok('원가 기준 저장'); }
    catch (er: any) { toast.error(er.message); } finally { setBusy(''); }
  }
  const num = (p: Plan, k: string, base: number | null | undefined, w = 'w-20') => <input className={cx(inputCls, 'h-7 py-0.5 text-right text-xs', w)} type="number" value={val(p, k, base)} onChange={(e) => set(p.code, k, e.target.value)} aria-label={`${p.label} ${k}`} data-testid={`mkt-plan-${p.code}-${k}`} />;
  return (
    <section className="rounded-card border border-line bg-white p-4 shadow-card" data-testid="platform-mkt-plans">
      <h2 className="text-sm font-semibold">마케팅 요금제 — 제작 가능 범위·한도별 금액(#103)</h2>
      <p className="mt-1 text-xs text-ink-2">글 모델 = 자동 제작 원고·수정본·블로그를 쓰는 AI(품질 검사는 빠른 모델 그대로) — 회사 관리에서 회사별로 따로 정한 값이 먼저입니다. 숫자만 바꾸고 [저장]하면 고객 화면(자동 제작 › 요금제·한도, 홈 ‘이번 달 남은 제작’)에 바로 적용됩니다. 가격·초과 크레딧 금액을 비우면 ‘결정 전’. 원가율 = 월 크레딧 × 1크레딧 원화 ÷ 월 요금.</p>
      <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[1100px] text-xs" data-testid="mkt-plan-table">
        <thead><tr className="text-left text-ink-3"><th className="py-1">요금제</th><th>월 요금(원)</th><th>월 크레딧</th>{KINDS.map(([, l]) => <th key={l}>주 {l}</th>)}<th>생성 영상/월</th><th>재생성/월</th><th>AI $/월</th><th>글 모델</th><th>초과 1크레딧(원)</th><th>환산</th><th>월 원가·원가율</th><th></th></tr></thead>
        <tbody>{data.plans.map((p) => (
          <tr key={p.code} className="border-t border-line align-top" data-testid={`mkt-plan-row-${p.code}`}>
            <td className="py-1.5 pr-2"><input className={cx(inputCls, 'h-7 w-24 py-0.5 text-xs')} value={val(p, 'label', p.label)} onChange={(e) => set(p.code, 'label', e.target.value)} aria-label={`${p.code} 이름`} /><div className="text-ink-3">{p.code}</div></td>
            <td>{num(p, 'price', p.price, 'w-24')}</td><td>{num(p, 'monthlyCredits', p.monthlyCredits)}</td>
            {KINDS.map(([k]) => <td key={k}>{num(p, `w:${k}`, p.weekly[k] ?? 0, 'w-14')}</td>)}
            <td>{num(p, 'videoMonthly', p.videoMonthly, 'w-16')}</td><td>{num(p, 'regenMonthly', p.regenMonthly, 'w-16')}</td><td>{num(p, 'aiMonthlyUsd', p.aiMonthlyUsd, 'w-16')}</td>
            <td>{/* 대표 10/24 추가 ①: 자동 제작 글(원고·수정본·블로그) 모델 — 비우면 빠른 모델 */}
              <select className={cx(inputCls, 'h-7 w-28 py-0.5 text-xs')} value={val(p, 'writeTier', p.writeTier)} onChange={(e) => set(p.code, 'writeTier', e.target.value)} aria-label={`${p.label} 글 모델`} data-testid={`mkt-plan-${p.code}-writeTier`}>
                <option value="">{TIER.fast}</option><option value="default">{TIER.default}</option><option value="deep">{TIER.deep}</option></select>
              {data.writeCost && <div className="text-ink-3">글 1건 약 {data.writeCost[(val(p, 'writeTier', p.writeTier) || 'fast') as Tier].toLocaleString('ko-KR')}원</div>}</td>
            <td>{num(p, 'extraCreditKrw', p.extraCreditKrw, 'w-20')}</td>
            <td className="whitespace-nowrap text-ink-2">이미지 {p.images}장<br />또는 영상 {p.videos}편</td>
            <td className="whitespace-nowrap text-ink-2" data-testid={`mkt-plan-rate-${p.code}`}>{won(p.costMin)}~{won(p.costMax)}<br />{p.price ? <b className={p.rateMax !== null && p.rateMax > 40 ? 'text-red-700' : 'text-emerald-700'}>원가율 {p.rateMin}~{p.rateMax}%</b> : <span className="text-ink-3">가격 결정 전</span>}</td>
            <td><Button size="sm" variant="secondary" disabled={busy === p.code} onClick={() => save(p)} data-testid={`mkt-plan-save-${p.code}`}>저장</Button></td>
          </tr>))}</tbody></table></div>
      <div className="mt-3 flex flex-wrap items-end gap-2 text-xs" data-testid="mkt-credit-cost">
        <span className="font-medium">실측 원가 기준</span>
        {([['imageCredits', '이미지 1장 크레딧'], ['videoCredits', '영상 1편 크레딧'], ['krwPerCreditMin', '1크레딧 최소(원)'], ['krwPerCreditMax', '1크레딧 최대(원)']] as [string, string][]).map(([k, l]) => (
          <label key={k} className="grid gap-0.5"><span className="text-ink-2">{l}</span><input className={cx(inputCls, 'h-7 w-28 py-0.5 text-right text-xs')} type="number" value={cost[k] ?? ''} onChange={(e) => setCost({ ...cost, [k]: e.target.value })} aria-label={l} /></label>))}
        <Button size="sm" variant="secondary" disabled={busy === 'cost'} onClick={saveCost} data-testid="mkt-credit-cost-save">원가 저장</Button>
      </div>
    </section>
  );
}
