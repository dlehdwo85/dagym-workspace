'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Gauge, HardDrive, Sparkles, Users } from 'lucide-react';
import { api, useApi } from '@/components/client';
import { Meter, fmtBytes, won } from '@/components/usage';
import { BillingSection } from '@/components/Billing';
import { AiPeopleBudgets } from '@/components/AiPeopleBudgets';
import { byPurposeRows } from '@/components/aiPurpose';
import { TaskQuota } from '@/components/TaskQuota';
import { UsageStats } from '@/components/UsageStats';
import { AiLimitsTable, AiPlanMatrix } from '@/components/AiLimitsTable';
import { MktPlanSection } from '@/components/marketing/MktPlanSection';
import { IN_APP_BILLING_NOTE, useInApp } from '@/components/inApp';
import { Button, ErrorBox, Field, Modal, PageHeader, Skeleton, cx, fmtDate, fmtDateTime, inputCls, toast } from '@/components/ui';

const GB = 1024 ** 3;
const lim = (v: number | null | undefined, unit: string) => (v === null || v === undefined ? '한도 미설정' : `${v.toLocaleString('ko-KR')}${unit}`);
/** V14 4번 기능 이름 */
// 로컬 검수 10/17: 고객 화면은 한국어 기능명·원화만(내부 키·달러·운영자 문구는 /platform)
const krw = (usd: number, rate: number) => won(Math.round(usd * rate));
/** #602 고객사 응답은 금액이 이미 원화(currency: 'krw') — 달러·환율 칸이 없다 */
const aiMoney = (ai: { currency?: string; usdKrw?: number }, v: number) => (ai.currency === 'krw' ? won(v) : krw(v, ai.usdKrw ?? 1400));

type Budget = { source: 'plan' | 'override' | 'unlimited' | 'legacy'; limitKrw: number | null; usedKrw: number; leftKrw: number | null; pct: number | null; over: boolean; resetLabel: string;
  parts: { planKrw: number | null; perSeatKrw: number | null; seats: number | null; mktKrw: number; packKrw: number; ownerCapKrw: number | null } };
/** 회사 월 AI 예산이 어떻게 정해졌는지 한 줄(1인 금액 × 인원 + 마케팅 요금제 몫 + AI 팩) */
const budgetWhy = (b: Budget) => b.source === 'legacy' ? '' : b.source === 'override' ? '운영사가 정한 값' : b.source === 'unlimited' ? '' : [
  b.parts.perSeatKrw !== null ? `1인 ${won(b.parts.perSeatKrw)} × ${b.parts.seats}명` : b.parts.planKrw !== null ? `요금제 ${won(b.parts.planKrw)}` : '',
  b.parts.mktKrw ? `마케팅 요금제 ${won(b.parts.mktKrw)}` : '', b.parts.packKrw ? `AI 팩 ${won(b.parts.packKrw)}` : ''].filter(Boolean).join(' + ');

/** V10 관리 → 사용량·요금제 (대표·본사 관리자) */
export default function UsagePage() {
  const { data, error, loading, reload } = useApi<any>('/api/usage');
  const [req, setReq] = useState<{ planCode: string; addons: Record<string, number>; note: string } | null>(null);
  const [tab, setTab] = useState<'plan' | 'stats'>('plan'); // V30 ⑤ 이용 현황 탭(?tab=stats)
  useEffect(() => { if (new URLSearchParams(location.search).get('tab') === 'stats') setTab('stats'); }, []);
  const inApp = useInApp(); // 스토어 심사: 앱 안에서는 요금제 가입·변경·팩·결제창·가격을 보이지 않음(사용량만)
  async function send(e: React.FormEvent) {
    e.preventDefault(); if (!req) return;
    try {
      await api('/api/usage/request', { body: { planCode: req.planCode || undefined, addons: Object.values(req.addons).some((v) => v > 0) ? req.addons : undefined, note: req.note || undefined } });
      setReq(null); reload(); toast.ok('요청을 보냈습니다. 운영자가 확인 후 반영합니다');
    } catch (e: any) { toast.error(e.message); }
  }
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (loading && !data) return <Skeleton rows={6} />;
  const { subscription: s, limits, usage, plans, addons, topFiles, requests, ai, canEdit } = data;
  const ab = data.aiBudget as Budget | undefined;
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader title={inApp ? '사용량' : '사용량·요금제'} icon={Gauge} sub="회사 전체 저장공간·AI 요청·사용자 수. 한도를 넘어도 업무·일정은 그대로 쓰고, 새 파일 올리기·AI·초대만 멈춥니다."
        actions={canEdit && !inApp && tab === 'plan' && <Button onClick={() => setReq({ planCode: '', addons: {}, note: '' })} data-testid="plan-request">요금제 변경 요청</Button>} />
      <div className="flex gap-1.5" role="tablist">
        {([['plan', inApp ? '사용량' : '사용량·요금제'], ['stats', '이용 현황']] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cx('rounded-full border px-3 py-1 text-xs font-medium', tab === k ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-white text-ink-2')} data-testid={`usage-tab-${k}`}>{l}</button>)}
      </div>
      {tab === 'stats' ? <UsageStats /> : <>
      {inApp && <p className="rounded-card border border-line bg-white p-4 text-sm text-ink-2 shadow-card" data-testid="in-app-billing-note">{IN_APP_BILLING_NOTE}</p>}
      {!inApp && <section className="rounded-card border border-line bg-white p-4 shadow-card" data-testid="current-plan">
        <div className="text-sm text-ink-2">현재 요금제</div>
        <div className="text-xl font-bold">{s.planName} <span className="text-base font-normal text-ink-2">{s.monthlyKrw === null ? '별도 협의' : s.perUserKrw ? `1인 월 ${won(s.perUserKrw)} · 이번 달 약 ${won(s.monthlyKrw)}` : `월 ${won(s.monthlyKrw)}`}</span></div>
        <div className="mt-1 text-xs text-ink-3">
          {Object.entries(s.addons ?? {}).filter(([, v]) => Number(v) > 0).map(([k, v]) => `${addons.find((a: any) => a.code === k)?.name ?? k} ×${v}`).join(' · ') || '추가 옵션 없음'}
          {s.periodEnd && ` · 다음 갱신일 ${fmtDate(s.periodEnd)}`}{s.status !== 'active' && ` · ${s.status === 'trial' ? '체험 중' : '일시 중지'}`}
        </div>
      </section>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Meter label="저장공간" icon={HardDrive} used={usage.storageBytes / GB} limit={limits.storageGb} usedLabel={fmtBytes(usage.storageBytes)} limitLabel={lim(limits.storageGb, 'GB')} testid="meter-storage" />
        {/* 대표 10/24 ②: 회사 월 AI 예산(원) 게이지 — 80% 알림·100% 멈춤, 다음 달 1일 초기화, 영상 제작은 마케팅 크레딧으로 따로 */}
        {ab ? <Meter label="이번 달 AI 예산" icon={Sparkles} used={ab.usedKrw} limit={ab.limitKrw} usedLabel={won(ab.usedKrw)} limitLabel={ab.limitKrw === null ? '무제한' : won(ab.limitKrw)} testid="meter-ai"
          note={<span data-testid="meter-ai-note">{ab.over ? <b className="text-red-600">AI 기능 멈춤 — {ab.resetLabel}에 다시 채워짐</b> : `${ab.resetLabel}에 다시 채워짐`}{budgetWhy(ab) && ` · ${budgetWhy(ab)}`} · 영상 제작은 마케팅 크레딧으로 따로</span>} />
          : <Meter label="이번 달 AI 비용" icon={Sparkles} used={ai.costUsd ?? ai.cost} limit={ai.limitUsd ?? ai.limit} usedLabel={`약 ${aiMoney(ai, ai.costUsd ?? ai.cost)}`} limitLabel={`약 ${aiMoney(ai, ai.limitUsd ?? ai.limit)}`} testid="meter-ai" />}
        <Meter label="사용자" icon={Users} used={usage.users} limit={limits.users} usedLabel={`${usage.users}명${usage.invited ? ` (+초대 중 ${usage.invited})` : ''}`} limitLabel={lim(limits.users, '명')} testid="meter-users" />
      </div>
      {limits.tasksTotal != null && <TaskQuota used={usage.tasks} limit={limits.tasksTotal} canEdit={canEdit} onChanged={reload} />}
      {/* #412: 업무·영업·마케팅 AI 한도 → 쓴 양 → 남은 양 한 표(체감 단위) */}
      {data.aiLimits && <AiLimitsTable data={data.aiLimits} />}
      {/* V14 4번: 이번 달 AI 사용 — 사람별·기능별, 한도 대비 % */}
      {!inApp && <BillingSection />}
      <section className="rounded-card border border-line bg-white p-4 shadow-card" data-testid="ai-usage">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">이번 달 AI 사용</h2>
          {ab ? <span className="text-xs text-ink-2" data-testid="ai-usage-pct">회사 월 AI 예산 {ab.limitKrw === null ? '무제한' : won(ab.limitKrw)} 중 <b className={cx(ab.over ? 'text-red-600' : (ab.pct ?? 0) >= 80 ? 'text-amber-700' : 'text-ink')}>{ab.pct ?? 0}%</b>{ab.leftKrw !== null && ` · 남은 ${won(ab.leftKrw)}`} · 요청 {ai.requests.toLocaleString('ko-KR')}회{ai.blocked ? ` · 차단 ${ai.blocked}건` : ''}</span>
            : <span className="text-xs text-ink-2" data-testid="ai-usage-pct">회사 월 한도 약 {aiMoney(ai, ai.limitUsd ?? ai.limit)} 중 <b className={cx(ai.pct >= 100 ? 'text-red-600' : ai.pct >= 80 ? 'text-amber-700' : 'text-ink')}>{ai.pct}%</b> · 남은 약 {aiMoney(ai, ai.leftUsd ?? ai.left)} · 요청 {ai.requests.toLocaleString('ko-KR')}회{ai.blocked ? ` · 차단 ${ai.blocked}건` : ''}</span>}
        </div>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          {([['사람별', ai.byUser.map((x: any) => ({ k: x.user_id, label: x.name, cost: x.cost, n: x.requests }))], ['기능별', byPurposeRows(ai.byPurpose)]] as const).map(([title, rows]) => {
            const max = Math.max(0.0001, ...rows.map((r: any) => r.cost));
            return (
              <div key={title}>
                <h3 className="mb-1 text-xs font-semibold text-ink-2">{title}</h3>
                <ul className="space-y-1 text-xs">{rows.map((r: any) => (
                  <li key={r.k ?? r.label} className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-2">
                    <span className="truncate">{r.label}</span>
                    <span className="h-2 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-violet-500" style={{ width: `${(r.cost / max) * 100}%` }} /></span>
                    <span className="tabular-nums text-ink-2">{aiMoney(ai, r.cost)} · {r.n}회</span>
                  </li>
                ))}{!rows.length && <li className="text-ink-3">아직 사용이 없습니다</li>}</ul>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-[11px] text-ink-3">1인 하루 요청 {ai.dailyLimit}회까지 · 80%·100% 에 알림, 100% 가 되면 AI 기능만 멈추고 업무·일정은 그대로입니다.</p>
      </section>
      <AiPeopleBudgets />
      {/* V12 1번: 한도에 가까우면 해당 팩 바로 안내 */}
      {(() => {
        const near = (u: number, l: number | null) => l !== null && l > 0 && u / l >= 0.8;
        const packs = [...(near(usage.storageBytes / GB, limits.storageGb) ? addons.filter((a: any) => a.adds.storageGb) : []), ...(near(usage.aiRequests, limits.aiRequests) ? addons.filter((a: any) => a.adds.aiRequests) : [])];
        if (!packs.length) return null;
        return (
          <section className="rounded-card border border-amber-200 bg-amber-50 p-3" data-testid="pack-suggest">
            <p className="text-sm font-semibold text-amber-900">한도에 가까워졌습니다 — 팩을 더하면 바로 늘어납니다</p>
            <div className="mt-2 flex flex-wrap gap-2">{packs.map((a: any) => (
              <Button key={a.code} size="sm" variant="secondary" onClick={() => setReq({ planCode: '', addons: { [a.code]: 1 }, note: `${a.name} 구매 요청` })}>{a.name} · 월 {won(a.monthly_krw)}</Button>
            ))}</div>
          </section>
        );
      })()}
      <section className="rounded-card border border-line bg-white p-4 shadow-card">
        <h2 className="text-sm font-semibold">파일 종류별</h2>
        <div className="mt-2 flex h-3 overflow-hidden rounded-full bg-slate-100">
          {(['photo', 'doc', 'other'] as const).map((k, i) => <div key={k} className={['bg-sky-500', 'bg-green-500', 'bg-slate-400'][i]} style={{ width: `${usage.storageBytes ? (usage.byKind[k] / usage.storageBytes) * 100 : 0}%` }} />)}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-3 text-xs text-ink-2">
          <span><i className="mr-1 inline-block size-2 rounded-full bg-sky-500" />사진 {fmtBytes(usage.byKind.photo)}</span>
          <span><i className="mr-1 inline-block size-2 rounded-full bg-green-500" />문서 {fmtBytes(usage.byKind.doc)}</span>
          <span><i className="mr-1 inline-block size-2 rounded-full bg-slate-400" />기타 {fmtBytes(usage.byKind.other)}</span>
        </div>
        <h2 className="mt-4 text-sm font-semibold">큰 파일 TOP 20 <span className="font-normal text-ink-3">— 눌러서 정리</span></h2>
        <ul className="mt-1 divide-y divide-line text-sm" data-testid="top-files">
          {topFiles.map((f: any) => (
            <li key={f.kind + f.id} className="flex items-center gap-2 py-1.5">
              <Link href={f.kind === 'library' ? `/library?file=${f.id}` : f.task_id ? `/tasks/${f.task_id}` : `/calendar?event=${f.event_id}`} className="min-w-0 flex-1 truncate hover:underline">{f.title}</Link>
              {f.deleted_at && <span className="rounded bg-slate-100 px-1.5 text-[11px] text-ink-3">삭제됨(공간 차지)</span>}
              <span className="text-xs text-ink-3">{f.kind === 'library' ? '자료실' : '첨부'}</span>
              <span className="w-16 text-right text-xs tabular-nums">{fmtBytes(f.size)}</span>
            </li>
          ))}
          {!topFiles.length && <li className="py-2 text-ink-3">아직 파일이 없습니다</li>}
        </ul>
      </section>
      {!inApp && <section className="rounded-card border border-line bg-white p-4 shadow-card" data-testid="plan-table">
        <h2 className="text-sm font-semibold">요금제 (VAT 별도 · 1인 월 · 최소 3인 · 30인 이상 10% 할인)</h2>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead><tr className="text-left text-xs text-ink-3"><th className="py-1">요금제</th><th>월 요금</th><th>사용자</th><th>저장공간</th><th>AI(회사 공유)/월</th></tr></thead>
            <tbody>
              {plans.map((p: any) => (
                <tr key={p.code} className={cx('border-t border-line', p.code === s.planCode && 'bg-brand-50 font-semibold')}>
                  <td className="py-1.5">{p.name}{p.description && <div className="text-[11px] font-normal text-ink-3">{p.description}</div>}</td>
                  <td>{p.per_user_krw ? `1인 ${won(p.per_user_krw)}` : won(p.monthly_krw)}{p.min_users ? <div className="text-[11px] font-normal text-ink-3">최소 {p.min_users}인</div> : null}{(p.annual_per_user_krw || p.annual_monthly_krw) ? <div className="text-[11px] font-normal text-brand-700">연간 결제 시 {p.annual_per_user_krw ? `1인 ${won(p.annual_per_user_krw)}` : won(p.annual_monthly_krw)}</div> : null}</td><td>{lim(p.limits.users, '명')}</td>
                  <td>{p.limits.perUserStorageGb ? `1인 ${p.limits.perUserStorageGb}GB(합산)` : lim(p.limits.storageGb, 'GB')}</td><td>{/* 대표 10/24 ②: 원 예산 요금제는 '1인 월 n원분'·'회사 월 n원분' */}
                    {p.limits.perUserAiBudgetKrw != null ? `1인 월 ${won(p.limits.perUserAiBudgetKrw)}분(합산)` : p.limits.aiBudgetKrw != null ? `회사 월 ${won(p.limits.aiBudgetKrw)}분` : p.limits.perUserAi ? `1인당 ${p.limits.perUserAi}회` : lim(p.limits.aiRequests, '회')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-ink-2">팩(여러 개 구매 가능): {addons.map((a: any) => `${a.name} 월 ${won(a.monthly_krw)}`).join(' · ')}</p>
        <p className="mt-1 text-xs text-ink-3">카드 결제는 위 결제 칸에서 바로, 팩·인원 조정 등은 변경 요청을 보내면 운영자가 확인해 반영합니다. AI 는 회사 전체가 나눠 쓰고, 하루 1인 사용 횟수 제한은 AI 설정에서 바꿉니다.</p>
        {!!requests.length && (
          <ul className="mt-3 space-y-1 text-xs text-ink-2">
            {requests.map((r: any) => <li key={r.id}>{fmtDateTime(r.created_at)} · {r.requested_by_name} · {r.plan_code ? plans.find((p: any) => p.code === r.plan_code)?.name ?? r.plan_code : '추가 옵션'} · <b>{{ pending: '검토 중', approved: '반영됨', rejected: '반려' }[r.status as 'pending']}</b></li>)}
          </ul>
        )}
      </section>}
      {!inApp && data.aiLimits?.plans && <AiPlanMatrix matrix={data.aiLimits.plans} currentCode={s.planCode} />}
      {/* 대표 10/27 ⑤: 요금제는 한곳에 — 마케팅 제작 요금제도 여기서(자동 제작실은 제작만) */}
      {!inApp && <MktPlanSection />}
      </>}
      <Modal open={!!req && !inApp} onClose={() => setReq(null)} title="요금제 변경 요청">
        {req && (
          <form onSubmit={send} className="space-y-3">
            <Field label="요금제">
              <select className={inputCls} value={req.planCode} onChange={(e) => setReq({ ...req, planCode: e.target.value })} aria-label="요청할 요금제">
                <option value="">그대로 (옵션만)</option>
                {plans.map((p: any) => <option key={p.code} value={p.code}>{p.name} · {p.per_user_krw ? `1인 ${won(p.per_user_krw)}` : won(p.monthly_krw)}</option>)}
              </select>
            </Field>
            {addons.map((a: any) => (
              <Field key={a.code} label={`${a.name} (월 ${won(a.monthly_krw)})`}>
                <input type="number" min={0} max={100} className={inputCls} value={req.addons[a.code] ?? 0} onChange={(e) => setReq({ ...req, addons: { ...req.addons, [a.code]: Number(e.target.value) } })} aria-label={`${a.name} 개수`} />
              </Field>
            ))}
            <Field label="메모"><textarea className={inputCls} value={req.note} onChange={(e) => setReq({ ...req, note: e.target.value })} /></Field>
            <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setReq(null)}>취소</Button><Button type="submit">요청 보내기</Button></div>
          </form>
        )}
      </Modal>
    </div>
  );
}
