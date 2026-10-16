'use client';
import { api, useApi } from './client';
import { Button, cx, fmtDateTime, toast } from './ui';

const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`;
const PURPOSE: Record<string, string> = { assistant: '대화', doc_engine: '문서 작업', voice: '음성 보정', classify: '분류', summary: '요약', fill: '자료로 채우기', revenue: '매출 분석', revenue_extract: '매출 입력', library_organize: '자료 정리', chat_to_task: '메시지→업무' };

/**
 * V23 4장·4.3: 관리 > 사용량 — 사람별 이번 달 AI 사용액·남은 한도·건수(대화/문서)·오늘, 대표는 사람별 월 한도 바꾸기,
 * 기다리는 추가 요청 승인·거절, 비싼 요청 상위 10건. 금액은 "건별 결제 가정" 정가(표준 단가 × 환율).
 */
export function AiPeopleBudgets() {
  const { data, reload } = useApi<any>('/api/ai/budgets');
  if (!data) return null;
  async function setLimit(p: any) {
    const v = prompt(`${p.name}님 월 AI 한도(원, 기본 ${p.defaultKrw.toLocaleString('ko-KR')}원)`, String(p.baseKrw));
    if (v === null) return;
    const n = Math.round(Number(v.replace(/[^0-9]/g, '')));
    if (!Number.isFinite(n)) return;
    try { await api('/api/ai/user-limits', { method: 'PUT', body: { userId: p.id, monthlyKrw: n } }); toast.ok('한도를 바꿨습니다'); reload(); } catch (e: any) { toast.error(e.message); }
  }
  async function decide(r: any, approve: boolean) {
    try { await api(`/api/ai/limit-requests/${r.id}`, { method: 'PATCH', body: { approve } }); toast.ok(approve ? '승인했습니다' : '거절했습니다'); reload(); } catch (e: any) { toast.error(e.message); }
  }
  return (
    <section id="ai-people" className="rounded-card border border-line bg-white p-4 shadow-card" data-testid="ai-people">
      <h2 className="text-sm font-semibold">사람별 AI 한도 <span className="font-normal text-ink-3">— {data.month} · 건별 결제 가정 정가 합계 {won(data.totalKrw)} (${data.totalUsd}) · 환율 {data.usdKrw.toLocaleString('ko-KR')}원</span></h2>
      {data.pending.length > 0 && (
        <ul className="mt-2 space-y-1.5" data-testid="ai-limit-pending">
          {data.pending.map((r: any) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-input bg-amber-50 px-3 py-2 text-sm">
              <b>{r.name}</b> +{won(r.amount_krw)} 추가 요청{r.reason && <span className="text-ink-2">· {r.reason}</span>}<span className="text-xs text-ink-3">{fmtDateTime(r.created_at)}</span>
              {data.canEdit && <span className="ml-auto flex gap-1.5"><Button size="sm" onClick={() => decide(r, true)} data-testid="ai-limit-approve">승인</Button><Button size="sm" variant="secondary" onClick={() => decide(r, false)}>거절</Button></span>}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead><tr className="border-b border-line text-left text-xs text-ink-3"><th className="py-1.5">이름</th><th>사용 / 한도</th><th>남음</th><th>오늘 / 하루 한도</th><th>대화·문서</th><th /></tr></thead>
          <tbody>
            {data.people.map((p: any) => (
              <tr key={p.id} className="border-b border-line last:border-0" data-testid="ai-person">
                <td className="py-1.5 font-medium">{p.name}</td>
                <td><span className={cx(p.pct >= 100 ? 'text-red-600' : p.pct >= 80 ? 'text-amber-700' : '')}>{won(p.usedKrw)}</span> / {won(p.limitKrw)}{p.extraKrw > 0 && <span className="text-xs text-ink-3"> (+{won(p.extraKrw)})</span>}
                  <div className="mt-0.5 h-1 w-28 overflow-hidden rounded-full bg-slate-100"><div className={cx('h-full', p.pct >= 100 ? 'bg-red-500' : p.pct >= 80 ? 'bg-amber-500' : 'bg-brand-600')} style={{ width: `${Math.min(100, p.pct)}%` }} /></div></td>
                <td>{won(p.remainingKrw)}</td>
                <td className="text-xs">{won(p.todayKrw)} / {won(p.dayLimitKrw)}</td>
                <td className="text-xs">{p.chats}건 · {p.docs}건</td>
                <td className="text-right">{data.canEdit && <Button size="sm" variant="ghost" onClick={() => setLimit(p)} data-testid="ai-person-limit">한도 바꾸기</Button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.top.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-semibold text-ink-2">비싼 요청 상위 {data.top.length}건</summary>
          <ul className="mt-1 space-y-0.5 text-xs" data-testid="ai-top-requests">
            {data.top.map((t: any, k: number) => <li key={k} className="flex gap-2"><span className="w-16 text-right font-semibold tabular-nums">{won(t.krw)}</span><span>{t.name ?? '-'}</span><span className="text-ink-3">{PURPOSE[t.purpose] ?? t.purpose} · {t.calls}번 호출 · {fmtDateTime(t.at)}</span></li>)}
          </ul>
        </details>
      )}
      <p className="mt-2 text-[11px] text-ink-3">한도: 대표 기본 20,000원·그 밖 10,000원(사람별로 바꿈), 하루는 월의 20%. 회사 월 한도와 둘 중 먼저 닿는 쪽에서 AI 만 멈춥니다(업무·일정은 그대로).</p>
    </section>
  );
}
