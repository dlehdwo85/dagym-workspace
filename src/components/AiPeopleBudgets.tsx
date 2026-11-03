'use client';
import { api, useApi } from './client';
import { aiPurposeLabel } from './aiPurpose';
import { Button, cx, fmtDateTime, toast } from './ui';

const pc = (used: number, limit: number) => (limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 100);
const left = (p: number) => Math.max(0, 100 - Math.min(100, p));

/**
 * V23 4장·4.3 → 351차 #939 ③(대표 11/04): 관리 > 사용량 — 사람별 이번 달 AI 사용 %·남은 양 %·오늘 %, 대표는 사람별 월 한도를 기본값 대비 %로 바꾸기,
 * 기다리는 추가 요청 승인·거절, 많이 쓴 요청 상위 10건(비중 %). 원·회는 화면에 없음(원 금액은 플랫폼 운영 화면에만).
 */
export function AiPeopleBudgets() {
  const { data, reload } = useApi<any>('/api/ai/budgets');
  if (!data) return null;
  async function setLimit(p: any) {
    const base = Number(p.defaultKrw) || 1;
    const v = prompt(`${p.name}님 월 AI 한도 — 기본값 대비 %(100 = 기본, 200 = 두 배)`, String(Math.round((Number(p.baseKrw) / base) * 100)));
    if (v === null) return;
    const n = Math.round(Number(v.replace(/[^0-9]/g, '')));
    if (!Number.isFinite(n) || n < 0 || n > 1000) { toast.error('0~1000 사이 %로 적어 주세요'); return; }
    try { await api('/api/ai/user-limits', { method: 'PUT', body: { userId: p.id, monthlyKrw: Math.round((base * n) / 100) } }); toast.ok('한도를 바꿨습니다'); reload(); } catch (e: any) { toast.error(e.message); }
  }
  async function decide(r: any, approve: boolean) {
    try { await api(`/api/ai/limit-requests/${r.id}`, { method: 'PATCH', body: { approve } }); toast.ok(approve ? '승인했습니다' : '거절했습니다'); reload(); } catch (e: any) { toast.error(e.message); }
  }
  const total = Number(data.totalKrw) || 1;
  return (
    <section id="ai-people" className="rounded-card border border-line bg-white p-4 shadow-card" data-testid="ai-people">
      <h2 className="text-sm font-semibold">사람별 AI 한도 <span className="font-normal text-ink-3">— {data.month} · 이번 달 사용 % · 남은 양 %</span></h2>
      {data.pending.length > 0 && (
        <ul className="mt-2 space-y-1.5" data-testid="ai-limit-pending">
          {data.pending.map((r: any) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-input bg-amber-50 px-3 py-2 text-sm">
              <b>{r.name}</b> 이번 달 AI 사용량 추가 요청{r.reason && <span className="text-ink-2">· {r.reason}</span>}<span className="text-xs text-ink-3">{fmtDateTime(r.created_at)}</span>
              {data.canEdit && <span className="ml-auto flex gap-1.5"><Button size="sm" onClick={() => decide(r, true)} data-testid="ai-limit-approve">승인</Button><Button size="sm" variant="secondary" onClick={() => decide(r, false)}>거절</Button></span>}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[480px] text-sm">
          <thead><tr className="border-b border-line text-left text-xs text-ink-3"><th className="py-1.5">이름</th><th>이번 달 사용</th><th>남은 양</th><th>오늘</th><th /></tr></thead>
          <tbody>
            {data.people.map((p: any) => (
              <tr key={p.id} className="border-b border-line last:border-0" data-testid="ai-person">
                <td className="py-1.5 font-medium">{p.name}</td>
                <td><span className={cx('tabular-nums', p.pct >= 100 ? 'text-red-600' : p.pct >= 80 ? 'text-amber-700' : '')}>{Math.round(p.pct)}%</span>{p.extraKrw > 0 && <span className="text-xs text-ink-3"> (추가 승인됨)</span>}
                  <div className="mt-0.5 h-1 w-28 overflow-hidden rounded-full bg-slate-100"><div className={cx('h-full', p.pct >= 100 ? 'bg-red-500' : p.pct >= 80 ? 'bg-amber-500' : 'bg-brand-600')} style={{ width: `${Math.min(100, p.pct)}%` }} /></div></td>
                <td className="tabular-nums">{left(Math.round(p.pct))}%</td>
                <td className="text-xs tabular-nums" title="오늘 쓴 양 / 하루 한도">{pc(p.todayKrw, p.dayLimitKrw)}%</td>
                <td className="text-right">{data.canEdit && <Button size="sm" variant="ghost" onClick={() => setLimit(p)} data-testid="ai-person-limit">한도 바꾸기</Button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.top.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-semibold text-ink-2">많이 쓴 요청 상위 {data.top.length}건</summary>
          <ul className="mt-1 space-y-0.5 text-xs" data-testid="ai-top-requests">
            {data.top.map((t: any, k: number) => <li key={k} className="flex gap-2"><span className="w-12 text-right font-semibold tabular-nums" title="이번 달 전체 사용에서 차지하는 비중">{Math.round((Number(t.krw) / total) * 100)}%</span><span>{t.name ?? '-'}</span><span className="text-ink-3">{aiPurposeLabel(t.purpose)} · {fmtDateTime(t.at)}</span></li>)}
          </ul>
        </details>
      )}
      <p className="mt-2 text-[11px] text-ink-3">한도: 사람마다 기본값이 있고(대표는 더 큼) 대표가 기본값 대비 %로 바꿉니다. 하루는 월의 20%. 회사 월 한도와 둘 중 먼저 닿는 쪽에서 AI 만 멈춥니다(업무·일정은 그대로).</p>
    </section>
  );
}
