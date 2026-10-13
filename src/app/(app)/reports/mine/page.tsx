'use client';
import { useEffect, useState } from 'react';
import { FileText, Send } from 'lucide-react';
import { api, useApi } from '@/components/client';
import { useSession } from '@/components/session';
import { Button, ErrorBox, PageHeader, Skeleton, cx, fmtDate, fmtDateTime, inputCls, toast } from '@/components/ui';

/** V8 2번 내 주간 보고: 금요일 16시에 자동 초안 → 고쳐서 제출. 대표·관리자는 모두의 보고를 아래에서 */
export default function MyReportPage() {
  const { user } = useSession();
  const admin = user.role === 'owner' || user.role === 'admin';
  const { data, error, loading, reload, setData } = useApi<{ weekStart: string; report: any }>('/api/reports/mine');
  const team = useApi<{ reports: any[] }>(admin ? '/api/reports/team' : null);
  const [body, setBody] = useState('');
  useEffect(() => { if (data?.report) setBody(data.report.body); }, [data?.report?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  async function draft() {
    try { const r = await api('/api/reports/mine', { body: {} }); setData(r); setBody(r.report?.body ?? ''); toast.ok('이번 주 초안을 만들었습니다'); } catch (e: any) { toast.error(e.message); }
  }
  async function save(submit: boolean) {
    try { const r = await api('/api/reports/mine', { method: 'PUT', body: { body, submit } }); setData(r); toast.ok(submit ? '제출했습니다' : '저장했습니다'); team.reload?.(); } catch (e: any) { toast.error(e.message); }
  }
  const r = data?.report;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title="내 주간 보고" icon={FileText} sub="매주 금요일 오후 4시에 이번 주 완료·진행·다음 주 마감·일정으로 초안을 만들어 알려 드립니다. 고쳐서 제출하세요." />
      {error ? <ErrorBox error={error} retry={reload} /> : loading && !data ? <Skeleton rows={4} /> : (
        <section className="rounded-card border border-line bg-white p-4 shadow-card" data-testid="my-report">
          <p className="mb-2 text-sm font-semibold">{fmtDate(data!.weekStart)} 주 {r && <span className={cx('ml-1 rounded-full px-2 py-0.5 text-xs', r.status === 'submitted' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800')}>{r.status === 'submitted' ? `제출 ${fmtDateTime(r.submitted_at)}` : '초안'}</span>}</p>
          {!r ? <Button onClick={draft} data-testid="report-draft">이번 주 초안 지금 만들기</Button> : (
            <>
              <textarea className={cx(inputCls, 'min-h-[320px] font-mono text-[13px] leading-relaxed')} value={body} onChange={(e) => setBody(e.target.value)} aria-label="주간 보고 내용" />
              <div className="mt-2 flex justify-end gap-2">
                <Button variant="secondary" onClick={() => save(false)}>저장</Button>
                <Button onClick={() => save(true)} data-testid="report-submit"><Send />제출</Button>
              </div>
            </>
          )}
        </section>
      )}
      {admin && (
        <section className="space-y-2" data-testid="team-reports">
          <h2 className="text-sm font-semibold">이번 주 모두의 보고</h2>
          {!team.data?.reports.length ? <p className="text-sm text-ink-3">아직 초안이 없습니다 (금요일 오후 4시에 자동으로 만들어집니다)</p> : team.data.reports.map((x) => (
            <details key={x.id} className="rounded-card border border-line bg-white p-3 shadow-card">
              <summary className="cursor-pointer text-sm font-medium">{x.name} <span className={cx('ml-1 rounded-full px-2 py-0.5 text-xs', x.status === 'submitted' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-ink-2')}>{x.status === 'submitted' ? '제출' : '초안'}</span>
                <span className="ml-2 text-xs text-ink-3">완료 {x.data?.done ?? 0} · 진행 {x.data?.open ?? 0} · 지연 {x.data?.overdue ?? 0}</span></summary>
              <pre className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-2">{x.body}</pre>
            </details>
          ))}
        </section>
      )}
    </div>
  );
}
