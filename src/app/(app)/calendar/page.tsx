'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { DateField, TimeSelect, nextHour, shiftEnd } from '@/components/DateTimePickers';
import { useRouter, useSearchParams } from 'next/navigation';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin, { Draggable } from '@fullcalendar/interaction';
import luxonPlugin from '@fullcalendar/luxon3';
import type { EventDropArg, DatesSetArg, EventClickArg } from '@fullcalendar/core';
import { api, broadcastRefresh, useApi } from '@/components/client';
import { useSession } from '@/components/session';
import { CalendarPlus, Check, ChevronLeft, ChevronRight, CircleCheck, ClipboardList, Clock, ExternalLink, ListChecks, MapPin, Pencil, Timer, Trash2, Users, X } from 'lucide-react';
import { Avatar, AvatarStack, avatarColor, initials, Button, DueChip, ErrorBox, Field, Modal, StatusBadge, cx, fmtDateTime, fmtTime, fmtTimeRange, inputCls, toast } from '@/components/ui';
import { TaskDetail } from '@/components/TaskDetail';
import { EventWork, LinkedTaskList } from '@/components/EventWork';
import { MultiUserSelect, RecurSelect, ReminderEditor } from '@/components/pickers';
import { Attachments } from '@/components/Attachments';
import { EVENT_KIND_LABEL } from '@/lib/types';

type Scope = 'this' | 'following' | 'all';
const seoulDate = (d: Date | string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(d));
const seoulTime = (d: Date | string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(d));
const addDays = (d: string, n: number) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

/** 반복 일정 수정·삭제 범위 선택 */
function askScope(): Promise<Scope | null> {
  return new Promise((resolve) => {
    const ev = new CustomEvent('wos-scope', { detail: resolve });
    window.dispatchEvent(ev);
  });
}
function ScopeDialog() {
  const [resolver, setResolver] = useState<((s: Scope | null) => void) | null>(null);
  const [scope, setScope] = useState<Scope>('this');
  useEffect(() => {
    const h = (e: Event) => { setScope('this'); setResolver(() => (e as CustomEvent).detail); };
    window.addEventListener('wos-scope', h);
    return () => window.removeEventListener('wos-scope', h);
  }, []);
  const close = (v: Scope | null) => { resolver?.(v); setResolver(null); };
  return (
    <Modal open={!!resolver} onClose={() => close(null)} title="반복 일정 적용 범위">
      <div className="space-y-2" role="radiogroup">
        {([['this', '이번 일정만'], ['following', '이번 및 이후 일정'], ['all', '모든 일정']] as [Scope, string][]).map(([v, l]) => (
          <label key={v} className="flex items-center gap-2 text-sm"><input type="radio" name="scope" checked={scope === v} onChange={() => setScope(v)} />{l}</label>
        ))}
      </div>
      <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={() => close(null)}>취소</Button><Button onClick={() => close(scope)}>확인</Button></div>
    </Modal>
  );
}

export default function CalendarPage() {
  const { dir, user } = useSession();
  const sp = useSearchParams();
  const router = useRouter();
  const cals = useApi<{ calendars: any[] }>('/api/calendars');
  const [hidden, setHidden] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('wos_cal_hidden') ?? '[]'); } catch { return []; } });
  const [showTasks, setShowTasks] = useState<boolean>(() => { try { return localStorage.getItem('wos_cal_tasks') !== '0'; } catch { return true; } });
  const [sidePanel, setSidePanel] = useState<boolean>(() => { try { const v = localStorage.getItem('wos_cal_unscheduled'); return v === null ? typeof window !== 'undefined' && window.innerWidth >= 1440 : v === '1'; } catch { return false; } });
  const [range, setRange] = useState<{ from: string; to: string; start: Date; view: string } | null>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [err, setErr] = useState<any>(null);
  const [editor, setEditor] = useState<{ id?: string; occurrenceStart?: string; draft?: any } | null>(null);
  const [quick, setQuick] = useState<{ x: number; y: number; date: string; start?: string; end?: string; endDate?: string; allDay: boolean } | null>(null);
  const [openTask, setOpenTask] = useState<string | null>(null);
  // WORKIN_V4 사람 필터: 'all' · 'mine' · [사람 id…] (여러 명), 이 기기에 기억
  const [who, setWhoState] = useState<'all' | 'mine' | string[]>('all');
  // 저장된 선택은 화면이 뜬 뒤 읽는다(서버 렌더 값으로 덮어쓰지 않게), 바꿀 때만 저장
  useEffect(() => { try { const v = JSON.parse(localStorage.getItem('wos_cal_people') ?? '"all"'); if (v === 'mine' || Array.isArray(v)) setWhoState(v); } catch {} }, []);
  const setWho = (v: 'all' | 'mine' | string[] | ((w: 'all' | 'mine' | string[]) => 'all' | 'mine' | string[])) => setWhoState((w) => {
    const n = typeof v === 'function' ? v(w) : v;
    try { localStorage.setItem('wos_cal_people', JSON.stringify(n)); } catch {}
    return n;
  });
  const hqIds = new Set(dir.orgUnits.filter((o) => o.type === 'hq').map((o) => o.id));
  const people = [...dir.users.filter((u) => u.id === user.id), ...dir.users.filter((u) => u.id !== user.id && u.org_unit_ids?.some((id) => hqIds.has(id)))];
  const pickPerson = (id: string) => setWho((w) => { const cur = Array.isArray(w) ? w : []; const n = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]; return n.length ? n : 'all'; });
  const showEvent = (e: any) => {
    if (who === 'all') return true;
    const ids = who === 'mine' ? [user.id] : who;
    return ids.includes(e.ownerId) || ids.includes(e.createdBy) || (e.attendees ?? []).some((a: any) => ids.includes(a.user_id));
  };
  const showTask = (t: any) => who === 'all' || (who === 'mine' ? t.assignee_id === user.id : who.includes(t.assignee_id));
  const calRef = useRef<FullCalendar>(null);
  const mobile = typeof window !== 'undefined' && window.innerWidth < 640;
  const touch = typeof window !== 'undefined' && (window.innerWidth < 640 || !!window.matchMedia?.('(pointer: coarse)').matches);

  useEffect(() => { try { localStorage.setItem('wos_cal_hidden', JSON.stringify(hidden)); localStorage.setItem('wos_cal_tasks', showTasks ? '1' : '0'); localStorage.setItem('wos_cal_unscheduled', sidePanel ? '1' : '0'); } catch {} }, [hidden, showTasks, sidePanel]);
  // B-17 공휴일 + Google Calendar 와 같은 단축키 D·W·M·A·T·C
  const hol = useApi<{ holidays: { date: string; name: string }[] }>('/api/holidays');
  const holidaySet = useMemo(() => new Map((hol.data?.holidays ?? []).map((h) => [h.date, h.name])), [hol.data]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable || document.querySelector('[role=dialog]')) return;
      const api = calRef.current?.getApi();
      if (!api) return;
      const k = e.key.toLowerCase();
      const view = ({ d: 'timeGridDay', w: 'timeGridWeek', m: 'dayGridMonth', a: 'listWeek' } as Record<string, string>)[k];
      if (view) { e.preventDefault(); api.changeView(view); }
      else if (k === 't') { e.preventDefault(); api.today(); }
      else if (k === 'c') { e.preventDefault(); setEditor({ draft: { date: seoulDate(new Date()) } }); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  useEffect(() => {
    const id = sp.get('event'); if (id) setEditor({ id });
    if (sp.get('new') === '1') { setEditor({ draft: { date: seoulDate(new Date()) } }); router.replace('/calendar'); }
  }, [sp]); // eslint-disable-line react-hooks/exhaustive-deps
  const [preview, setPreview] = useState<{ ev: any; x: number; y: number } | null>(null);

  async function load() {
    if (!range) return;
    try {
      const [ev, tk] = await Promise.all([
        api(`/api/events?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`),
        api(`/api/tasks?view=all&includeDone=1&from=${seoulDate(range.from)}&to=${seoulDate(range.to)}&limit=500`),
      ]);
      setEvents(ev.events); setTasks(tk.tasks); setErr(null);
    } catch (e) { setErr(e); }
  }
  useEffect(() => { load(); }, [range?.from, range?.to]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const h = () => load(); window.addEventListener('wos-refresh', h); return () => window.removeEventListener('wos-refresh', h); });

  const fcEvents = useMemo(() => [
    ...(hol.data?.holidays ?? []).map((h) => ({ id: `holiday|${h.date}`, title: h.name, start: h.date, allDay: true, editable: false, durationEditable: false,
      backgroundColor: '#fef2f2', borderColor: 'transparent', textColor: '#dc2626', classNames: ['holiday'], extendedProps: { type: 'holiday' } })),
    ...events.filter((e) => !hidden.includes(e.calendarId) && showEvent(e)).map((e) => ({
      id: `${e.id}|${e.originalStart ?? ''}`, title: `${e.ownerId && e.ownerId !== user.id && e.calendarType === 'personal' ? `${initials(e.ownerName ?? '')} · ` : ''}${e.kind === 'vacation' || e.kind === 'business_trip' ? `[${EVENT_KIND_LABEL[e.kind as keyof typeof EVENT_KIND_LABEL]}] ` : ''}${cleanTitle(e.title)}`,
      classNames: e.kind === 'task_block' ? ['task-block'] : [],
      start: e.allDay ? seoulDate(e.start) : e.start, end: e.allDay ? seoulDate(e.end) : e.end, allDay: e.allDay,
      // 다른 사람의 개인 일정은 그 사람 색(아바타와 같은 색)으로, 보기만
      backgroundColor: e.kind === 'vacation' ? '#a855f7' : e.kind === 'business_trip' ? '#0891b2' : e.calendarType === 'personal' && e.ownerId && e.ownerId !== user.id ? avatarColor(e.ownerId) : e.color, borderColor: 'transparent',
      extendedProps: { type: 'event', ev: e }, editable: !(e.calendarType === 'personal' && e.ownerId !== user.id && e.createdBy !== user.id),
    })),
    // HQ_SIMPLIFY 3-4: "업무" 캘린더 — 마감일(마감 시각이 있으면 그 시각) 칸에 체크 모양으로
    ...(showTasks ? tasks.filter((t) => t.due_date && t.show_on_calendar !== false && showTask(t)).map((t) => ({
      id: `task|${t.id}`, title: t.title,
      start: t.due_time ? `${t.due_date}T${t.due_time}:00+09:00` : t.due_date, end: t.due_time ? new Date(new Date(`${t.due_date}T${t.due_time}:00+09:00`).getTime() + 30 * 60000).toISOString() : undefined,
      allDay: !t.due_time, backgroundColor: '#ffffff', borderColor: t.status !== 'done' && t.due_date < seoulDate(new Date()) ? '#fca5a5' : '#c7d2fe',
      textColor: t.status === 'done' ? '#9ca3af' : '#1e3a8a', classNames: ['task-item', ...(t.status === 'done' ? ['is-done'] : [])], extendedProps: { type: 'task', task: t }, durationEditable: false,
    })) : []),
  ], [events, tasks, hidden, showTasks, hol.data, who]); // eslint-disable-line react-hooks/exhaustive-deps

  async function completeTask(t: any) {
    const to = t.status === 'done' ? 'in_progress' : t.status === 'review' ? 'done' : t.approval_line_id || (t.approval_required && user.role === 'staff') ? 'review' : 'done';
    setTasks((xs) => xs.map((x) => (x.id === t.id ? { ...x, status: to } : x)));
    try {
      await api(`/api/tasks/${t.id}`, { method: 'PATCH', body: { status: to, version: t.version } });
      toast.ok(to === 'done' ? '완료했습니다' : to === 'review' ? '검토를 요청했습니다' : '다시 진행 중으로 바꿨습니다'); broadcastRefresh();
    } catch (e: any) { toast.error(e.message); }
    load();
  }

  async function moveEvent(info: EventDropArg | any) {
    const p = info.event.extendedProps;
    if (p.type === 'holiday') { info.revert(); return; }
    if (p.type === 'task') {
      const t = p.task;
      const nd = seoulDate(info.event.start);
      try {
        const shift = Math.round((Date.parse(nd) - Date.parse(t.due_date)) / 86400000);
        await api(`/api/tasks/${t.id}`, { method: 'PATCH', body: { dueDate: nd, ...(!info.event.allDay ? { dueTime: seoulTime(info.event.start) } : t.due_time ? { dueTime: null } : {}), ...(t.start_date ? { startDate: addDays(t.start_date, shift) } : {}), version: t.version } });
        toast.ok('업무 마감을 옮겼습니다'); broadcastRefresh();
      } catch (e: any) { toast.error(e.message); info.revert(); }
      load();
      return;
    }
    const e = p.ev;
    let scope: Scope = 'all';
    if (e.recurring && !e.exception) {
      const s = await askScope();
      if (!s) { info.revert(); return; }
      scope = s;
    } else if (e.exception) scope = 'this';
    const allDay = info.event.allDay;
    const start = allDay ? `${seoulDate(info.event.start)}T00:00:00+09:00` : info.event.start.toISOString();
    const endD = info.event.end ?? new Date(info.event.start.getTime() + (allDay ? 86400000 : new Date(e.end).getTime() - new Date(e.start).getTime()));
    const end = allDay ? `${seoulDate(endD)}T00:00:00+09:00` : endD.toISOString();
    try {
      await api(`/api/events/${e.id}`, { method: 'PATCH', body: { start, end, allDay, scope, occurrenceStart: e.originalStart ?? undefined } });
      toast.ok('일정을 이동했습니다'); broadcastRefresh();
    } catch (er: any) { toast.error(er.message); info.revert(); }
    load();
  }

  function onClick(i: EventClickArg) {
    i.jsEvent.preventDefault();
    const p = i.event.extendedProps;
    if (p.type === 'holiday') return;
    if (p.type === 'task') {
      if ((i.jsEvent.target as HTMLElement).closest('[data-task-check]')) return;
      setOpenTask(p.task.id); return;
    }
    const r = (i.el as HTMLElement).getBoundingClientRect();
    setPreview({ ev: p.ev, x: Math.min(window.innerWidth - 376, Math.max(16, r.left)), y: Math.min(window.innerHeight - 380, r.bottom + 6) });
  }

  // 미배정 업무를 시간 칸으로 끌어 놓기 → 업무 시간 블록 (기존 /plan 기능)
  const personal = cals.data?.calendars.find((c) => c.type === 'personal');
  async function receive(info: any) {
    const taskId = info.event.extendedProps.taskId as string;
    const start = info.event.start as Date, end = (info.event.end as Date | null) ?? new Date(start.getTime() + 3600000);
    const title = info.event.title as string;
    info.event.remove();
    if (!personal) return toast.error('개인 캘린더가 없습니다');
    try {
      await api('/api/events', { body: { calendarId: personal.id, title, start: start.toISOString(), end: end.toISOString(), taskId, kind: 'task_block' } });
      toast.ok(`${fmtTimeRange(start, end)} 업무 시간을 잡았습니다`); load(); broadcastRefresh();
    } catch (e: any) { toast.error(e.message); }
  }

  const goto = (d: string) => calRef.current?.getApi().gotoDate(d);
  const visibleStart = range ? seoulDate(range.start) : seoulDate(new Date());

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold tracking-tight">캘린더</h1>
        <div className="flex items-center gap-2">
          <Button variant="secondary" className="hidden lg:inline-flex" onClick={() => setSidePanel(!sidePanel)} aria-pressed={sidePanel}><ListChecks />미배정 업무</Button>
          <Button onClick={() => { const v = calRef.current?.getApi().getDate(); const d = v ? seoulDate(v) : seoulDate(new Date()); const h = nextHour(); setEditor({ draft: { date: d, start: h.start, end: h.end } }); }}><CalendarPlus />일정 등록</Button>
        </div>
      </div>
      <ErrorBox error={err} retry={load} />
      <div className="flex items-start gap-4">
        {/* 왼쪽: 미니 달력 + 캘린더 목록 (Google Calendar 형태) */}
        <aside className="hidden w-56 shrink-0 space-y-4 lg:block" aria-label="캘린더 목록">
          <MiniMonth anchor={visibleStart} holidays={holidaySet} onPick={goto} />
          <div>
            <p className="mb-1.5 px-1 text-xs font-semibold text-ink-2">내 캘린더</p>
            <ul className="space-y-0.5" data-testid="calendar-list">
              {cals.data?.calendars.map((c) => (
                <li key={c.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-input px-1.5 py-1 text-sm hover:bg-slate-100">
                    <input type="checkbox" className="size-4 rounded" style={{ accentColor: c.color }} checked={!hidden.includes(c.id)} onChange={() => setHidden(hidden.includes(c.id) ? hidden.filter((x) => x !== c.id) : [...hidden, c.id])} />
                    <span className="truncate">{c.type === 'personal' ? '내 일정' : c.name}</span>
                  </label>
                </li>
              ))}
              <li>
                <label className="flex cursor-pointer items-center gap-2 rounded-input px-1.5 py-1 text-sm hover:bg-slate-100">
                  <input type="checkbox" className="size-4 rounded accent-indigo-600" checked={showTasks} onChange={() => setShowTasks(!showTasks)} aria-label="업무 캘린더 표시" />
                  <span className="flex items-center gap-1"><CircleCheck className="size-3.5 text-indigo-600" />업무</span>
                </label>
              </li>
            </ul>
          </div>
        </aside>
        <div className="min-w-0 flex-1 rounded-card border border-line bg-white p-3 shadow-card" data-testid="calendar">
          <div className="-mx-1 mb-2 flex gap-1.5 overflow-x-auto px-1 pb-0.5 text-sm" role="group" aria-label="누구의 일정" data-testid="people-filter">
            <PeopleChip on={who === 'all'} onClick={() => setWho('all')}>전체</PeopleChip>
            <PeopleChip on={who === 'mine'} onClick={() => setWho('mine')}>내 일정</PeopleChip>
            {people.filter((p) => p.id !== user.id).map((p) => (
              <PeopleChip key={p.id} on={Array.isArray(who) && who.includes(p.id)} onClick={() => pickPerson(p.id)} label={`${p.name} 일정`}>
                <span className="size-2.5 rounded-full" style={{ background: avatarColor(p.id) }} />{p.name}
              </PeopleChip>
            ))}
          </div>
          <div className="mb-2 flex flex-wrap gap-1.5 text-xs lg:hidden" aria-label="표시할 캘린더">
            {cals.data?.calendars.map((c) => (
              <button key={c.id} onClick={() => setHidden(hidden.includes(c.id) ? hidden.filter((x) => x !== c.id) : [...hidden, c.id])} aria-pressed={!hidden.includes(c.id)}
                className={cx('flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium', hidden.includes(c.id) ? 'border-line text-ink-3 line-through' : 'border-line text-ink')}>
                <span className="size-2.5 rounded-full" style={{ background: hidden.includes(c.id) ? '#e2e8f0' : c.color }} />{c.type === 'personal' ? '내 일정' : c.name}
              </button>
            ))}
            <button onClick={() => setShowTasks(!showTasks)} aria-pressed={showTasks} className={cx('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium', showTasks ? 'border-indigo-300 text-indigo-700' : 'border-line text-ink-3 line-through')}><CircleCheck className="size-3.5" />업무</button>
          </div>
          <FullCalendar
            ref={calRef}
            plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin, luxonPlugin]}
            timeZone="Asia/Seoul" locale="ko" firstDay={1} height="auto" nowIndicator
            initialView={mobile ? 'timeGridDay' : 'timeGridWeek'}
            initialDate={/^\d{4}-\d{2}-\d{2}$/.test(sp.get('date') ?? '') ? sp.get('date')! : undefined}
            headerToolbar={mobile ? { left: 'prev,next', center: 'title', right: 'today' } : { left: 'today prev,next title', center: '', right: 'timeGridDay,timeGridWeek,dayGridMonth,listWeek' }}
            footerToolbar={mobile ? { center: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek' } : undefined}
            buttonText={{ today: '오늘', month: '월', week: '주', day: '일', list: '일정목록' }}
            allDayText="종일" noEventsText="일정이 없습니다" dayMaxEvents={4} slotMinTime="06:00:00" scrollTime="08:00:00"
            editable selectable selectMirror droppable longPressDelay={350}
            events={fcEvents}
            datesSet={(a: DatesSetArg) => setRange({ from: a.start.toISOString(), to: a.end.toISOString(), start: a.view.currentStart, view: a.view.type })}
            eventClick={onClick}
            eventReceive={receive}
            eventContent={(arg) => {
              const p = arg.event.extendedProps;
              if (p.type === 'task') {
                const t = p.task;
                return (
                  <div className="flex min-w-0 items-center gap-1 overflow-hidden px-0.5 text-[12px]" data-task-item={t.id}>
                    <button type="button" data-task-check onClick={(e) => { e.stopPropagation(); completeTask(t); }} aria-label={`${t.title} ${t.status === 'done' ? '완료 취소' : '완료'}`}
                      className={cx('flex size-3.5 shrink-0 items-center justify-center rounded-full border', t.status === 'done' ? 'border-indigo-500 bg-indigo-500 text-white' : 'border-indigo-400 bg-white hover:bg-indigo-50')}>
                      {t.status === 'done' && <Check className="size-2.5" strokeWidth={3} />}
                    </button>
                    {arg.timeText && <span className="shrink-0 opacity-70">{arg.timeText}</span>}
                    <span className={cx('truncate font-medium', t.status === 'done' && 'line-through')}>{arg.event.title}</span>
                  </div>
                );
              }
              if (arg.event.classNames.includes('task-block')) return <div className="flex min-w-0 items-center gap-1 overflow-hidden px-0.5 text-[12px]"><Timer className="size-3 shrink-0" aria-label="업무 시간" />{arg.timeText && <span className="shrink-0 opacity-80">{arg.timeText}</span>}<span className="truncate font-medium">{arg.event.title}</span></div>;
              return true;
            }}
            dayCellClassNames={(a) => { const d = seoulDate(a.date); return holidaySet.has(d) ? ['is-holiday'] : []; }}
            dayHeaderClassNames={(a) => (a.view.type !== 'dayGridMonth' && holidaySet.has(seoulDate(a.date)) ? ['is-holiday'] : [])}
            eventDrop={moveEvent}
            eventResize={moveEvent}
            // 휴대폰: 빈 칸 한 번 탭 = 그 시각 1시간 임시 블록 + 빠른 등록 (길게 누를 필요 없음). 월 보기 날짜 탭 = 그날 종일
            dateClick={(info) => {
              if (!touch) return; // PC 는 클릭·끌기 선택(select)으로 처리
              const api = calRef.current?.getApi(); if (!api) return;
              if (info.allDay) api.select(info.dateStr.slice(0, 10));
              else api.select(info.date, new Date(info.date.getTime() + 3600000));
            }}
            select={(s) => {
              const js = (s.jsEvent as MouseEvent | undefined);
              const x = js?.clientX ?? window.innerWidth / 2, y = js?.clientY ?? 200;
              setQuick({ x: Math.min(window.innerWidth - 336, Math.max(16, x - 160)), y: Math.min(window.innerHeight - 330, Math.max(16, y + 8)), date: seoulDate(s.start), allDay: s.allDay,
                start: s.allDay ? undefined : seoulTime(s.start), end: s.allDay ? undefined : seoulTime(s.end), endDate: s.allDay ? addDays(seoulDate(s.end), -1) : seoulDate(s.end) });
            }}
          />
        </div>
        {sidePanel && <UnscheduledPanel onClose={() => setSidePanel(false)} onOpen={setOpenTask} />}
      </div>
      <p className="text-xs text-ink-2">빈 칸을 누르거나 끌면 빠른 입력, 업무는 체크로 완료합니다. 오른쪽 “미배정 업무”를 시간 칸으로 끌어 놓으면 업무 시간이 잡힙니다. 단축키 D·W·M·A·T·C</p>
      <ScopeDialog />
      {quick && <QuickCreate {...quick} sheet={touch} calendars={cals.data?.calendars ?? []} onClose={() => { setQuick(null); calRef.current?.getApi().unselect(); }}
        onMore={(draft) => { setQuick(null); setEditor({ draft }); }} onSaved={() => { setQuick(null); calRef.current?.getApi().unselect(); load(); broadcastRefresh(); }} />}
      {preview && <EventPreview ev={preview.ev} x={preview.x} y={preview.y} calendarName={cals.data?.calendars.find((c) => c.id === preview.ev.calendarId)?.name}
        onClose={() => setPreview(null)} onEdit={() => { setEditor({ id: preview.ev.id, occurrenceStart: preview.ev.originalStart ?? undefined }); setPreview(null); }} onChanged={() => { setPreview(null); load(); broadcastRefresh(); }} />}
      {editor && <EventEditor {...editor} calendars={cals.data?.calendars ?? []} onClose={() => { setEditor(null); if (sp.get('event')) router.replace('/calendar'); }} onSaved={() => { load(); broadcastRefresh(); }} dirUsers={dir.users} />}
      {openTask && (
        <aside className="fixed inset-0 z-40 animate-slide-in overflow-y-auto bg-white shadow-pop sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[min(640px,100vw-240px)] sm:border-l sm:border-line" data-testid="task-panel" aria-label="업무 상세 패널">
          <TaskDetail key={openTask} id={openTask} inPanel onClose={() => { setOpenTask(null); load(); }} />
        </aside>
      )}
    </div>
  );
}

/** Google 형 미니 달력: 날짜를 누르면 그 날짜로 이동 */
function MiniMonth({ anchor, holidays, onPick }: { anchor: string; holidays: Map<string, string>; onPick: (d: string) => void }) {
  const [month, setMonth] = useState(anchor.slice(0, 7));
  useEffect(() => { setMonth(anchor.slice(0, 7)); }, [anchor]);
  const first = new Date(`${month}-01T00:00:00Z`);
  const startDow = (first.getUTCDay() + 6) % 7; // 월요일 시작
  const cells = Array.from({ length: 42 }, (_, i) => addDays(`${month}-01`, i - startDow));
  const today = seoulDate(new Date());
  const shift = (n: number) => { const d = new Date(`${month}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); setMonth(d.toISOString().slice(0, 7)); };
  return (
    <div className="rounded-card border border-line bg-white p-2.5 shadow-card" data-testid="mini-month">
      <div className="mb-1 flex items-center justify-between px-1">
        <span className="text-sm font-semibold tabular-nums">{Number(month.slice(0, 4))}년 {Number(month.slice(5))}월</span>
        <span className="flex">
          <button type="button" onClick={() => shift(-1)} className="rounded p-1 text-ink-2 hover:bg-slate-100" aria-label="이전 달"><ChevronLeft className="size-4" /></button>
          <button type="button" onClick={() => shift(1)} className="rounded p-1 text-ink-2 hover:bg-slate-100" aria-label="다음 달"><ChevronRight className="size-4" /></button>
        </span>
      </div>
      <div className="grid grid-cols-7 text-center text-[11px]">
        {'월화수목금토일'.split('').map((d, i) => <span key={d} className={cx('py-0.5 font-medium text-ink-3', i === 6 && 'text-red-400')}>{d}</span>)}
        {cells.map((d) => {
          const inMonth = d.slice(0, 7) === month;
          const sun = new Date(d + 'T00:00:00Z').getUTCDay() === 0;
          return (
            <button key={d} type="button" onClick={() => onPick(d)} title={holidays.get(d)} aria-label={`${d}로 이동`}
              className={cx('mx-auto flex size-7 items-center justify-center rounded-full tabular-nums hover:bg-slate-100', !inMonth && 'text-ink-3/60',
                inMonth && (sun || holidays.has(d)) && 'text-red-500', d === today && '!bg-accent-600 font-bold !text-white')}>{Number(d.slice(8))}</button>
          );
        })}
      </div>
    </div>
  );
}

/** 오른쪽 "미배정 업무" 패널: 업무를 시간 칸으로 끌어 놓으면 업무 시간 블록 */
function UnscheduledPanel({ onClose, onOpen }: { onClose: () => void; onOpen: (id: string) => void }) {
  const { user } = useSession();
  const tasks = useApi<{ tasks: any[] }>('/api/tasks?view=my&limit=200');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const d = new Draggable(ref.current, {
      itemSelector: '[data-plan-task]',
      eventData: (el) => ({ title: el.getAttribute('data-title') ?? '', duration: { minutes: Math.min(Math.max(30, Number(el.getAttribute('data-remaining')) || 60), 240) }, create: true, extendedProps: { taskId: el.getAttribute('data-plan-task') } }),
    });
    return () => d.destroy();
  }, [tasks.data]);
  const list = (tasks.data?.tasks ?? []).filter((t) => t.assignee_id === user.id && (!t.estimate_minutes || (t.scheduled_minutes ?? 0) < t.estimate_minutes))
    .sort((a, b) => ((a.due_date ?? '9999') < (b.due_date ?? '9999') ? -1 : 1));
  return (
    <aside className="hidden w-64 shrink-0 rounded-card border border-line bg-white shadow-card lg:block" aria-label="미배정 업무" data-testid="unscheduled">
      <div className="flex items-center justify-between border-b border-line px-3 py-2.5">
        <span className="text-sm font-semibold">미배정 업무 <span className="text-xs font-normal text-ink-2">{list.length}</span></span>
        <button type="button" onClick={onClose} className="rounded p-1 text-ink-3 hover:bg-slate-100" aria-label="미배정 업무 닫기"><X className="size-4" /></button>
      </div>
      <p className="px-3 pt-2 text-[11px] text-ink-3">시간 칸으로 끌어 놓으면 그 시간에 업무를 합니다</p>
      <div ref={ref} className="max-h-[70vh] space-y-1.5 overflow-y-auto p-2" data-testid="plan-tasks">
        {list.map((t) => {
          const remaining = t.estimate_minutes ? Math.max(0, t.estimate_minutes - (t.scheduled_minutes ?? 0)) : null;
          return (
            <div key={t.id} data-plan-task={t.id} data-title={t.title} data-remaining={remaining ?? 60}
              className="group cursor-grab rounded-input border border-line bg-white px-2.5 py-2 text-sm hover:border-accent-500 hover:shadow-card active:cursor-grabbing">
              <button type="button" className="line-clamp-2 text-left font-medium hover:underline" onMouseDown={(e) => e.stopPropagation()} onClick={() => onOpen(t.id)}>{t.title}</button>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-2">
                <DueChip due={t.due_date} status={t.status} />
                {remaining ? <span className="inline-flex items-center gap-0.5"><Timer className="size-3.5" />{fmtMinutesShort(remaining)}</span> : null}
              </div>
            </div>
          );
        })}
        {!list.length && <p className="px-2 py-6 text-center text-xs text-ink-3">시간을 잡을 업무가 없습니다</p>}
      </div>
    </aside>
  );
}
const fmtMinutesShort = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ''}` : `${m}분`);

/** 빈 칸 클릭·끌기 → 작은 빠른 입력 창 (일정 / 업무 탭) */
function QuickCreate({ x, y, date, start: start0, end: end0, endDate, allDay, calendars, onClose, onMore, onSaved, sheet }: {
  x: number; y: number; date: string; start?: string; end?: string; endDate?: string; allDay: boolean; calendars: any[]; onClose: () => void; onMore: (draft: any) => void; onSaved: () => void; sheet?: boolean;
}) {
  const [start, setStart] = useState(start0);
  const [end, setEnd] = useState(end0);
  const [priv, setPriv] = useState(false);
  const { user } = useSession();
  const [tab, setTab] = useState<'event' | 'task'>('event');
  const [title, setTitle] = useState('');
  const editable = calendars.filter((c) => c.perms?.edit);
  const [calendarId, setCalendarId] = useState(editable.find((c) => c.type === 'personal')?.id ?? editable[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const when = allDay ? (endDate && endDate !== date ? `${fmtDateK(date)} ~ ${fmtDateK(endDate)} 종일` : `${fmtDateK(date)} 종일`) : fmtTimeRange(`${date}T${start}:00+09:00`, `${endDate ?? date}T${end}:00+09:00`);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      if (tab === 'event') {
        const s = allDay ? `${date}T00:00:00+09:00` : `${date}T${start}:00+09:00`;
        const en = allDay ? `${addDays(endDate ?? date, 1)}T00:00:00+09:00` : `${endDate ?? date}T${end}:00+09:00`;
        await api('/api/events', { body: { calendarId, title: title.trim(), start: s, end: en, allDay, isPrivate: priv } });
        toast.ok('일정을 저장했습니다');
      } else {
        await api('/api/tasks', { body: { title: title.trim(), assigneeId: user.id, dueDate: date, dueTime: allDay ? null : start, approvalRequired: false } });
        toast.ok('업무를 만들었습니다 — 캘린더에 체크로 표시됩니다');
      }
      onSaved();
    } catch (er: any) { toast.error(er.message); } finally { setBusy(false); }
  }
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <form role="dialog" aria-label="빠른 입력" onSubmit={save} className={cx('fixed z-50 animate-fade-up border border-line bg-white p-4 shadow-pop', sheet ? 'inset-x-0 bottom-0 rounded-t-2xl pb-[calc(var(--sab)+16px)]' : 'w-80 rounded-card')} style={sheet ? undefined : { left: x, top: y }} data-testid="quick-create"
        onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder={tab === 'event' ? '제목 추가' : '할 일 제목'} aria-label="빠른 입력 제목"
          className="w-full border-b-2 border-line pb-1.5 text-lg font-medium placeholder:text-ink-3 focus:border-accent-500 focus:outline-none" />
        <div className="mt-3 flex gap-1" role="tablist">
          {([['event', '일정'], ['task', '업무']] as const).map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={cx('rounded-md px-3 py-1 text-sm font-medium', tab === k ? 'bg-accent-50 text-accent-700' : 'text-ink-2 hover:bg-slate-100')}>{l}</button>
          ))}
        </div>
        <p className="mt-3 flex items-center gap-2 text-sm text-ink-2"><Clock className="size-4" />{tab === 'task' ? `마감 ${allDay ? fmtDateK(date) : `${fmtDateK(date)} ${fmtTime(`${date}T${start}:00+09:00`)}`}` : allDay ? when : fmtDateK(date)}</p>
        {!allDay && start && end && (endDate ?? date) === date && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5" data-testid="quick-times">
            <TimeSelect label="시작 시각" value={start} onChange={(v) => { setEnd(shiftEnd(start, end, v)); setStart(v); }} />
            {tab === 'event' && <><span className="text-ink-3">–</span><TimeSelect label="종료 시각" value={end} from={start} onChange={setEnd} /></>}
          </div>
        )}
        {tab === 'event' ? (
          <select className={cx(inputCls, 'mt-2 h-9')} value={calendarId} onChange={(e) => setCalendarId(e.target.value)} aria-label="캘린더">
            {editable.map((c) => <option key={c.id} value={c.id}>{c.type === 'personal' ? '내 일정' : c.name}</option>)}
          </select>
        ) : <p className="mt-2 text-xs text-ink-3">담당: 나 · 관리자 확인 없음 — 업무 캘린더에 체크로 표시됩니다</p>}
        {tab === 'event' && <label className="mt-2 flex items-center gap-2 text-sm text-ink-2"><input type="checkbox" className="size-4" checked={priv} onChange={(e) => setPriv(e.target.checked)} />비공개 (다른 사람에게는 &ldquo;바쁨&rdquo;으로만)</label>}
        <div className="mt-4 flex items-center justify-between">
          {tab === 'event' ? <button type="button" className="text-sm font-medium text-ink-2 hover:text-ink" onClick={() => onMore({ date, allDay, start: start ?? '09:00', end: end ?? '10:00', endDate: endDate ?? date, title, calendarId, isPrivate: priv })}>옵션 더보기</button> : <span />}
          <Button type="submit" disabled={busy || !title.trim()}>저장</Button>
        </div>
      </form>
    </>
  );
}
const fmtDateK = (d: string) => { const dt = new Date(d + 'T00:00:00Z'); return `${dt.getUTCMonth() + 1}월 ${dt.getUTCDate()}일 (${'일월화수목금토'[dt.getUTCDay()]})`; };

function EventEditor({ id, occurrenceStart, draft, calendars, onClose, onSaved }: { id?: string; occurrenceStart?: string; draft?: any; calendars: any[]; onClose: () => void; onSaved: () => void; dirUsers: any[] }) {
  const { user } = useSession();
  const existing = useApi<any>(id ? `/api/events/${id}` : null);
  const [f, setF] = useState<any>(null);
  const [conf, setConf] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const editable = calendars.filter((c) => c.perms.edit);

  useEffect(() => {
    if (id) {
      const d = existing.data;
      if (!d) return;
      const e = d.event;
      const dur = new Date(e.end_at).getTime() - new Date(e.start_at).getTime();
      const s = occurrenceStart && !e.recurring_event_id ? new Date(occurrenceStart) : new Date(e.start_at);
      const en = new Date(s.getTime() + dur);
      setF({ title: e.title, calendarId: e.calendar_id, allDay: e.all_day, date: seoulDate(s), start: seoulTime(s),
        endDate: e.all_day ? addDays(seoulDate(en), -1) : seoulDate(en), end: seoulTime(en), rrule: e.rrule, location: e.location,
        description: e.description, kind: e.kind, attendeeIds: d.attendees.map((a: any) => a.user_id), version: e.version, reminders: e.reminder_minutes ?? null, isPrivate: !!e.is_private });
    } else {
      const personal = calendars.find((c) => c.type === 'personal');
      setF({ title: draft?.title ?? '', calendarId: draft?.calendarId ?? personal?.id ?? editable[0]?.id, allDay: draft?.allDay ?? false, date: draft?.date, start: draft?.start ?? '09:00',
        endDate: draft?.endDate ?? draft?.date, end: draft?.end ?? '10:00', rrule: null, location: '', description: '', kind: 'normal', attendeeIds: [], reminders: null, isPrivate: !!draft?.isPrivate });
    }
  }, [existing.data, id]); // eslint-disable-line react-hooks/exhaustive-deps

  const times = () => f.allDay
    ? { start: `${f.date}T00:00:00+09:00`, end: `${addDays(f.endDate || f.date, 1)}T00:00:00+09:00` }
    : { start: `${f.date}T${f.start}:00+09:00`, end: `${f.endDate || f.date}T${f.end}:00+09:00` };

  useEffect(() => {
    if (!f || f.allDay || !f.date) { setConf([]); return; }
    const t = times();
    const ex = id ? `&exclude=${existing.data?.event?.recurring_event_id ?? id}` : '';
    api(`/api/events/conflicts?start=${encodeURIComponent(t.start)}&end=${encodeURIComponent(t.end)}&userIds=${f.attendeeIds.join(',')}${ex}`).then((r) => setConf(r.conflicts)).catch(() => {});
  }, [f?.date, f?.start, f?.end, f?.endDate, f?.allDay, f?.attendeeIds?.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  if (id && existing.error) return <Modal open onClose={onClose} title="일정"><ErrorBox error={existing.error} /></Modal>;
  if (!f) return null;
  const d = existing.data;
  const canEdit = !id || d?.perms.edit;
  const isRecurring = !!(d?.event?.rrule || d?.event?.recurring_event_id);
  const myAtt = d?.attendees?.find((a: any) => a.user_id === user.id);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const t = times();
    if (t.end < t.start) return toast.error('종료가 시작보다 빠릅니다');
    setBusy(true);
    try {
      const body = { title: f.title, calendarId: f.calendarId, allDay: f.allDay, start: t.start, end: t.end, rrule: f.rrule, location: f.location, description: f.description, kind: f.kind, attendeeIds: f.attendeeIds, reminderMinutes: f.reminders, isPrivate: !!f.isPrivate };
      if (!id) {
        await api('/api/events', { body });
      } else {
        let scope: Scope = 'all';
        if (d.event.recurring_event_id) scope = 'this';
        else if (d.event.rrule) { const s = await askScope(); if (!s) { setBusy(false); return; } scope = s; }
        const { rrule, ...rest } = body;
        await api(`/api/events/${id}`, { method: 'PATCH', body: { ...rest, ...(scope !== 'this' ? { rrule } : {}), scope, occurrenceStart, version: scope === 'all' || !isRecurring ? f.version : undefined } });
      }
      toast.ok('저장했습니다'); onSaved(); onClose();
    } catch (er: any) { toast.error(er.message); } finally { setBusy(false); }
  }
  async function remove() {
    let scope: Scope = 'all';
    if (d.event.recurring_event_id) scope = 'this';
    else if (d.event.rrule) { const s = await askScope(); if (!s) return; scope = s; }
    else if (!confirm('일정을 삭제할까요?')) return;
    try {
      await api(`/api/events/${id}?scope=${scope}${occurrenceStart ? `&occurrenceStart=${encodeURIComponent(occurrenceStart)}` : ''}`, { method: 'DELETE' });
      toast.ok('삭제했습니다'); onSaved(); onClose();
    } catch (er: any) { toast.error(er.message); }
  }
  async function respond(r: string) {
    try { await api(`/api/events/${id}/respond`, { body: { response: r } }); existing.reload(); toast.ok('응답했습니다'); } catch (er: any) { toast.error(er.message); }
  }
  const set = (k: string) => (v: any) => setF((x: any) => ({ ...x, [k]: v }));

  return (
    <Modal open onClose={onClose} title={id ? (canEdit ? '일정 수정' : '일정') : '일정 등록'} wide>
      <form onSubmit={save} className="space-y-3">
        <fieldset disabled={!canEdit} className="space-y-3">
          <Field label="제목"><input className={inputCls} value={f.title} onChange={(e) => set('title')(e.target.value)} required autoFocus={!id} /></Field>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="캘린더">
              <select className={inputCls} value={f.calendarId} onChange={(e) => set('calendarId')(e.target.value)}>
                {(canEdit ? editable : calendars).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="종류">
              <select className={inputCls} value={f.kind} onChange={(e) => { set('kind')(e.target.value); if (e.target.value === 'vacation') set('allDay')(true); }}>
                {Object.entries(EVENT_KIND_LABEL).filter(([k]) => k !== 'task_block' || f.kind === 'task_block').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={f.allDay} onChange={(e) => set('allDay')(e.target.checked)} />종일</label>
          </div>
          {/* Google Calendar 처럼: 날짜 = 작은 달력, 시간 = 15분 목록(종료 옆에 길이) */}
          <div className="flex flex-wrap items-center gap-1.5" data-testid="editor-when">
            <DateField label="시작일" value={f.date} onChange={(v) => setF((x: any) => ({ ...x, date: v, endDate: !x.endDate || x.endDate < v || x.endDate === x.date ? v : x.endDate }))} />
            {!f.allDay && <TimeSelect label="시작 시각" value={f.start} onChange={(v) => setF((x: any) => ({ ...x, start: v, end: (x.endDate || x.date) === x.date ? shiftEnd(x.start, x.end, v) : x.end }))} />}
            <span className="text-ink-3">–</span>
            {!f.allDay && <TimeSelect label="종료 시각" value={f.end} from={(f.endDate || f.date) === f.date ? f.start : undefined} onChange={set('end')} />}
            {(f.allDay || (f.endDate && f.endDate !== f.date)) ? <DateField label="종료일" value={f.endDate || f.date} min={f.date} onChange={set('endDate')} />
              : <button type="button" className="text-xs text-ink-2 underline" onClick={() => set('endDate')(addDays(f.date, 1))}>다음 날까지</button>}
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!f.isPrivate} onChange={(e) => set('isPrivate')(e.target.checked)} />비공개 — 다른 사람에게는 시간만 &ldquo;바쁨&rdquo;으로 보입니다</label>
          {(!d?.event?.recurring_event_id) && <div><div className="mb-1 text-xs font-medium text-slate-600">반복</div><RecurSelect value={f.rrule} onChange={set('rrule')} anchorDate={f.date} /></div>}
          <div><div className="mb-1 text-xs font-medium text-slate-600">알림 {isRecurring && <span className="font-normal text-slate-400">(반복 일정 전체에 적용)</span>}</div><ReminderEditor value={f.reminders} onChange={set('reminders')} /></div>
          <div><div className="mb-1 text-xs font-medium text-slate-600">참석자</div><MultiUserSelect value={f.attendeeIds} onChange={set('attendeeIds')} /></div>
          {conf.length > 0 && (
            <div className="rounded bg-amber-50 p-2 text-xs text-amber-900" role="alert" data-testid="conflicts">
              <b>일정 충돌 안내</b>
              <ul className="mt-1 list-disc pl-4">{conf.map((c, i) => <li key={i}>{c.who.join(', ')}: {c.title} ({fmtTimeRange(c.start, c.end)})</li>)}</ul>
            </div>
          )}
          <Field label="장소"><input className={inputCls} value={f.location} onChange={(e) => set('location')(e.target.value)} /></Field>
          <Field label="설명"><textarea className={inputCls} rows={3} value={f.description} onChange={(e) => set('description')(e.target.value)} /></Field>
        </fieldset>
        {myAtt && (
          <div className="flex items-center gap-2 text-sm">참석 여부:
            {[['accepted', '참석'], ['tentative', '미정'], ['declined', '불참']].map(([v, l]) => (
              <Button key={v} type="button" size="sm" variant={myAtt.response === v ? 'primary' : 'secondary'} onClick={() => respond(v)}>{l}</Button>
            ))}
          </div>
        )}
        {d?.attendees?.length > 0 && <p className="text-xs text-slate-500">응답: {d.attendees.map((a: any) => `${a.name}(${({ accepted: '참석', declined: '불참', tentative: '미정', needsAction: '미응답' } as any)[a.response]})`).join(', ')}</p>}
        {id && d && (
          <EventWork eventId={d.event.id} occurrenceStart={d.event.rrule && !d.event.recurring_event_id ? occurrenceStart : undefined} eventDate={f.date}
            recurring={!!(d.event.rrule || d.event.recurring_event_id)} attendees={d.attendees} canEdit={!!d.perms.edit} canWork={!!(d.perms.edit || d.perms.attendee)} />
        )}
        {id && d && (
          <div>
            <div className="mb-1 text-xs font-medium text-slate-600">첨부 자료</div>
            <Attachments items={d.attachments} eventId={d.event.id} canEdit={d.perms.edit} onChange={existing.reload} meId={user.id} />
          </div>
        )}
        <div className="flex justify-between gap-2 pt-2">
          <div>{id && canEdit && <Button type="button" variant="danger" onClick={remove}>삭제</Button>}</div>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>닫기</Button>
            {canEdit && <Button type="submit" disabled={busy}>{busy ? '저장 중…' : '저장'}</Button>}
          </div>
        </div>
      </form>
    </Modal>
  );
}

/** 업무 시간 블록 제목의 옛 접두어 정리 ("[업무] …") — 화면에서는 아이콘으로 구분 */
function cleanTitle(t: string) { return t.replace(/^(\[(업무|업무 시간)\]\s*)+/, ''); }

/** 일정 미리보기: 시간·장소·참석자·연결 업무, 업무 시간 블록이면 그 업무의 상태·완료 */
function EventPreview({ ev, x, y, calendarName, onClose, onEdit, onChanged }: { ev: any; x: number; y: number; calendarName?: string; onClose: () => void; onEdit: () => void; onChanged: () => void }) {
  const occ = ev.recurring && !ev.exception && ev.originalStart ? `?occurrenceStart=${encodeURIComponent(new Date(ev.originalStart).toISOString())}` : '';
  const linked = useApi<{ tasks: any[] }>(ev.masked ? null : `/api/events/${ev.id}/tasks${occ}`);
  const tasks = linked.data?.tasks ?? [];
  const block = ev.kind === 'task_block' ? tasks.find((t) => t.link_role === 'block') ?? tasks[0] : null;
  const going = (ev.attendees ?? []).filter((a: any) => a.response !== 'declined');
  const { user } = useSession();
  // 다른 사람의 개인 일정: 보기만 (참석자면 편집 창에서 참석 여부만 응답)
  const othersPersonal = ev.calendarType === 'personal' && ev.ownerId !== user.id && ev.createdBy !== user.id && !(ev.attendees ?? []).some((a: any) => a.user_id === user.id);
  async function remove() {
    let scope: Scope = 'all';
    if (ev.exception) scope = 'this';
    else if (ev.recurring) { const sc = await askScope(); if (!sc) return; scope = sc; }
    else if (!confirm('일정을 삭제할까요?')) return;
    try {
      await api(`/api/events/${ev.id}?scope=${scope}${ev.originalStart ? `&occurrenceStart=${encodeURIComponent(new Date(ev.originalStart).toISOString())}` : ''}`, { method: 'DELETE' });
      toast.ok('삭제했습니다'); onChanged();
    } catch (e: any) { toast.error(e.message); }
  }
  async function complete(t: any) {
    const to = t.status === 'review' ? 'done' : t.approval_line_id || t.approval_required ? 'review' : 'done';
    try {
      await api(`/api/tasks/${t.id}`, { method: 'PATCH', body: { status: to, version: t.version } });
      toast.ok(to === 'review' ? '검토를 요청했습니다' : '업무를 완료했습니다'); linked.reload(); onChanged();
    } catch (e: any) {
      if (e.status === 403 && to === 'done') {
        try { await api(`/api/tasks/${t.id}`, { method: 'PATCH', body: { status: 'review', version: t.version } }); toast.ok('검토를 요청했습니다'); linked.reload(); onChanged(); return; } catch (e2: any) { toast.error(e2.message); return; }
      }
      toast.error(e.message);
    }
  }
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div role="dialog" aria-label="일정 미리보기" className="fixed z-50 w-[360px] max-w-[calc(100vw-32px)] animate-fade-up rounded-card border border-line bg-white p-4 pt-2 shadow-pop" style={{ left: x, top: Math.max(16, y) }} data-testid="event-preview">
        <div className="-mr-2 mb-1 flex justify-end gap-0.5">
          {!othersPersonal && <button type="button" onClick={onEdit} className="rounded-full p-2 text-ink-2 hover:bg-slate-100" aria-label="일정 편집" title="편집"><Pencil className="size-4" /></button>}
          {!othersPersonal && <button type="button" onClick={remove} className="rounded-full p-2 text-ink-2 hover:bg-red-50 hover:text-red-600" aria-label="일정 삭제" title="삭제"><Trash2 className="size-4" /></button>}
          <button type="button" onClick={onClose} className="rounded-full p-2 text-ink-2 hover:bg-slate-100" aria-label="미리보기 닫기" title="닫기"><X className="size-4" /></button>
        </div>
        <div className="flex items-start gap-2.5">
          <span className="mt-1 size-3 shrink-0 rounded" style={{ background: ev.color }} />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 font-semibold leading-snug">{ev.kind === 'task_block' && <Timer className="size-4 shrink-0 text-ink-2" aria-label="업무 시간" />}{cleanTitle(ev.title)}</p>
            <p className="mt-1 text-sm text-ink-2" data-testid="preview-time">{fmtTimeRange(ev.start, ev.end, { allDay: ev.allDay })}</p>
            {ev.location && <p className="mt-0.5 flex items-center gap-1 text-sm text-ink-2"><MapPin className="size-3.5" />{ev.location}</p>}
            <p className="mt-1 text-xs text-ink-3">{ev.calendarType === 'personal' && ev.ownerName ? `${ev.ownerName}님 일정` : calendarName}{ev.recurring ? ' · 반복 일정' : ''}{ev.isPrivate ? ' · 비공개' : ''}</p>
            {ev.masked && <p className="mt-1 text-xs text-ink-2" data-testid="masked-note">비공개 일정이라 시간만 보입니다</p>}
          </div>
        </div>
        {going.length > 0 && (
          <div className="mt-3 flex items-center gap-2 text-sm text-ink-2"><Users className="size-4 text-ink-3" /><AvatarStack people={going.map((a: any) => ({ id: a.user_id, name: a.name }))} max={5} /><span className="truncate">{going.map((a: any) => a.name).join(', ')}</span></div>
        )}
        {ev.description && <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm text-ink-2">{ev.description}</p>}
        {block ? (
          <div className="mt-3 rounded-input border border-line p-2.5" data-testid="block-task">
            <div className="flex items-center gap-2 text-sm">
              <StatusBadge status={block.status} />
              <a href={`/tasks/${block.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">{block.title}</a>
              <DueChip due={block.due_date} status={block.status} />
            </div>
            <div className="mt-2 flex items-center gap-1.5">
              <Avatar id={block.assignee_id} name={block.assignee_name} size={20} /><span className="flex-1 text-xs text-ink-2">{block.assignee_name ?? '담당자 없음'}</span>
              <a href={`/tasks/${block.id}`}><Button type="button" size="sm" variant="ghost"><ExternalLink />업무 열기</Button></a>
              {block.status !== 'done' && <Button type="button" size="sm" onClick={() => complete(block)}><CircleCheck />{block.status === 'review' ? '최종 완료' : '완료'}</Button>}
            </div>
          </div>
        ) : tasks.length > 0 && (
          <div className="mt-3">
            <p className="mb-1 flex items-center gap-1 text-xs font-semibold text-ink-2"><ClipboardList className="size-3.5" />연결 업무 {tasks.length}건{tasks.some((t) => t.status !== 'done' && t.due_date && t.due_date < new Date().toISOString().slice(0, 10)) ? ' · 지연 있음' : ''}</p>
            <LinkedTaskList tasks={tasks.slice(0, 4)} compact />
          </div>
        )}
        <div className="mt-3 flex justify-end">
          <Button size="sm" variant="secondary" onClick={onEdit}>{ev.kind === 'task_block' ? '시간 편집' : '회의 메모·연결 업무'}</Button>
        </div>
      </div>
    </>
  );
}

function PeopleChip({ on, onClick, children, label }: { on: boolean; onClick: () => void; children: React.ReactNode; label?: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} aria-label={label}
      className={cx('inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 font-medium', on ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-white text-ink-2 hover:border-slate-300')}>{children}</button>
  );
}
