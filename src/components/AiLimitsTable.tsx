'use client';
import { Sparkles } from 'lucide-react';
import { cx } from './ui';
import { useInApp } from './inApp';

/** #412 → 351차 #939 ③(대표 11/04): 업무 AI 비서 · 영업 AI 세일즈 · 마케팅 AI 마케터 — 이번 달 쓴 양·남은 양을 %로만(원·회·크레딧 숫자 없음, 원 금액은 /platform) + 요금제별 기준표. 데이터는 서버 aiLimits.ts 하나 */
type Feel = { label: string; n: number | null; unit: string; per: string };
type Row = { key: 'work' | 'sales' | 'marketing'; name: string; shared: boolean; planLabel: string | null; limit: { requests: number | null; usd: number | null; credits?: number | null; videos?: number | null };
  used: { requests: number; usd: number | null; credits?: number; videos?: number }; left: { requests: number | null; usd: number | null; credits?: number | null; videos?: number | null }; pct: number | null; feel: Feel[]; note: string;
  feelLimit?: number | null; feelUsed?: number | null /* 서버가 환산(#602: 고객사 응답엔 달러가 없음) */ };
export type AiLimitsData = { month: string; usdKrw: number; rows: Row[]; pool: { requests: { limit: number | null; used: number; left: number | null }; usd: { limit: number | null; used: number; left: number | null } }; plans: PlanMatrix };
export type PlanMatrix = { plans: { code: string; name: string; perUserKrw: number | null; monthlyKrw: number | null; minUsers: number | null; work: { perUserAi: number | null; aiRequests: number | null; feelPerUser: Feel[]; budgetKrw?: number | null; perUserBudgetKrw?: number | null };
  marketing: { label: string; price: number | null; monthlyCredits: number; aiMonthlyUsd: number | null; aiMonthlyKrw?: number | null; videoMonthly: number; images: number; videos: number } | null }[];
  packs: { code: string; name: string; monthlyKrw: number; aiRequests: number; aiBudgetKrw?: number | null }[]; usdKrw: number; note: string };

const COLOR: Record<Row['key'], string> = { work: 'bg-brand-600', sales: 'bg-sky-600', marketing: 'bg-violet-600' };
const tone = (p: number | null) => (p === null ? 'text-ink-3' : p >= 100 ? 'text-red-600' : p >= 80 ? 'text-amber-700' : 'text-ink-2');
const left = (p: number) => Math.max(0, 100 - Math.min(100, p));

export function AiLimitsTable({ data }: { data: AiLimitsData }) {
  const inApp = useInApp(); // #839·298차 #861·351차 #942: 앱(아이폰·안드로이드) 안에서는 '요금제' 설명 줄·요금제 이름표 없음
  return (
    <section className="rounded-card border border-line bg-white p-4 shadow-card" data-testid="ai-limits">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold"><Sparkles className="size-4 text-violet-600" />AI 한도 한눈에 <span className="font-normal text-ink-3">— {data.month}</span></h2>
        <span className="text-xs text-ink-3">이번 달 쓴 양·남은 양을 %로 표시합니다</span>
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[480px] text-sm">
          <thead><tr className="text-left text-xs text-ink-3"><th className="py-1">AI</th><th>이번 달 쓴 양</th><th>남은 양</th></tr></thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.key} className="border-t border-line align-top" data-testid={`ai-limit-${r.key}`}>
                <td className="py-2 pr-2">
                  <div className="flex items-center gap-1.5 font-medium"><i className={cx('inline-block size-2 rounded-full', COLOR[r.key])} />{r.name}{!inApp && r.planLabel && <span className="rounded bg-violet-50 px-1 text-[11px] font-normal text-violet-800">{r.planLabel}</span>}</div>
                  {!(inApp && /요금제/.test(r.note)) && <div className="text-[11px] text-ink-3">{r.note}</div>}
                </td>
                <td className="py-2 pr-2">
                  <span className={cx('font-semibold tabular-nums', tone(r.pct))}>{r.pct === null ? '제한 없음' : `${r.pct}%`}</span>
                  {r.pct !== null && <div className="mt-1 h-1.5 w-24 overflow-hidden rounded-full bg-slate-100"><div className={cx('h-full rounded-full', r.pct >= 100 ? 'bg-red-500' : r.pct >= 80 ? 'bg-amber-500' : COLOR[r.key])} style={{ width: `${Math.min(100, r.pct)}%` }} /></div>}
                </td>
                <td className="py-2 pr-2" data-testid={`ai-left-${r.key}`}>
                  <span className={cx('font-semibold tabular-nums', tone(r.pct))}>{r.pct === null ? '제한 없음' : `${left(r.pct)}%`}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** 요금제별 기준표 — 요금 안내·소개 사이트(/api/public/ai-plans)와 같은 데이터 · 351차 #939 ③: AI 칸은 원분·회 없이 */
export function AiPlanMatrix({ matrix, currentCode, showPrice = true }: { matrix: PlanMatrix; currentCode?: string | null; showPrice?: boolean }) {
  return (
    <section className="rounded-card border border-line bg-white p-4 shadow-card" data-testid="ai-plan-matrix">
      <h2 className="text-sm font-semibold">요금제별 AI 한도 기준표 <span className="font-normal text-ink-3">— 업무·영업·마케팅</span></h2>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead><tr className="text-left text-xs text-ink-3"><th className="py-1">요금제</th><th>업무 AI 비서</th><th>영업 AI 세일즈</th><th>마케팅 AI 마케터</th></tr></thead>
          <tbody>
            {matrix.plans.map((p) => (
              <tr key={p.code} className={cx('border-t border-line align-top', p.code === currentCode && 'bg-brand-50')} data-testid={`ai-plan-${p.code}`}>
                <td className="py-1.5 pr-2"><div className={cx(p.code === currentCode && 'font-semibold')}>{p.name}</div>{showPrice && <div className="text-[11px] text-ink-3">{p.perUserKrw ? `1인 월 ${p.perUserKrw.toLocaleString('ko-KR')}원` : p.monthlyKrw === 0 || p.monthlyKrw === null ? '무료' : `월 ${p.monthlyKrw.toLocaleString('ko-KR')}원`}</div>}</td>
                <td className="py-1.5 pr-2">회사 공유 AI 포함<div className="text-[11px] text-ink-3">업무·영업·마케팅 글 AI 가 함께 씀 · 쓴 양은 %로</div></td>
                <td className="py-1.5 pr-2 text-ink-2">회사 공유<div className="text-[11px] text-ink-3">업무 AI 와 같은 한도</div></td>
                <td className="py-1.5">
                  {p.marketing ? <>{p.marketing.label} · 월 제작 크레딧 포함
                    <div className="text-[11px] text-ink-3">시안 약 {p.marketing.images}장 또는 영상 {p.marketing.videos}편 · 생성 영상 월 {p.marketing.videoMonthly}편{showPrice && (p.marketing.price ? ` · 월 ${p.marketing.price.toLocaleString('ko-KR')}원` : ' · 금액 결정 전')}</div></>
                    : <span className="text-ink-3">마케팅 요금제 없음</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!!matrix.packs.length && <p className="mt-2 text-xs text-ink-2">AI 크레딧 팩(회사 단위, 업무·영업·마케팅 공유): {matrix.packs.map((a) => `${a.name}${showPrice ? ` 월 ${a.monthlyKrw.toLocaleString('ko-KR')}원` : ''}`).join(' · ')}</p>}
      <p className="mt-1 text-[11px] text-ink-3">{matrix.note}</p>
    </section>
  );
}
