'use client';
import { Sparkles } from 'lucide-react';
import { cx } from './ui';

/** #412: 업무 AI 비서 · 영업 AI 세일즈 · 마케팅 AI 마케터 — 이번 달 한도 → 쓴 양 → 남은 양 한 표(체감 단위 병기) + 요금제별 기준표. 데이터는 서버 aiLimits.ts 하나 */
type Feel = { label: string; n: number | null; unit: string; per: string };
type Row = { key: 'work' | 'sales' | 'marketing'; name: string; shared: boolean; planLabel: string | null; limit: { requests: number | null; usd: number | null; credits?: number | null; videos?: number | null };
  used: { requests: number; usd: number | null; credits?: number; videos?: number }; left: { requests: number | null; usd: number | null; credits?: number | null; videos?: number | null }; pct: number | null; feel: Feel[]; note: string;
  feelLimit?: number | null; feelUsed?: number | null /* 서버가 환산(#602: 고객사 응답엔 달러가 없음) */ };
export type AiLimitsData = { month: string; usdKrw: number; rows: Row[]; pool: { requests: { limit: number | null; used: number; left: number | null }; usd: { limit: number | null; used: number; left: number | null } }; plans: PlanMatrix };
export type PlanMatrix = { plans: { code: string; name: string; perUserKrw: number | null; monthlyKrw: number | null; minUsers: number | null; work: { perUserAi: number | null; aiRequests: number | null; feelPerUser: Feel[]; budgetKrw?: number | null; perUserBudgetKrw?: number | null };
  marketing: { label: string; price: number | null; monthlyCredits: number; aiMonthlyUsd: number | null; aiMonthlyKrw?: number | null; videoMonthly: number; images: number; videos: number } | null }[];
  packs: { code: string; name: string; monthlyKrw: number; aiRequests: number; aiBudgetKrw?: number | null }[]; usdKrw: number; note: string };

const n = (v: number | null | undefined) => (v === null || v === undefined ? null : v.toLocaleString('ko-KR'));
const won = (usd: number | null, rate: number) => (usd === null ? null : `약 ${Math.round(usd * rate).toLocaleString('ko-KR')}원`);
const COLOR: Record<Row['key'], string> = { work: 'bg-brand-600', sales: 'bg-sky-600', marketing: 'bg-violet-600' };
const tone = (p: number | null) => (p === null ? 'text-ink-3' : p >= 100 ? 'text-red-600' : p >= 80 ? 'text-amber-700' : 'text-ink-2');

function Amount({ r, k }: { r: Row; k: 'limit' | 'used' | 'left' }) {
  const v = r[k] as Row['limit'] & Row['used'];
  const parts: string[] = [];
  if (r.key === 'marketing') {
    if (v.credits !== undefined) parts.push(v.credits === null ? '크레딧 무제한' : `${n(v.credits)}크레딧`);
    if (v.videos !== undefined && v.videos !== null) parts.push(`영상 ${n(v.videos)}편`);
    if (v.usd !== null && v.usd !== undefined) parts.push(`AI $${v.usd}`);
  } else {
    // 대표 10/21 22:00 ③(#416): 금액($·원) 대신 'AI 로 할 수 있는 작업 횟수' 로 — 요청 횟수를 앞세우고, 횟수 한도가 없으면 남은 금액을 체감 단위(질문·답변 n회)로 환산해 보여 준다(오른쪽 칸)
    parts.push(v.requests === null || v.requests === undefined ? (k === 'limit' ? '횟수 제한 없음' : '-') : `${n(v.requests)}회`);
  }
  return <span className="tabular-nums">{parts.filter((x) => x !== '-').join(' · ') || '-'}</span>;
}

export function AiLimitsTable({ data }: { data: AiLimitsData }) {
  return (
    <section className="rounded-card border border-line bg-white p-4 shadow-card" data-testid="ai-limits">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold"><Sparkles className="size-4 text-violet-600" />AI 한도 한눈에 <span className="font-normal text-ink-3">— {data.month}</span></h2>
        <span className="text-xs text-ink-3">금액 대신 AI 로 할 수 있는 작업 횟수로 표시합니다 · 환산은 최근 평균 단가 기준(대략)</span>
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead><tr className="text-left text-xs text-ink-3"><th className="py-1">AI</th><th>이번 달 한도</th><th>쓴 양</th><th>남은 양</th><th>남은 양으로 할 수 있는 작업</th></tr></thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.key} className="border-t border-line align-top" data-testid={`ai-limit-${r.key}`}>
                <td className="py-2 pr-2">
                  <div className="flex items-center gap-1.5 font-medium"><i className={cx('inline-block size-2 rounded-full', COLOR[r.key])} />{r.name}{r.planLabel && <span className="rounded bg-violet-50 px-1 text-[11px] font-normal text-violet-800">{r.planLabel}</span>}</div>
                  <div className="text-[11px] text-ink-3">{r.note}</div>
                </td>
                <td className="py-2 pr-2" title={r.limit.usd !== null && r.key !== 'marketing' ? `원가 한도 $${r.limit.usd} (${won(r.limit.usd, data.usdKrw)})` : undefined}><Amount r={r} k="limit" />{r.key !== 'marketing' && r.limit.requests === null && r.feel[0] && (r.feel[0].n === null || r.feelLimit != null) && <div className="text-[11px] text-ink-3">{r.feel[0].label} 약 {r.feel[0].n === null ? '무제한' : n(r.feelLimit)}{r.feel[0].n === null ? '' : r.feel[0].unit}</div>}</td>
                <td className="py-2 pr-2" title={r.used.usd !== null ? `원가 $${r.used.usd} (${won(r.used.usd, data.usdKrw)})` : undefined}><Amount r={r} k="used" />{r.key !== 'marketing' && r.feel[0] && r.feelUsed != null && <div className="text-[11px] text-ink-3">{r.feel[0].label} 약 {n(r.feelUsed)}{r.feel[0].unit}</div>}</td>
                <td className="py-2 pr-2" data-testid={`ai-left-${r.key}`}>
                  <span className={cx('font-semibold', tone(r.pct))}><Amount r={r} k="left" /></span>
                  <div className={cx('text-[11px]', tone(r.pct))} title={r.left.usd !== null && r.key !== 'marketing' ? `남은 원가 ${won(r.left.usd, data.usdKrw)}` : undefined}>{r.pct === null ? '무제한' : `${r.pct}% 사용`}</div>
                  {r.pct !== null && <div className="mt-1 h-1.5 w-24 overflow-hidden rounded-full bg-slate-100"><div className={cx('h-full rounded-full', r.pct >= 100 ? 'bg-red-500' : r.pct >= 80 ? 'bg-amber-500' : COLOR[r.key])} style={{ width: `${Math.min(100, r.pct)}%` }} /></div>}
                </td>
                <td className="py-2 text-xs text-ink-2">
                  {r.feel.map((f) => <div key={f.label} title={f.per}>{f.label} <b className="tabular-nums">{f.n === null ? '무제한' : `약 ${n(f.n)}${f.unit}`}</b>{f.per && <span className="text-ink-3"> ({f.per})</span>}</div>)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** 요금제별 기준표 — 요금 안내·소개 사이트(/api/public/ai-plans)와 같은 데이터 */
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
                <td className="py-1.5 pr-2">
                  {/* 대표 10/24 ②: 원 예산 요금제는 '1인 월 n원분(회사 합산)' + 체감 횟수 */}
                  {p.work.perUserBudgetKrw != null ? <>1인 월 <b>{p.work.perUserBudgetKrw.toLocaleString('ko-KR')}원분</b>(회사 합산)</> : p.work.budgetKrw != null ? <>회사 월 <b>{p.work.budgetKrw.toLocaleString('ko-KR')}원분</b></>
                    : p.work.perUserAi !== null ? <>1인당 월 <b>{p.work.perUserAi}회</b>(회사 합산)</> : p.work.aiRequests !== null ? <>회사 월 <b>{p.work.aiRequests}회</b></> : '무제한'}
                  {p.work.feelPerUser.length > 0 && <div className="text-[11px] text-ink-3">{p.work.feelPerUser.map((f) => `${f.label} 약 ${f.n}${f.unit}`).join(' · ')}</div>}
                </td>
                <td className="py-1.5 pr-2 text-ink-2">회사 공유<div className="text-[11px] text-ink-3">업무 AI 와 같은 한도</div></td>
                <td className="py-1.5">
                  {p.marketing ? <>{p.marketing.label} · 월 <b>{p.marketing.monthlyCredits}크레딧</b>{p.marketing.aiMonthlyUsd !== null ? ` · AI $${p.marketing.aiMonthlyUsd}` : p.marketing.aiMonthlyKrw != null ? ` · AI 약 ${p.marketing.aiMonthlyKrw.toLocaleString('ko-KR')}원분` : ''}
                    <div className="text-[11px] text-ink-3">시안 약 {p.marketing.images}장 또는 영상 {p.marketing.videos}편 · 생성 영상 월 {p.marketing.videoMonthly}편{showPrice && (p.marketing.price ? ` · 월 ${p.marketing.price.toLocaleString('ko-KR')}원` : ' · 금액 결정 전')}</div></>
                    : <span className="text-ink-3">마케팅 요금제 없음</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!!matrix.packs.length && <p className="mt-2 text-xs text-ink-2">AI 크레딧 팩(회사 단위, 업무·영업·마케팅 공유): {matrix.packs.map((a) => `${a.name} +${a.aiBudgetKrw != null ? `${a.aiBudgetKrw.toLocaleString('ko-KR')}원분` : `${a.aiRequests}회`}${showPrice ? ` 월 ${a.monthlyKrw.toLocaleString('ko-KR')}원` : ''}`).join(' · ')}</p>}
      <p className="mt-1 text-[11px] text-ink-3">{matrix.note}</p>
    </section>
  );
}
