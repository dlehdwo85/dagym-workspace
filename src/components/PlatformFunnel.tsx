'use client';
import { useApi } from './client';

type Row = { source?: string; week?: string; signups: number; invited: number; active: number; maturing: number };
const rate = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '-');

/** 마케팅 주간 퍼널 — 가입 회사 → 팀 초대 완료(2명+) → 실사용, UTM 출처별 */
export function PlatformFunnel() {
  const { data } = useApi<{ steps?: { step: string; label: string; n: number; fromPrev: number | null }[]; total: { signups: number; invited: number; active: number }; byWeek: (Row & { week: string; bySource: Row[] })[]; definition: Record<string, string> }>('/api/platform/funnel?weeks=8');
  if (!data) return null;
  const Cells = ({ r }: { r: Row }) => (<>
    <td className="px-2 py-1 text-right tabular-nums">{r.signups}</td>
    <td className="px-2 py-1 text-right tabular-nums">{r.invited} <span className="text-ink-3">{rate(r.invited, r.signups)}</span></td>
    <td className="px-2 py-1 text-right tabular-nums">{r.active} <span className="text-ink-3">{rate(r.active, r.signups)}</span>{r.maturing > 0 && <span className="ml-1 text-[10px] text-ink-3">(판정 중 {r.maturing})</span>}</td>
  </>);
  return (
    <section className="rounded-card border border-line bg-white p-3 shadow-card" data-testid="platform-funnel">
      <h2 className="text-sm font-semibold">가입 퍼널(주간·유입 출처별) <span className="ml-1 text-xs font-normal text-ink-3">최근 8주 · 회사 {data.total.signups} → 초대 {data.total.invited} → 실사용 {data.total.active}</span></h2>
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
