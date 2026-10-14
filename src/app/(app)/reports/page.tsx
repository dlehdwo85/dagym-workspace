'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { CalendarRange, FileBarChart, Plus } from 'lucide-react';
import { api, useApi } from '@/components/client';
import { Button, Empty, ErrorBox, PageHeader, Skeleton, cx, fmtDate, fmtDateTime, toast } from '@/components/ui';

/** B-15 주간 보고 목록 (대표·본사 관리자) */
export default function ReportsPage() {
  const router = useRouter();
  const { data, error, loading, reload } = useApi<{ reports: any[] }>('/api/reports');
  async function makeNow() {
    try { const r = await api('/api/reports', { body: {} }); router.push(`/reports/${r.id}`); } catch (e: any) { toast.error(e.message); }
  }
  return (
    <div className="space-y-4">
      <PageHeader title="주간 보고" icon={FileBarChart} sub="매주 월요일 오전 8시 이후 지난주 보고를 자동으로 만들고 대표·본사 관리자에게 알립니다."
        actions={<Button variant="secondary" onClick={makeNow}><Plus />지난주 보고 지금 만들기</Button>} />
      {error ? <ErrorBox error={error} retry={reload} /> : loading && !data ? <Skeleton rows={4} /> : !data?.reports.length ? <Empty title="아직 주간 보고가 없습니다" icon={FileBarChart}>다음 월요일에 자동으로 만들어집니다.</Empty> : (
        <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-white shadow-card" data-testid="reports">
          {data.reports.map((r) => (
            <li key={r.id}>
              <Link href={`/reports/${r.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-slate-50">
                <span className="font-semibold">{fmtDate(r.week_start)} 주</span>
                <span className="text-sm text-ink-2">완료 {r.totals.done} · 새 업무 {r.totals.created} · 지연 <b className={r.totals.overdue ? 'text-red-600' : ''}>{r.totals.overdue}</b> · 미해결 민원 {r.totals.complaints}</span>
                <span className="ml-auto text-xs text-ink-3">{fmtDateTime(r.created_at)} 생성</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <MonthlyCloses />
    </div>
  );
}

type Close = { month: string; user_id: string | null; name: string | null; done_count: number; carried_count: number; overdue_count: number; created_count: number; estimated: boolean };
/** V20 월별 기록: 매월 1일 고정 저장한 지난달 숫자(회사 전체) — 누르면 담당자별 */
function MonthlyCloses() {
  const { data, error } = useApi<{ months: Close[] }>('/api/reports/monthly');
  const sp = useSearchParams();
  const [open, setOpen] = useState<string | null>(sp.get('month'));
  if (error) return null; // 권한 없음 등
  const rows = data?.months ?? [];
  const totals = rows.filter((r) => !r.user_id);
  return (
    <section className="space-y-2" data-testid="month-closes">
      <h2 className="flex items-center gap-2 text-base font-semibold"><CalendarRange className="size-4 text-brand-600" />월별 기록</h2>
      <p className="text-xs text-ink-3">매월 1일 지난달 완료·이월(그달 말에 안 끝난 업무)·지연(이월 중 마감 지남)·새 업무 수를 고정 저장합니다. “추정”은 나중에 소급 계산한 값입니다.</p>
      {!totals.length ? <p className="rounded-card border border-line bg-white px-4 py-3 text-sm text-ink-3">아직 월 마감 기록이 없습니다. 다음 달 1일에 처음 만들어집니다.</p> : (
        <div className="overflow-x-auto rounded-card border border-line bg-white shadow-card">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-ink-2"><tr><th className="px-3 py-2 text-left">달</th><th className="px-3 py-2 text-right">완료</th><th className="px-3 py-2 text-right">이월</th><th className="px-3 py-2 text-right">지연</th><th className="px-3 py-2 text-right">새 업무</th></tr></thead>
            <tbody className="divide-y divide-line">
              {totals.map((t) => {
                const people = rows.filter((r) => r.user_id && r.month === t.month);
                const on = open === t.month;
                return [
                  <tr key={t.month} className={cx('cursor-pointer hover:bg-slate-50', on && 'bg-brand-50/40')} onClick={() => setOpen(on ? null : t.month)} data-month-row={t.month}>
                    <td className="px-3 py-2 font-semibold">{Number(t.month.slice(0, 4))}년 {Number(t.month.slice(5))}월{t.estimated && <span className="ml-1.5 rounded bg-amber-50 px-1 text-[10px] font-medium text-amber-700">추정</span>}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{t.done_count}</td><td className="px-3 py-2 text-right tabular-nums">{t.carried_count}</td>
                    <td className={cx('px-3 py-2 text-right tabular-nums', t.overdue_count > 0 && 'text-red-600')}>{t.overdue_count}</td><td className="px-3 py-2 text-right tabular-nums">{t.created_count}</td>
                  </tr>,
                  ...(on ? people.map((p) => (
                    <tr key={t.month + p.user_id} className="bg-slate-50/60 text-ink-2" data-month-person={p.user_id!}>
                      <td className="py-1.5 pl-8 pr-3">{p.name}</td><td className="px-3 py-1.5 text-right tabular-nums">{p.done_count}</td><td className="px-3 py-1.5 text-right tabular-nums">{p.carried_count}</td>
                      <td className={cx('px-3 py-1.5 text-right tabular-nums', p.overdue_count > 0 && 'text-red-600')}>{p.overdue_count}</td><td className="px-3 py-1.5 text-right tabular-nums">{p.created_count}</td>
                    </tr>)) : []),
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
