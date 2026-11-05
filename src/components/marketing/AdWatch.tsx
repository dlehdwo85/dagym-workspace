'use client';
import { useState } from 'react';
import { api, useApi } from '@/components/client';
import { Button, ErrorBox, Skeleton, cx, fmtDateTime, inputCls, toast } from '@/components/ui';

const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`;
type Finding = { kind: 'kw_bid_down' | 'kw_pause' | 'brand_day' | 'cap'; title: string; detail: string };
type BrandRow = { brandId: string; name: string; plan: number | null; dailyPlan: number | null; yesterday: number; mtd: number; planPct: number | null };
type Check = { at: string; day: string; checkedDay: string; findings: Finding[]; counts: { bidDown: number; pause: number; brandDay: number; cap: number }; brands: BrandRow[];
  unbranded: { mtd: number; yesterday: number }; cap: { cap: number; spend: number; pct: number; threshold: number; elapsedPct: number } | null; caveat: string | null };
type WRow = { brandId: string | null; name: string; cost: number; clicks: number; calls: number; inquiries: number; signups: number; leads: number; cpa: number | null; plan: number | null; mtd: number; planPct: number | null };
type Weekly = { at: string; from: string; to: string; pacePct: number; rows: WRow[]; total: Omit<WRow, 'brandId' | 'name'> };
type Settings = { enabled: boolean; exists: boolean; kwCost: number; kwDays: number; pauseWeeks: number; dayRatio: number; capPct: number; brandPlans: Record<string, number> };
type Data = { canEdit: boolean; settings: Settings; defaults: Omit<Settings, 'enabled' | 'exists' | 'brandPlans'>; live: Check; lastDaily: Check | null; lastWeekly: Weekly | null; dailyOn: string | null; weeklyOn: string | null; schedule: string };
const KIND: Record<Finding['kind'], { label: string; cls: string }> = {
  kw_pause: { label: '중지 제안', cls: 'bg-red-50 text-red-800' }, kw_bid_down: { label: '입찰가 내림', cls: 'bg-amber-50 text-amber-800' },
  brand_day: { label: '하루 비용', cls: 'bg-amber-50 text-amber-800' }, cap: { label: '월 상한', cls: 'bg-red-50 text-red-800' },
};
/** 기준 5개(AD_BUDGET_PLAN 8번) — 칸 이름·단위·서버 범위 */
const FIELDS: { key: 'kwCost' | 'kwDays' | 'pauseWeeks' | 'dayRatio' | 'capPct'; label: string; unit: string; min: number; max: number; step?: number }[] = [
  { key: 'kwCost', label: '키워드 비용 기준', unit: '원 이상 · 문의 0 → 입찰가 내림 제안', min: 1000, max: 10_000_000 },
  { key: 'kwDays', label: '그 기간', unit: '일', min: 3, max: 30 },
  { key: 'pauseWeeks', label: '연속 횟수', unit: '번 연속이면 중지 제안', min: 1, max: 8 },
  { key: 'dayRatio', label: '사업별 하루 비용', unit: '배 넘으면 그날 확인(하루 계획 = 월 계획 ÷ 그 달 날 수)', min: 1, max: 10, step: 0.1 },
  { key: 'capPct', label: '회사 월 상한', unit: '% 넘으면 대표 보고(알림 + 메일, 달마다 한 번)', min: 10, max: 100 },
];

/**
 * 363차 #981(대표 11/05 B4): 서버 광고 점검 — 매일 서울 9시 뒤 이상 알림 + 월요일 주간 보고. 기준 5개·사업별 월 계획을 여기서 고침.
 * 입찰가·켜기/끄기는 바꾸지 않고 제안만(사람이 아래 세팅안·키워드 표에서 실행).
 */
export function AdWatch() {
  const { data, error, reload } = useApi<Data>('/api/marketing/ad-ops/watch');
  const [edit, setEdit] = useState<Record<string, string> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Skeleton rows={3} />;
  const s = data.settings; const live = data.live;
  const start = () => setEdit({ ...Object.fromEntries(FIELDS.map((f) => [f.key, String(s[f.key])])), ...Object.fromEntries(live.brands.map((b) => [`plan:${b.brandId}`, b.plan ? String(b.plan) : ''])) });
  async function go(key: string, fn: () => Promise<unknown>, ok: string) { setBusy(key); try { await fn(); toast.ok(ok); reload(); } catch (e: any) { toast.error(e.message); } finally { setBusy(null); } }
  const save = () => {
    if (!edit) return;
    const body: Record<string, unknown> = {};
    for (const f of FIELDS) { const v = Number(String(edit[f.key] ?? '').replace(/[^\d.]/g, '')); if (!(v >= f.min && v <= f.max)) return toast.error(`${f.label}: ${f.min}~${f.max.toLocaleString('ko-KR')} 사이로 적어 주세요`); body[f.key] = f.key === 'dayRatio' ? v : Math.round(v); }
    body.brandPlans = Object.fromEntries(live.brands.map((b) => { const t = String(edit[`plan:${b.brandId}`] ?? '').replace(/\D/g, ''); return [b.brandId, t ? Number(t) : null]; }));
    go('save', () => api('/api/marketing/ad-ops/watch', { method: 'PUT', body }), '광고 점검 기준을 저장했습니다').then(() => setEdit(null));
  };
  const toggle = () => go('toggle', () => api('/api/marketing/ad-ops/watch', { method: 'PUT', body: { enabled: !s.enabled } }), s.enabled ? '광고 점검을 껐습니다' : '광고 점검을 켰습니다');
  const runNow = (action: 'daily' | 'weekly') => confirm(action === 'daily' ? '지금 숫자로 점검해서 이상이 있으면 회사 대표에게 알림을 보냅니다(오늘 이미 보냈으면 다시 안 감). 보낼까요?' : '지난주 주간 보고를 지금 회사 대표에게 알림·메일로 보냅니다. 보낼까요?')
    && go(action, () => api('/api/marketing/ad-ops/watch', { body: { action } }), action === 'daily' ? '점검했습니다' : '주간 보고를 보냈습니다');
  const W = data.lastWeekly;
  return (
    <section id="ad-watch" className="scroll-mt-20 rounded-card border border-line bg-white p-3 shadow-card" data-testid="ad-watch">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">광고 점검 · 매일 알림 · 월요일 주간 보고</h2>
        <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-medium', s.enabled ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-ink-2')} data-testid="ad-watch-state">{s.enabled ? '켜짐' : '꺼짐'}</span>
        {data.canEdit && <div className="ml-auto flex flex-wrap gap-1.5">
          <Button size="sm" variant="secondary" onClick={toggle} disabled={busy === 'toggle'} data-testid="ad-watch-toggle">{s.enabled ? '끄기' : '켜기'}</Button>
          {!edit && <Button size="sm" variant="secondary" onClick={start} data-testid="ad-watch-edit">기준 고치기</Button>}
        </div>}
      </div>
      <p className="mt-1 text-xs text-ink-2">{data.schedule}. 입찰가·켜기/끄기는 바꾸지 않고 제안만 합니다 — 아래 세팅안·키워드 표에서 확인한 뒤 실행하세요.</p>

      {edit ? (
        <div className="mt-2 space-y-2" data-testid="ad-watch-form">
          <div className="grid gap-2 sm:grid-cols-2">
            {FIELDS.map((f) => <label key={f.key} className="text-xs"><span className="font-medium">{f.label}</span>
              <span className="mt-0.5 flex items-center gap-1.5"><input className={cx(inputCls, 'w-28')} inputMode="decimal" value={edit[f.key]} onChange={(e) => setEdit({ ...edit, [f.key]: e.target.value })} aria-label={f.label} data-testid={`ad-watch-${f.key}`} />
                <span className="text-ink-3">{f.unit}</span></span></label>)}
          </div>
          <div className="text-xs font-medium">사업별 월 계획(원) — 비우면 하루 비용 점검을 하지 않음</div>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {live.brands.map((b) => <label key={b.brandId} className="flex items-center gap-2 text-xs"><span className="w-28 truncate">{b.name}</span>
              <input className={cx(inputCls, 'w-32')} inputMode="numeric" value={edit[`plan:${b.brandId}`]} onChange={(e) => setEdit({ ...edit, [`plan:${b.brandId}`]: e.target.value })} placeholder="예: 100000" aria-label={`${b.name} 월 계획`} data-testid={`ad-watch-plan-${b.brandId}`} /></label>)}
            {!live.brands.length && <p className="text-xs text-ink-3">마케팅 브랜드가 없습니다.</p>}
          </div>
          <div className="flex gap-1.5"><Button size="sm" onClick={save} disabled={busy === 'save'} data-testid="ad-watch-save">저장</Button><Button size="sm" variant="ghost" onClick={() => setEdit(null)}>취소</Button>
            <span className="self-center text-[11px] text-ink-3">처음 값: 키워드 {won(data.defaults.kwCost)} · {data.defaults.kwDays}일 · {data.defaults.pauseWeeks}번 연속 · 하루 {data.defaults.dayRatio}배 · 상한 {data.defaults.capPct}%</span></div>
        </div>
      ) : (
        <p className="mt-2 text-xs" data-testid="ad-watch-rules">기준: 키워드 {s.kwDays}일 비용 <b>{won(s.kwCost)}</b> 이상·문의 0 → 입찰가 내림 제안, {s.pauseWeeks}번 연속 → 중지 제안 · 사업별 하루 비용이 하루 계획의 <b>{s.dayRatio}배</b> 넘으면 확인 · 회사 누적이 월 상한의 <b>{s.capPct}%</b> 넘으면 대표 보고</p>
      )}

      <div className="mt-3">
        <div className="flex flex-wrap items-baseline gap-2"><h3 className="text-xs font-semibold">지금 숫자로 본 점검 ({live.checkedDay.slice(5).replace('-', '/')}까지)</h3>
          <span className="text-[11px] text-ink-3">입찰가 내림 {live.counts.bidDown} · 중지 {live.counts.pause} · 하루 비용 {live.counts.brandDay} · 월 상한 {live.counts.cap}</span>
          {data.dailyOn && <span className="text-[11px] text-ink-3">마지막 매일 점검 {data.dailyOn}</span>}</div>
        {live.findings.length ? <ul className="mt-1 space-y-1" data-testid="ad-watch-findings">
          {live.findings.slice(0, 12).map((f, i) => <li key={i} className="flex flex-wrap items-baseline gap-1.5 text-xs"><span className={cx('rounded px-1.5 py-0.5 text-[11px] font-medium', KIND[f.kind].cls)}>{KIND[f.kind].label}</span><span className="font-medium">{f.title.replace(/^[^:]+:\s*/, '')}</span><span className="text-ink-2">{f.detail}</span></li>)}
          {live.findings.length > 12 && <li className="text-[11px] text-ink-3">외 {live.findings.length - 12}건</li>}
        </ul> : <p className="mt-1 text-xs text-emerald-800" data-testid="ad-watch-none">기준에 걸린 것이 없습니다.</p>}
        {live.caveat && (live.counts.bidDown + live.counts.pause > 0) && <p className="mt-1 text-[11px] text-amber-800" data-testid="ad-watch-caveat">{live.caveat}</p>}
      </div>

      {live.brands.some((b) => b.plan || b.mtd) && <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[420px] text-xs" data-testid="ad-watch-brands">
        <thead><tr className="text-left text-ink-3"><th className="py-1 font-medium">사업</th><th className="py-1 text-right font-medium">어제</th><th className="py-1 text-right font-medium">하루 계획</th><th className="py-1 text-right font-medium">이번 달</th><th className="py-1 text-right font-medium">월 계획</th></tr></thead>
        <tbody>{live.brands.filter((b) => b.plan || b.mtd).map((b) => <tr key={b.brandId} className="border-t border-line">
          <td className="py-1">{b.name}</td><td className={cx('py-1 text-right', b.dailyPlan && b.yesterday > b.dailyPlan * s.dayRatio && 'font-semibold text-amber-800')}>{won(b.yesterday)}</td>
          <td className="py-1 text-right text-ink-2">{b.dailyPlan ? won(b.dailyPlan) : '-'}</td><td className="py-1 text-right">{won(b.mtd)}</td>
          <td className="py-1 text-right text-ink-2">{b.plan ? `${won(b.plan)} (${b.planPct}%)` : '계획 없음'}</td></tr>)}</tbody></table>
        {live.cap && <p className="mt-1 text-[11px] text-ink-3">회사 이번 달 {won(live.cap.spend)} / 상한 {won(live.cap.cap)} ({live.cap.pct}%) · 이번 달 {live.cap.elapsedPct}% 지남{live.unbranded.mtd ? ` · 사업이 정해지지 않은 광고비 ${won(live.unbranded.mtd)}` : ''}</p>}
      </div>}

      <div className="mt-3">
        <h3 className="text-xs font-semibold">지난 주간 보고{W ? ` (${W.from.slice(5).replace('-', '/')}~${W.to.slice(5).replace('-', '/')} · ${fmtDateTime(W.at)} 보냄)` : ''}</h3>
        {W ? <div className="mt-1 overflow-x-auto"><table className="w-full min-w-[520px] text-xs" data-testid="ad-watch-weekly">
          <thead><tr className="text-left text-ink-3"><th className="py-1 font-medium">사업</th><th className="py-1 text-right font-medium">광고비</th><th className="py-1 text-right font-medium">클릭</th><th className="py-1 text-right font-medium">문의·신청</th><th className="py-1 text-right font-medium">전환당 비용</th><th className="py-1 text-right font-medium">이번 달 / 계획</th></tr></thead>
          <tbody>{[...W.rows, { ...W.total, brandId: 'total', name: '합계' }].map((r) => <tr key={r.brandId ?? 'none'} className={cx('border-t border-line', r.brandId === 'total' && 'font-semibold')}>
            <td className="py-1">{r.name}</td><td className="py-1 text-right">{won(r.cost)}</td><td className="py-1 text-right">{r.clicks.toLocaleString('ko-KR')}</td>
            <td className="py-1 text-right" title={`전화 ${r.calls} · 문의 ${r.inquiries}${r.signups ? ` · 체험 신청 ${r.signups}` : ''}`}>{r.leads}</td><td className="py-1 text-right">{r.cpa ? won(r.cpa) : '-'}</td>
            <td className="py-1 text-right text-ink-2">{r.plan ? `${won(r.mtd)} / ${won(r.plan)} (${r.planPct}%)` : `${won(r.mtd)} / -`}</td></tr>)}</tbody></table>
          <p className="mt-1 text-[11px] text-ink-3">문의 = 전화 기록 + 홈페이지 문의, 신청 = 워크인 체험 신청. 보낸 때 이번 달 {W.pacePct}% 지남.</p></div>
          : <p className="mt-1 text-xs text-ink-3">아직 보낸 주간 보고가 없습니다. 월요일 9시 뒤에 지난주 표가 갑니다.</p>}
      </div>
      {data.canEdit && <div className="mt-3 flex flex-wrap gap-1.5">
        <Button size="sm" variant="secondary" onClick={() => runNow('daily')} disabled={!!busy} data-testid="ad-watch-run-daily">지금 점검 보내기</Button>
        <Button size="sm" variant="secondary" onClick={() => runNow('weekly')} disabled={!!busy} data-testid="ad-watch-run-weekly">주간 보고 지금 보내기</Button>
      </div>}
    </section>
  );
}
