'use client';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin, { Draggable } from '@fullcalendar/interaction';
import luxonPlugin from '@fullcalendar/luxon3';
import type { DatesSetArg } from '@fullcalendar/core';
type EventReceiveArg = { event: any; revert: () => void };
import { AlertTriangle, CalendarClock, GripVertical, Sparkles, Timer } from 'lucide-react';
import { api, broadcastRefresh, useApi } from '@/components/client';
import { useSession } from '@/components/session';
import { DueChip, PageHeader, PriorityTag, Skeleton, cx, fmtMinutes, fmtTime, toast } from '@/components/ui';

const seoulDate = (d: Date | string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(d));
const WORK: [number, number][] = [[9 * 60, 12 * 60], [13 * 60, 18 * 60]];

/** 오늘 근무 시간 중 비어 있는 구간 (30분 이상) */
function gaps(events: any[], day: string, now: Date) {
  const base = new Date(`${day}T00:00:00+09:00`).getTime();
  const busy = events.filter((e) => !e.allDay).map((e) => [new Date(e.start).getTime(), new Date(e.end).getTime()] as [number, number]).sort((a, b) => a[0] - b[0]);
  const out: { s: number; e: number }[] = [];
  for (const [ws, we] of WORK) {
    let p = Math.max(base + ws * 60000, now.getTime());
    const end = base + we * 60000;
    for (const [s, e] of busy) {
      if (e <= p || s >= end) continue;
      if (s > p) out.push({ s: p, e: Math.min(s, end) });
      p = Math.max(p, e);
    }
    if (p < end) out.push({ s: p, e: end });
  }
  return out.filter((g) => g.e - g.s >= 30 * 60000);
}

/** S-5 오늘·이번 주: 내 업무를 시간표 빈칸으로 끌어 놓아 실행 시간을 배정 */
export default function PlanPage() {
  const { user } = useSession();
  const tasks = useApi<{ tasks: any[] }>('/api/tasks?view=my&limit=200');
  const risky = useApi<{ tasks: any[] }>('/api/tasks?view=risk&assigneeId=' + user.id);
  const cals = useApi<{ calendars: any[] }>('/api/calendars');
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [days, setDays] = useState<any[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const calRef = useRef<FullCalendar>(null);
  const mobile = typeof window !== 'undefined' && window.innerWidth < 768;
  const personal = cals.data?.calendars.find((c) => c.type === 'personal');
  const riskIds = new Set((risky.data?.tasks ?? []).map((t) => t.id));

  async function load() {
    if (!range) return;
    try {
      const [ev, av] = await Promise.all([
        api(`/api/events?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`),
        api(`/api/availability?from=${seoulDate(range.from)}&to=${seoulDate(new Date(new Date(range.to).getTime() - 1))}`),
      ]);
      // 내 일정만: 참석·개인 캘린더·내가 만든 업무 시간
      setEvents(ev.events.filter((e: any) => e.calendarType === 'personal' || e.attendees.some((a: any) => a.user_id === user.id && a.response !== 'declined') || (e.kind === 'task_block' && e.createdBy === user.id)));
      setDays(av.days);
    } catch (e: any) { toast.error(e.message); }
  }
  useEffect(() => { load(); }, [range]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const h = () => { load(); tasks.reload(); }; window.addEventListener('wos-refresh', h); return () => window.removeEventListener('wos-refresh', h); });

  // 왼쪽 업무 목록을 끌 수 있게
  useEffect(() => {
    if (!listRef.current) return;
    const d = new Draggable(listRef.current, {
      itemSelector: '[data-plan-task]',
      eventData: (el) => {
        const est = Number(el.getAttribute('data-remaining')) || 60;
        return { title: el.getAttribute('data-title') ?? '', duration: { minutes: Math.min(Math.max(30, est), 240) }, create: true, extendedProps: { taskId: el.getAttribute('data-plan-task') } };
      },
    });
    return () => d.destroy();
  }, [tasks.data]);

  async function receive(info: EventReceiveArg) {
    const taskId = info.event.extendedProps.taskId as string;
    const start = info.event.start!, end = info.event.end ?? new Date(start.getTime() + 3600000);
    info.event.remove();
    if (!personal) return toast.error('개인 캘린더가 없습니다');
    try {
      await api('/api/events', { body: { calendarId: personal.id, title: info.event.title, start: start.toISOString(), end: end.toISOString(), taskId, kind: 'task_block' } });
      toast.ok(`${fmtTime(start)}에 실행 시간을 배정했습니다`);
      load(); tasks.reload(); broadcastRefresh();
    } catch (e: any) { toast.error(e.message); }
  }
  async function move(info: any) {
    const e = info.event.extendedProps.ev;
    if (!e || e.recurring) { info.revert(); return; }
    try {
      await api(`/api/events/${e.id}`, { method: 'PATCH', body: { start: info.event.start.toISOString(), end: (info.event.end ?? info.event.start).toISOString(), scope: 'all' } });
      load(); tasks.reload(); broadcastRefresh();
    } catch (er: any) { toast.error(er.message); info.revert(); }
  }

  const today = seoulDate(new Date());
  const todayGaps = useMemo(() => gaps(events.filter((e) => seoulDate(e.start) === today), today, new Date()), [events, today]);
  const open = (tasks.data?.tasks ?? []).filter((t) => t.assignee_id === user.id).sort((a, b) => (a.due_date ?? '9999') < (b.due_date ?? '9999') ? -1 : 1);
  const fc = events.map((e) => ({
    id: `${e.id}|${e.originalStart ?? ''}`, title: e.title.replace(/^(\[(업무|업무 시간)\]\s*)+/, ''), start: e.start, end: e.end, allDay: e.allDay,
    backgroundColor: e.kind === 'task_block' ? '#eff6ff' : e.color, textColor: e.kind === 'task_block' ? '#1d4ed8' : undefined, borderColor: e.kind === 'task_block' ? '#93c5fd' : 'transparent',
    editable: e.kind === 'task_block' && !e.recurring, extendedProps: { ev: e }, classNames: e.kind === 'task_block' ? ['task-block'] : [],
  }));
  const dayInfo = (date: Date) => days.find((d) => d.date === seoulDate(date));

  return (
    <div className="space-y-4">
      <PageHeader title="오늘·이번 주" icon={CalendarClock} sub="왼쪽 업무를 오른쪽 시간표 빈칸으로 끌어 놓으면 그 시간에 업무를 배정합니다" />
      {todayGaps.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-card border border-line bg-white px-4 py-3 text-sm shadow-card" data-testid="focus-gaps">
          <Sparkles className="size-4 text-amber-500" /><span className="font-medium">오늘 집중 가능한 시간</span>
          {todayGaps.map((g, i) => <span key={i} className="rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700">{fmtTime(new Date(g.s))}~{fmtTime(new Date(g.e)).replace(/^(오전|오후) /, '')} · {fmtMinutes(Math.round((g.e - g.s) / 60000))}</span>)}
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        <aside className="rounded-card border border-line bg-white shadow-card">
          <div className="border-b border-line px-4 py-3 text-sm font-semibold">내 업무 <span className="text-xs font-normal text-ink-2">{open.length}건 · 끌어서 배정</span></div>
          {tasks.loading && !tasks.data ? <div className="p-3"><Skeleton rows={5} /></div> : (
            <div ref={listRef} className="max-h-[70vh] space-y-1.5 overflow-y-auto p-2" data-testid="plan-tasks">
              {open.map((t) => {
                const remaining = t.estimate_minutes ? Math.max(0, t.estimate_minutes - (t.scheduled_minutes ?? 0)) : null;
                return (
                  <div key={t.id} data-plan-task={t.id} data-title={t.title} data-remaining={remaining ?? 60}
                    className="group flex cursor-grab items-start gap-2 rounded-input border border-line bg-white px-2.5 py-2 text-sm hover:border-accent-500 hover:shadow-card active:cursor-grabbing">
                    <GripVertical className="mt-0.5 size-4 shrink-0 text-slate-300 group-hover:text-slate-500" />
                    <div className="min-w-0 flex-1">
                      <Link href={`/tasks/${t.id}`} className="line-clamp-2 font-medium hover:underline" onMouseDown={(e) => e.stopPropagation()}>{t.title}</Link>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-2">
                        <DueChip due={t.due_date} status={t.status} /><PriorityTag p={t.priority} label={false} />
                        {t.estimate_minutes ? <span className={cx('inline-flex items-center gap-0.5 tabular-nums', remaining ? 'text-ink-2' : 'text-green-600')}><Timer className="size-3.5" />{remaining ? `${fmtMinutes(remaining)} 미배정` : '배정 완료'}</span> : <span className="text-ink-3">예상 시간 없음</span>}
                        {riskIds.has(t.id) && <span className="inline-flex items-center gap-0.5 font-semibold text-red-600"><AlertTriangle className="size-3.5" />마감 위험</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
              {!open.length && <p className="px-2 py-8 text-center text-sm text-ink-3">남은 업무가 없습니다</p>}
            </div>
          )}
        </aside>
        <div className="rounded-card border border-line bg-white p-3 shadow-card" data-testid="plan-calendar">
          <FullCalendar
            ref={calRef}
            plugins={[timeGridPlugin, interactionPlugin, luxonPlugin]}
            timeZone="Asia/Seoul" locale="ko" firstDay={1} height="auto" nowIndicator allDaySlot
            initialView={mobile ? 'timeGridDay' : 'timeGridWeek'}
            headerToolbar={{ left: 'prev,next today', center: 'title', right: mobile ? '' : 'timeGridDay,timeGridWeek' }}
            buttonText={{ today: '오늘', week: '주', day: '일' }} allDayText="종일"
            slotMinTime="07:00:00" slotMaxTime="21:00:00" scrollTime="08:30:00" businessHours={{ daysOfWeek: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '18:00' }}
            droppable editable eventDurationEditable events={fc}
            datesSet={(a: DatesSetArg) => setRange({ from: a.start.toISOString(), to: a.end.toISOString() })}
            eventReceive={receive} eventDrop={move} eventResize={move}
            eventClick={(i) => { const e = i.event.extendedProps.ev; if (e?.taskId) location.href = `/tasks/${e.taskId}`; else location.href = `/calendar?event=${e.id}`; }}
            dayHeaderContent={(a) => {
              const d = dayInfo(a.date);
              return (
                <div className="py-0.5 leading-tight">
                  <div>{a.text}</div>
                  {d && <div className={cx('text-[10px] font-normal', !d.workday ? 'text-red-500' : d.freeMinutes < 120 ? 'text-amber-600' : 'text-ink-3')}>{d.holiday ?? (d.away ? '휴가·출장' : d.workday ? `가용 ${fmtMinutes(d.freeMinutes) || '0분'}` : '')}</div>}
                </div>
              );
            }}
          />
        </div>
      </div>
    </div>
  );
}
