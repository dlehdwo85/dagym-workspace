'use client';
import { useApi } from './client';

type Row = { source?: string; week?: string; signups: number; invited: number; active: number; maturing: number };
const rate = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '-');
type PageRow = { page: string; label: string; visits: number; signups: number; sales: number; marketing: number };

/** 마케팅 주간 퍼널 — 가입 회사 → 팀 초대 완료(2명+) → 실사용, UTM 출처별 */
export function PlatformFunnel() {
  const { data } = useApi<{ bidAlerts?: { days: number; subscribers: number; unsubscribed: number; newSubscribers: number; sent: number; opened: number; signups: number } | null; byPage?: { days: number; rows: PageRow[] }; steps?: { step: string; label: string; n: number; fromPrev: number | null }[]; total: { signups: number; invited: number; active: number }; byWeek: (Row & { week: string; bySource: Row[] })[]; definition: Record<string, string> }>('/api/platform/funnel?weeks=8');
  if (!data) return null;
  const Cells = ({ r }: { r: Row }) => (<>
    <td className="px-2 py-1 text-right tabular-nums">{r.signups}</td>
    <td className="px-2 py-1 text-right tabular-nums">{r.invited} <span className="text-ink-3">{rate(r.invited, r.signups)}</span></td>
    <td className="px-2 py-1 text-right tabular-nums">{r.active} <span className="text-ink-3">{rate(r.active, r.signups)}</span>{r.maturing > 0 && <span className="ml-1 text-[10px] text-ink-3">(판정 중 {r.maturing})</span>}</td>
  </>);
  return (
    <section className="rounded-card border border-line bg-white p-3 shadow-card" data-testid="platform-funnel">
      <h2 className="text-sm font-semibold">가입 흐름(주별·어디서 왔는지) <span className="ml-1 text-xs font-normal text-ink-3">최근 8주 · 회사 {data.total.signups} → 초대 {data.total.invited} → 실사용 {data.total.active}</span></h2>
      <p className="mt-0.5 text-[11px] text-ink-3">초대 완료 = {data.definition.invited} · 실사용 = {data.definition.active} · 출처 = 가입 때 utm_source(없으면 direct). 내부·데모·개인 공간 제외.</p>
      {/* V32 3 가입 단계별 이탈(최근 30일) */}
      {data.steps && (
        <div className="mt-2 flex flex-wrap gap-1.5 text-xs" data-testid="funnel-steps">
          {data.steps.map((st) => (
            <span key={st.step} className="rounded-input border border-line px-2 py-1"><b className="font-medium">{st.label}</b> {st.n}{st.fromPrev !== null && <span className={st.fromPrev < 50 ? 'ml-1 text-red-600' : 'ml-1 text-ink-3'}>({st.fromPrev}%)</span>}</span>
          ))}
          <span className="self-center text-[11px] text-ink-3">최근 30일 · 괄호 = 앞 단계 대비 남은 비율</span>
        </div>
      )}
      {/* #949(대표 승인 11/04): 광고 유입 무료 미끼 — 입찰 공고 아침 메일 구독·열람·체험 전환(utm_source = bid_alert) */}
      {data.bidAlerts && (
        <p className="mt-2 rounded-input bg-slate-50 px-2 py-1.5 text-xs text-ink-2" data-testid="funnel-bid-alerts">입찰 공고 아침 메일(무료 구독, 최근 {data.bidAlerts.days}일): 구독 <b className="text-ink">{data.bidAlerts.subscribers}</b>(새로 {data.bidAlerts.newSubscribers} · 수신 거부 {data.bidAlerts.unsubscribed}) · 보낸 메일 {data.bidAlerts.sent}통 · 열람 {data.bidAlerts.opened} {rate(data.bidAlerts.opened, data.bidAlerts.sent)} · 체험 가입 {data.bidAlerts.signups}(utm bid_alert)</p>
      )}
      {/* 311차 #867(대표 11/01 '페이지별 홍보 목표'): 소개 페이지별 방문 → 체험 가입 → 영업·마케팅 공간 선택(최근 30일) */}
      {data.byPage && (
        <div className="mt-3 overflow-x-auto" data-testid="funnel-pages">
          <p className="text-xs font-semibold">소개 페이지별 <span className="font-normal text-ink-3">최근 {data.byPage.days}일 · 방문 = 같은 브라우저 하루 1번 · 가입 = 그 페이지로 처음 들어와 가입한 회사</span></p>
          <table className="mt-1 w-full min-w-[520px] text-xs">
            <thead className="text-ink-3"><tr><th className="px-2 py-1 text-left font-medium">페이지</th><th className="px-2 py-1 text-right font-medium">방문</th><th className="px-2 py-1 text-right font-medium">체험 가입</th><th className="px-2 py-1 text-right font-medium">영업 선택</th><th className="px-2 py-1 text-right font-medium">마케팅 선택</th></tr></thead>
            <tbody>
              {data.byPage.rows.map((r) => (
                <tr key={r.page} className="border-t border-line" data-testid={`funnel-page-${r.page}`}>
                  <td className="px-2 py-1">{r.label}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{r.visits}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{r.signups} <span className="text-ink-3">{rate(r.signups, r.visits)}</span></td>
                  <td className="px-2 py-1 text-right tabular-nums">{r.sales} <span className="text-ink-3">{rate(r.sales, r.signups)}</span></td>
                  <td className="px-2 py-1 text-right tabular-nums">{r.marketing} <span className="text-ink-3">{rate(r.marketing, r.signups)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.byWeek.length === 0 ? <p className="mt-2 text-xs text-ink-3">아직 이 기간에 가입한 회사가 없습니다.</p> : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[460px] text-xs">
            <thead className="text-ink-3"><tr><th className="px-2 py-1 text-left font-medium">주(월요일)·출처</th><th className="px-2 py-1 text-right font-medium">가입 회사</th><th className="px-2 py-1 text-right font-medium">팀 초대 완료</th><th className="px-2 py-1 text-right font-medium">실사용</th></tr></thead>
            <tbody>
              {data.byWeek.map((w) => [
                <tr key={w.week} className="border-t border-line font-semibold"><td className="px-2 py-1">{w.week}</td><Cells r={w} /></tr>,
                ...w.bySource.map((s) => <tr key={w.week + s.source} className="text-ink-2"><td className="px-2 py-0.5 pl-5">{s.source}</td><Cells r={s} /></tr>),
              ])}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
