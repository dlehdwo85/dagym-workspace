'use client';
import Link from 'next/link';
import { useState } from 'react';
import { ChevronLeft, ChevronRight, Gauge, Plane } from 'lucide-react';
import { useApi } from '@/components/client';
import { Avatar, Button, ErrorBox, PageHeader, Skeleton, cx, fmtDate } from '@/components/ui';

const addDays = (d: string, n: number) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

/** B-16 업무량 보기 */
export default function WorkloadPage() {
  const [week, setWeek] = useState<string | null>(null);
  const { data, error, loading, reload } = useApi<any>(`/api/insights/workload${week ? `?week=${week}` : ''}`);
  const maxDue = Math.max(4, ...(data?.people ?? []).map((p: any) => p.dueThisWeek));
  return (
    <div className="space-y-4">
      <PageHeader title="업무량" icon={Gauge} sub={data ? `${fmtDate(data.weekStart)} ~ ${fmtDate(data.weekEnd)}` : '사람별 이번 주 업무·일정'} actions={
        <div className="flex items-center gap-1">
          <Button variant="secondary" size="sm" onClick={() => setWeek(addDays(data?.weekStart, -7))} disabled={!data} aria-label="지난주"><ChevronLeft /></Button>
          <Button variant="secondary" size="sm" onClick={() => setWeek(null)}>이번 주</Button>
          <Button variant="secondary" size="sm" onClick={() => setWeek(addDays(data?.weekStart, 7))} disabled={!data} aria-label="다음 주"><ChevronRight /></Button>
        </div>
      } />
      {data?.holidays?.length > 0 && <p className="rounded-input bg-red-50 px-3 py-2 text-sm text-red-800">이번 주 공휴일: {data.holidays.map((h: any) => `${fmtDate(h.date)} ${h.name}`).join(', ')} — 가용 근무일에서 뺐습니다</p>}
      {error ? <ErrorBox error={error} retry={reload} /> : loading && !data ? <Skeleton rows={6} /> : (
        <div className="overflow-hidden rounded-card border border-line bg-white shadow-card" data-testid="workload">
          <div className="hidden grid-cols-[minmax(160px,1.2fr)_2fr_90px_90px_90px] gap-4 border-b border-line bg-slate-50 px-4 py-2 text-xs font-medium text-ink-2 md:grid">
            <span>사람</span><span>이번 주 마감 업무</span><span className="text-right">일정 시간</span><span className="text-right">휴가·출장</span><span className="text-right">지연</span>
          </div>
          {data.people.map((p: any) => (
            <div key={p.id} className={cx('grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 border-b border-line px-4 py-3 last:border-b-0 md:grid-cols-[minmax(160px,1.2fr)_2fr_90px_90px_90px]', p.overloaded && 'bg-red-50/40')} data-person={p.name}>
              <Link href={`/tasks?assigneeId=${p.id}`} className="flex min-w-0 items-center gap-2.5 hover:underline">
                <Avatar id={p.id} name={p.name} size={30} />
                <span className="min-w-0"><span className="block truncate text-sm font-medium">{p.name}</span><span className="block truncate text-xs text-ink-3">{p.title ?? ''}</span></span>
              </Link>
              {p.overloaded ? <span className="justify-self-end rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700 md:hidden">과부하</span> : <span className="md:hidden" />}
              <div className="col-span-2 flex items-center gap-2 md:col-span-1">
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <div className={cx('h-full rounded-full', p.overloaded ? 'bg-red-500' : 'bg-accent-500')} style={{ width: `${(p.dueThisWeek / maxDue) * 100}%` }} />
                </div>
                <span className="w-24 text-right text-sm tabular-nums"><b>{p.dueThisWeek}</b>건{p.hot ? <span className="text-orange-600"> · 급 {p.hot}</span> : ''}</span>
                {p.overloaded && <span className="hidden rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700 md:inline">과부하</span>}
              </div>
              <span className="text-sm tabular-nums text-ink-2 md:text-right"><span className="md:hidden">일정 </span>{p.eventHours}시간</span>
              <span className="text-right text-sm tabular-nums text-ink-2">{p.awayDays ? <span className="inline-flex items-center gap-1 text-violet-700"><Plane className="size-3.5" />{p.awayDays}일</span> : '—'}</span>
              <span className={cx('hidden text-right text-sm font-semibold tabular-nums md:block', p.overdue ? 'text-red-600' : 'text-ink-3')}>{p.overdue}</span>
            </div>
          ))}
          {!data.people.length && <p className="px-4 py-10 text-center text-sm text-ink-3">표시할 사람이 없습니다</p>}
        </div>
      )}
      <p className="text-xs text-ink-2">과부하 기준: 이번 주 마감 업무가 가용 근무일×2건 초과, 일정이 가용 시간(하루 8시간)의 70% 초과, 또는 지연 3건 이상. 가용 근무일은 공휴일·휴가·출장을 뺀 날입니다. 다른 사람의 개인 일정은 제목 없이 시간만 합산합니다.</p>
    </div>
  );
}
