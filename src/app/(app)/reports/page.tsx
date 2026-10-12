'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FileBarChart, Plus } from 'lucide-react';
import { api, useApi } from '@/components/client';
import { Button, Empty, ErrorBox, PageHeader, Skeleton, fmtDate, fmtDateTime, toast } from '@/components/ui';

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
    </div>
  );
}
