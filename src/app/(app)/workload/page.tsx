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
      {data?.people?.length > 0 && (
        <section className="overflow-x-auto rounded-card border border-line bg-white p-4 shadow-card" data-testid="workload-heatmap">
          <h2 className="mb-3 text-sm font-semibold">요일별 바쁜 정도 <span className="text-xs font-normal text-ink-2">회의 + 업무 시간 ÷ 근무 8시간</span></h2>
          <table className="w-full min-w-[560px] text-xs">
            <thead><tr className="text-ink-2"><th className="w-32 pb-2 text-left font-medium">사람</th>{data.people[0].days.map((d: any) => <th key={d.date} className="pb-2 font-medium">{'일월화수목금토'[new Date(d.date + 'T00:00:00Z').getUTCDay()]} {Number(d.date.slice(8))}</th>)}<th className="pb-2 text-right font-medium">이번 주</th></tr></thead>
            <tbody>
              {data.people.map((p: any) => (
                <tr key={p.id}>
                  <td className="truncate py-1 pr-2 font-medium">{p.name}</td>
                  {p.days.map((d: any) => {
                    const ratio = d.capacity ? d.busy / d.capacity : 0;
                    const tone = !d.workday ? 'bg-slate-100 text-ink-3' : ratio >= 0.9 ? 'bg-red-500 text-white' : ratio >= 0.7 ? 'bg-orange-400 text-white' : ratio >= 0.4 ? 'bg-amber-200 text-amber-900' : ratio > 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-50 text-ink-3';
                    return <td key={d.date} className="p-0.5"><div className={cx('flex h-8 items-center justify-center rounded-md tabular-nums', tone)} title={`${d.date} ${d.holiday ?? (d.away ? '휴가·출장' : `바쁨 ${Math.round(d.busy / 6) / 10}시간`)}`}>{d.holiday ? '휴일' : d.away ? '휴가' : !d.workday ? '' : `${Math.round(ratio * 100)}%`}</div></td>;
                  })}
                  <td className="py-1 pl-2 text-right tabular-nums text-ink-2">회의 {p.meetingHours}h · 업무 {p.blockHours}h · 가용 {p.freeHours}h</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      <SpeedTable />
      <p className="text-xs text-ink-2">과부하 기준: 이번 주 마감 업무가 가용 근무일×2건 초과, 회의·업무 시간 블록이 근무 시간(하루 8시간, 점심 제외)의 70% 초과, 또는 지연 3건 이상. 가용 근무일은 공휴일·휴가·출장을 뺀 날입니다. 다른 사람의 개인 일정은 제목 없이 시간만 합산합니다.</p>
    </div>
  );
}

/** R-15 4번 직원별 업무 처리 속도(최근 90일 완료 업무): 만든 뒤 완료까지·시작 뒤 완료까지·지연 비율·체크리스트 항목 */
function SpeedTable() {
  const { data } = useApi<{ people: any[] }>('/api/insights/speed');
  if (!data?.people.length) return null;
  return (
    <section className="overflow-x-auto rounded-card border border-line bg-white p-3 shadow-card" data-testid="speed-table">
      <h2 className="mb-2 text-sm font-semibold">처리 속도 <span className="font-normal text-ink-3">최근 90일 완료 업무 · 업무 상세의 &ldquo;예상 처리 기간&rdquo;에 쓰입니다</span></h2>
      <table className="w-full min-w-[560px] text-sm">
        <thead><tr className="text-left text-xs text-ink-3"><th className="py-1">사람</th><th>완료</th><th>만든 뒤 완료(중앙값·평균)</th><th>시작 뒤 완료</th><th>지연 비율</th><th>체크리스트 항목</th></tr></thead>
        <tbody className="divide-y divide-line">
          {data.people.map((p) => (
            <tr key={p.user_id}><td className="py-1.5"><span className="flex items-center gap-1.5"><Avatar id={p.user_id} name={p.name} size={20} />{p.name}</span></td>
              <td className="tabular-nums">{p.done}건</td><td className="tabular-nums">{p.median_days}일 · {p.avg_days}일</td><td className="tabular-nums">{p.work_days != null ? `${p.work_days}일` : '-'}</td>
              <td className={cx('tabular-nums', p.late_rate >= 30 ? 'font-semibold text-red-600' : '')}>{p.late_rate != null ? `${p.late_rate}%` : '-'}</td>
              <td className="tabular-nums text-ink-2">{p.checklist ? `${p.checklist.n}개 · 평균 ${p.checklist.hours}시간` : '-'}</td></tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
