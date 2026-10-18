'use client';
import { useState } from 'react';
import { api, useApi } from './client';
import { Button, cx, fmtDateTime, inputCls, toast } from './ui';

const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`;
const usd = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const PURPOSE: Record<string, string> = { marketing_produce: '마케팅 원고 1건', marketing_caption: '마케팅 캡션 1건', assistant: '대화 1건', doc_job: '문서 1건', doc_engine: '문서 엔진', library_organize: '자료 정리 1건', revenue: '매출 분석 1건', revenue_extract: '매출 입력 1건',
  voice: '음성 보정 1건', classify: '질문 분류 1건', summary: '대화 요약 1건', fill: '자료로 채우기 1건', chat_to_task: '메시지→업무 1건' };

/** V23 5장: 플랫폼 운영자 "AI 원가 전망" — 이번 달 예상·단가 실측·사용자 유형·소진 예상일·무료 운영 가능 업체 수·충전 권장액·요금 역산·콘솔 대조 */
export function AiForecast() {
  const { data, reload } = useApi<any>('/api/platform/ai-forecast');
  const [edit, setEdit] = useState<Record<string, string> | null>(null);
  if (!data) return null;
  const f = data.finance;
  async function save() {
    const num = (v?: string) => (v === undefined || v === '' ? undefined : Number(v));
    try {
      await api('/api/platform/ai-forecast', { method: 'PUT', body: { securedUsd: num(edit!.securedUsd), nextSecuredUsd: num(edit!.nextSecuredUsd), consoleUsd: edit!.consoleUsd === '' ? null : num(edit!.consoleUsd),
        companySize: num(edit!.companySize), aiShare: edit!.aiShare === '' ? undefined : Number(edit!.aiShare) / 100, cycleStart: edit!.cycleStart ? edit!.cycleStart : null } });
      setEdit(null); reload(); toast.ok('저장했습니다');
    } catch (e: any) { toast.error(e.message); }
  }
  const Stat = ({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) => (
    <div className={cx('rounded-input border px-3 py-2', warn ? 'border-red-200 bg-red-50' : 'border-line')}><div className="text-[11px] text-ink-3">{label}</div><div className="text-base font-bold tabular-nums">{value}</div>{sub && <div className="text-[11px] text-ink-3">{sub}</div>}</div>
  );
  return (
    <section id="ai-forecast" className="rounded-card border border-line bg-white p-3 shadow-card" data-testid="ai-forecast">
      <h2 className="flex items-center text-sm font-semibold">AI 원가 전망 <span className="ml-1 text-xs font-normal text-ink-3">{data.month} · {data.elapsed}/{data.days}일 · 정가(건별 결제 가정) · 환율 {data.rate.toLocaleString('ko-KR')}원</span>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setEdit({ securedUsd: String(f.securedUsd), nextSecuredUsd: String(f.nextSecuredUsd), consoleUsd: f.consoleUsd === null ? '' : String(f.consoleUsd), companySize: String(f.companySize), aiShare: String(Math.round(f.aiShare * 100)), cycleStart: f.cycleStart ?? '' })} data-testid="ai-finance-edit">기준 입력</Button></h2>
      {edit && (
        <div className="mt-2 grid grid-cols-2 gap-2 rounded-input bg-slate-50 p-2 text-xs sm:grid-cols-7" data-testid="ai-finance-form">
          {([['cycleStart', '크레딧 주기 시작일(YYYY-MM-DD, 비우면 달력 월)'], ['securedUsd', '이번 주기 확보 크레딧($)'], ['nextSecuredUsd', '다음 주기 확보($)'], ['consoleUsd', '콘솔 실제 청구($)'], ['companySize', '고객사 1곳 인원'], ['aiShare', '요금 중 AI 몫(%)']] as const).map(([k, l]) => (
            <label key={k} className="block">{l}<input className={cx(inputCls, 'mt-0.5 h-8')} inputMode="decimal" value={edit[k] ?? ''} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} aria-label={l} /></label>
          ))}
          <div className="flex items-end gap-1"><Button size="sm" onClick={save}>저장</Button><Button size="sm" variant="ghost" onClick={() => setEdit(null)}>취소</Button></div>
        </div>
      )}
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="이번 주기 누적" value={won(data.monthKrw)} sub={`${usd(data.monthUsd)} · 확보 ${usd(f.securedUsd)}의 ${data.usedPct ?? '-'}%`} warn={(data.usedPct ?? 0) >= 90} />
        <Stat label="이번 주기 예상(누적÷경과일×일수)" value={won(data.forecastKrw)} sub={usd(data.forecastUsd)} warn={data.forecastUsd > f.securedUsd * 0.7} />
        <Stat label="크레딧 소진 예상일(최근 7일 평균)" value={data.exhaustDate ?? '이번 주기 안 소진 없음'} sub={`하루 ${usd(data.dailyUsd)}`} warn={!!data.exhaustDate} />
        <Stat label="다음 달 충전 권장(예상×1.2 − 확보)" value={data.rechargeUsd > 0 ? won(data.rechargeKrw) : '충전 필요 없음'} sub={data.rechargeUsd > 0 ? usd(data.rechargeUsd) : `다음 달 확보 ${usd(f.nextSecuredUsd)}`} warn={data.rechargeUsd > 0} />
        <Stat label={`무료 운영 가능 업체 수(${data.company.size}명 기준)${data.estimated ? ' · 추정' : ''}`} value={data.freeCompanies === null ? '실측 부족' : `${data.freeCompanies}곳`} sub={`1곳 월 ${won(data.company.krw)} · (확보×70% − 우리 회사 ${usd(data.ourForecastUsd)})`} />
        <Stat label={data.estimated ? '사용자 유형(1인 월) — 데이터 부족 · 추정 모델' : '사용자 유형(최근 30일, 1인 월)'} value={`${won(data.tiers.light)} · ${won(data.tiers.medium)} · ${won(data.tiers.heavy)}`}
          sub={data.estimated ? `가정값(가벼움·보통·많음) — 실측 ${won(data.measuredTiers.light)}·${won(data.measuredTiers.medium)}·${won(data.measuredTiers.heavy)} (${data.measuredTiers.users}명·${data.dataDays}일치, 10명·30일 쌓이면 실측으로)` : `가벼움·보통·많음 (사용한 ${data.tiers.users}명 3등분)`} warn={data.estimated} />
        <Stat label="콘솔 실제 청구" value={data.console ? usd(data.console.usd) : '입력 안 함'} sub={data.console ? `워크인 집계와 ${data.console.diffPct ?? '-'}% 차이${data.console.at ? ` · ${fmtDateTime(data.console.at)}` : ''}` : '기준 입력에서 넣기'} warn={!!data.console && Math.abs(data.console.diffPct ?? 0) > 10} />
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <div>
          <h3 className="text-xs font-semibold text-ink-2">단가 실측(최근 30일 1건 평균)</h3>
          <ul className="mt-1 space-y-0.5 text-xs" data-testid="ai-units">{data.units.map((u: any) => <li key={u.purpose} className="flex justify-between gap-2"><span>{PURPOSE[u.purpose] ?? u.purpose}</span><span className="tabular-nums">{won(u.krw)} <span className="text-ink-3">({u.n}건)</span></span></li>)}</ul>
        </div>
        <div>
          <h3 className="text-xs font-semibold text-ink-2">회사별 이번 달</h3>
          <ul className="mt-1 space-y-0.5 text-xs">{data.byTenant.map((t: any) => <li key={t.tenant} className="flex justify-between gap-2"><span className="truncate">{t.name}</span><span className="tabular-nums">{usd(t.usd)} <span className="text-ink-3">→ 예상 {usd(t.forecastUsd)}</span></span></li>)}</ul>
        </div>
        <div className="lg:col-span-3">
          <h3 className="text-xs font-semibold text-ink-2">AI 가격 결정 — 검토용 요금표(V27 안, 실제 요금 아님)</h3>
          <AiPricing p={data.pricing} />
        </div>
      </div>
      <p className="mt-2 text-[11px] text-ink-3">확보 크레딧의 70%·90% 에 닿으면 운영자에게 알림. 코드 실행 시간 요금은 응답에 없어 빠져 있어 콘솔 청구와 다를 수 있습니다. 기존 기능 동작에는 영향 없음(계산·표시만).</p>
    </section>
  );
}

const pct = (x: number | null) => (x === null ? '-' : `${Math.round(x * 100)}%`);
/** 실측 1인 월 원가 기준 포함 AI·AI 크레딧의 원가율·마진 — 매출 ≥ 원가×2 면 적정 */
function AiPricing({ p }: { p: any }) {
  const Verdict = ({ ok }: { ok: boolean }) => <span className={cx('rounded px-1 text-[10px] font-semibold', ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700')}>{ok ? '적정' : '가격 조정 필요'}</span>;
  return (
    <div className="mt-1 space-y-1.5 text-xs" data-testid="ai-pricing">
      <p className="text-[11px] leading-snug text-ink-3">
        기준 1인 월 원가({p.basis.source === 'measured' ? `실측 ${p.basis.users}명·${p.basis.days}일` : '가정값'}): 가벼움 {won(p.basis.light)} · 보통 {won(p.basis.medium)} · 많음 {won(p.basis.heavy)}.
        요금제는 &ldquo;1인 요금 × AI 몫 {Math.round(p.aiShare * 100)}%&rdquo;가 보통 사용자 원가(포함분 안)의 2배 이상이면 적정, 크레딧은 판매가가 쓸 수 있는 AI 원가의 2배 이상이면 적정입니다.
      </p>
      <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
        {p.plans.map((r: any) => (
          <li key={r.code} className="rounded-input border border-line px-2 py-1" data-testid={`ai-price-${r.code}`}>
            <div className="flex items-center justify-between gap-2"><span className="font-semibold">{r.name} <span className="font-normal text-ink-3">1인 {won(r.perUserKrw)} · 포함 AI {won(r.includedKrw)}분</span></span><Verdict ok={r.ok} /></div>
            <div className="tabular-nums text-ink-2">AI 몫 {won(r.aiPartKrw)} · 보통 원가 {won(r.costKrw)}(원가율 {pct(r.costRate)}) · 마진 {won(r.marginKrw)} <span className="text-ink-3">· 많음 {won(r.heavyCostKrw)} · 포함분 다 쓰면 요금의 {pct(r.capRate)}</span></div>
          </li>
        ))}
        {p.credits.map((c: any) => (
          <li key={c.code} className="rounded-input border border-line px-2 py-1" data-testid={`ai-price-${c.code}`}>
            <div className="flex items-center justify-between gap-2"><span className="font-semibold">{c.name} <span className="font-normal text-ink-3">월 {won(c.priceKrw)} · AI {won(c.faceKrw)}분</span></span><Verdict ok={c.ok} /></div>
            <div className="tabular-nums text-ink-2">원가율 {pct(c.costRate)} · 마진 {won(c.marginKrw)}{c.mediumUserMonths !== null && <span className="text-ink-3"> · 보통 사용자 약 {c.mediumUserMonths.toLocaleString('ko-KR')}명·월분</span>}</div>
          </li>
        ))}
        <li className="self-center px-2 text-ink-3">무료: 회사당 AI 상한 월 {won(p.freeCompanyCapKrw)} (가격 판정 대상 아님 · 체험·내부 제외)</li>
      </ul>
    </div>
  );
}
