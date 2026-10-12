'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin from '@fullcalendar/interaction';
import luxonPlugin from '@fullcalendar/luxon3';
import type { EventDropArg, DatesSetArg, EventClickArg } from '@fullcalendar/core';
import { api, broadcastRefresh, useApi } from '@/components/client';
import { useSession } from '@/components/session';
import { CalendarPlus, CircleCheck, ClipboardList, ExternalLink, MapPin, Timer, Users } from 'lucide-react';
import { Avatar, AvatarStack, Button, DueChip, ErrorBox, Field, Modal, StatusBadge, cx, fmtDateTime, fmtTimeRange, inputCls, toast } from '@/components/ui';
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
  const { dir } = useSession();
  const sp = useSearchParams();
  const router = useRouter();
  const cals = useApi<{ calendars: any[] }>('/api/calendars');
  const [hidden, setHidden] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('wos_cal_hidden') ?? '[]'); } catch { return []; } });
  const [showTasks, setShowTasks] = useState(true);
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [err, setErr] = useState<any>(null);
  const [editor, setEditor] = useState<{ id?: string; occurrenceStart?: string; draft?: any } | null>(null);
  const calRef = useRef<FullCalendar>(null);
  const mobile = typeof window !== 'undefined' && window.innerWidth < 640;

  useEffect(() => { try { localStorage.setItem('wos_cal_hidden', JSON.stringify(hidden)); } catch {} }, [hidden]);
  // B-17 공휴일(관리자 관리 표) + 캘린더 단축키 D·W·M·A·T
  const hol = useApi<{ holidays: { date: string; name: string }[] }>('/api/holidays');
  const holidaySet = useMemo(() => new Map((hol.data?.holidays ?? []).map((h) => [h.date, h.name])), [hol.data]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable || document.querySelector('[role=dialog]')) return;
      const api = calRef.current?.getApi();
      if (!api) return;
      const view = ({ d: 'timeGridDay', w: 'timeGridWeek', m: 'dayGridMonth', a: 'listWeek' } as Record<string, string>)[e.key.toLowerCase()];
      if (view) { e.preventDefault(); api.changeView(view); }
      else if (e.key.toLowerCase() === 't') { e.preventDefault(); api.today(); }
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
        api(`/api/tasks?view=all&includeDone=0&from=${seoulDate(range.from)}&to=${seoulDate(range.to)}&limit=500`),
      ]);
      setEvents(ev.events); setTasks(tk.tasks); setErr(null);
    } catch (e) { setErr(e); }
  }
  useEffect(() => { load(); }, [range]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const h = () => load(); window.addEventListener('wos-refresh', h); return () => window.removeEventListener('wos-refresh', h); });

  const fcEvents = useMemo(() => [
    ...(hol.data?.holidays ?? []).map((h) => ({ id: `holiday|${h.date}`, title: h.name, start: h.date, allDay: true, editable: false, durationEditable: false,
      backgroundColor: '#fef2f2', borderColor: 'transparent', textColor: '#dc2626', classNames: ['holiday'], extendedProps: { type: 'holiday' } })),
    ...events.filter((e) => !hidden.includes(e.calendarId)).map((e) => ({
      id: `${e.id}|${e.originalStart ?? ''}`, title: `${e.kind === 'vacation' || e.kind === 'business_trip' ? `[${EVENT_KIND_LABEL[e.kind as keyof typeof EVENT_KIND_LABEL]}] ` : ''}${cleanTitle(e.title)}`,
      classNames: e.kind === 'task_block' ? ['task-block'] : [],
      start: e.allDay ? seoulDate(e.start) : e.start, end: e.allDay ? seoulDate(e.end) : e.end, allDay: e.allDay,
      backgroundColor: e.kind === 'vacation' ? '#a855f7' : e.kind === 'business_trip' ? '#0891b2' : e.color, borderColor: 'transparent',
      extendedProps: { type: 'event', ev: e }, editable: true,
    })),
    ...(showTasks ? tasks.filter((t) => t.due_date).map((t) => ({
      id: `task|${t.id}`, title: `${t.title}${t.due_time ? ` (${t.due_time} 마감)` : ''}`, start: t.due_date, allDay: true,
      backgroundColor: '#ffffff', textColor: t.due_date < seoulDate(new Date()) ? '#dc2626' : '#1f3a5f', borderColor: '#1f3a5f',
      classNames: ['task-due'], extendedProps: { type: 'task', task: t }, durationEditable: false,
    })) : []),
  ], [events, tasks, hidden, showTasks, hol.data]);

  async function moveEvent(info: EventDropArg | any) {
    const p = info.event.extendedProps;
    if (p.type === 'task') {
      const t = p.task;
      const nd = seoulDate(info.event.start);
      try {
        const shift = Math.round((Date.parse(nd) - Date.parse(t.due_date)) / 86400000);
        await api(`/api/tasks/${t.id}`, { method: 'PATCH', body: { dueDate: nd, ...(t.start_date ? { startDate: addDays(t.start_date, shift) } : {}), version: t.version } });
        toast.ok('업무 마감일을 변경했습니다'); broadcastRefresh();
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
    if (p.type === 'task') { router.push(`/tasks/${p.task.id}`); return; }
    // 일정은 먼저 작은 미리보기 → 편집
    const r = (i.el as HTMLElement).getBoundingClientRect();
    setPreview({ ev: p.ev, x: Math.min(window.innerWidth - 376, Math.max(16, r.left)), y: Math.min(window.innerHeight - 380, r.bottom + 6) });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold tracking-tight">캘린더</h1>
        <Button onClick={() => setEditor({ draft: { date: seoulDate(new Date()) } })}><CalendarPlus />일정 등록</Button>
      </div>
      <div className="flex flex-wrap gap-1.5 text-xs" aria-label="표시할 캘린더">
        {cals.data?.calendars.map((c) => (
          <button key={c.id} onClick={() => setHidden(hidden.includes(c.id) ? hidden.filter((x) => x !== c.id) : [...hidden, c.id])}
            aria-pressed={!hidden.includes(c.id)}
            className={cx('flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium transition-colors', hidden.includes(c.id) ? 'border-line bg-white text-ink-3 line-through' : 'border-line bg-white text-ink shadow-card hover:border-slate-300')}>
            <span className="size-2.5 rounded-full" style={{ background: hidden.includes(c.id) ? '#e2e8f0' : c.color }} />{c.name}
          </button>
        ))}
        <button onClick={() => setShowTasks(!showTasks)} aria-pressed={showTasks} className={cx('inline-flex items-center gap-1.5 rounded-full border border-dashed px-2.5 py-1 font-medium', showTasks ? 'border-brand-500 bg-white text-brand-700' : 'border-slate-300 text-ink-3 line-through')}><CircleCheck className="size-3.5" />업무 마감일</button>
      </div>
      <ErrorBox error={err} retry={load} />
      <div className="rounded-card border border-line bg-white p-3 shadow-card" data-testid="calendar">
        <FullCalendar
          ref={calRef}
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin, luxonPlugin]}
          timeZone="Asia/Seoul" locale="ko" firstDay={1} height="auto" nowIndicator
          initialView={mobile ? 'listWeek' : 'timeGridWeek'}
          initialDate={/^\d{4}-\d{2}-\d{2}$/.test(sp.get('date') ?? '') ? sp.get('date')! : undefined}
          headerToolbar={mobile ? { left: 'prev,next', center: 'title', right: 'today' } : { left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek' }}
          footerToolbar={mobile ? { center: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek' } : undefined}
          buttonText={{ today: '오늘', month: '월', week: '주', day: '일', list: '일정목록' }}
          allDayText="종일" noEventsText="일정이 없습니다" dayMaxEvents={4} slotMinTime="06:00:00" scrollTime="08:00:00"
          editable selectable selectMirror longPressDelay={350}
          events={fcEvents}
          datesSet={(a: DatesSetArg) => setRange({ from: a.start.toISOString(), to: a.end.toISOString() })}
          eventClick={onClick}
          eventContent={(arg) => arg.event.classNames.includes('task-block') ? (
            <div className="flex min-w-0 items-center gap-1 overflow-hidden px-0.5 text-[12px]"><Timer className="size-3 shrink-0" aria-label="업무 시간" />{arg.timeText && <span className="shrink-0 opacity-80">{arg.timeText}</span>}<span className="truncate font-medium">{arg.event.title}</span></div>
          ) : true}
          dayCellClassNames={(a) => { const d = seoulDate(a.date); return holidaySet.has(d) ? ['is-holiday'] : []; }}
          dayHeaderClassNames={(a) => (a.view.type !== 'dayGridMonth' && holidaySet.has(seoulDate(a.date)) ? ['is-holiday'] : [])}
          eventDrop={moveEvent}
          eventResize={moveEvent}
          select={(s) => setEditor({ draft: { date: seoulDate(s.start), allDay: s.allDay, start: s.allDay ? '09:00' : seoulTime(s.start), end: s.allDay ? '10:00' : seoulTime(s.end), endDate: s.allDay ? addDays(seoulDate(s.end), -1) : seoulDate(s.end) } })}
        />
      </div>
      <p className="text-xs text-ink-2">점선 항목은 업무 마감일(날짜 기준)이고, 색이 채워진 항목은 시간이 정해진 일정입니다. 끌어서 옮기면 원본 업무·일정에 바로 반영됩니다.</p>
      <ScopeDialog />
      {preview && <EventPreview ev={preview.ev} x={preview.x} y={preview.y} calendarName={cals.data?.calendars.find((c) => c.id === preview.ev.calendarId)?.name}
        onClose={() => setPreview(null)} onEdit={() => { setEditor({ id: preview.ev.id, occurrenceStart: preview.ev.originalStart ?? undefined }); setPreview(null); }} onChanged={() => { load(); broadcastRefresh(); }} />}
      {editor && <EventEditor {...editor} calendars={cals.data?.calendars ?? []} onClose={() => { setEditor(null); if (sp.get('event')) router.replace('/calendar'); }} onSaved={() => { load(); broadcastRefresh(); }} dirUsers={dir.users} />}
    </div>
  );
}

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
        description: e.description, kind: e.kind, attendeeIds: d.attendees.map((a: any) => a.user_id), version: e.version, reminders: e.reminder_minutes ?? null });
    } else {
      const personal = calendars.find((c) => c.type === 'personal');
      setF({ title: '', calendarId: personal?.id ?? editable[0]?.id, allDay: draft?.allDay ?? false, date: draft?.date, start: draft?.start ?? '09:00',
        endDate: draft?.endDate ?? draft?.date, end: draft?.end ?? '10:00', rrule: null, location: '', description: '', kind: 'normal', attendeeIds: [], reminders: null });
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
      const body = { title: f.title, calendarId: f.calendarId, allDay: f.allDay, start: t.start, end: t.end, rrule: f.rrule, location: f.location, description: f.description, kind: f.kind, attendeeIds: f.attendeeIds, reminderMinutes: f.reminders };
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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="시작일"><input type="date" className={inputCls} value={f.date ?? ''} onChange={(e) => setF((x: any) => ({ ...x, date: e.target.value, endDate: x.endDate < e.target.value ? e.target.value : x.endDate }))} required /></Field>
            {!f.allDay && <Field label="시작 시각"><input type="time" className={inputCls} value={f.start} onChange={(e) => set('start')(e.target.value)} required /></Field>}
            <Field label="종료일"><input type="date" className={inputCls} value={f.endDate ?? ''} min={f.date} onChange={(e) => set('endDate')(e.target.value)} required /></Field>
            {!f.allDay && <Field label="종료 시각"><input type="time" className={inputCls} value={f.end} onChange={(e) => set('end')(e.target.value)} required /></Field>}
          </div>
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
  const linked = useApi<{ tasks: any[] }>(`/api/events/${ev.id}/tasks${occ}`);
  const tasks = linked.data?.tasks ?? [];
  const block = ev.kind === 'task_block' ? tasks.find((t) => t.link_role === 'block') ?? tasks[0] : null;
  const going = (ev.attendees ?? []).filter((a: any) => a.response !== 'declined');
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
      <div role="dialog" aria-label="일정 미리보기" className="fixed z-50 w-[360px] max-w-[calc(100vw-32px)] animate-fade-up rounded-card border border-line bg-white p-4 shadow-pop" style={{ left: x, top: Math.max(16, y) }} data-testid="event-preview">
        <div className="flex items-start gap-2.5">
          <span className="mt-1 size-3 shrink-0 rounded" style={{ background: ev.color }} />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 font-semibold leading-snug">{ev.kind === 'task_block' && <Timer className="size-4 shrink-0 text-ink-2" aria-label="업무 시간" />}{cleanTitle(ev.title)}</p>
            <p className="mt-1 text-sm text-ink-2" data-testid="preview-time">{fmtTimeRange(ev.start, ev.end, { allDay: ev.allDay })}</p>
            {ev.location && <p className="mt-0.5 flex items-center gap-1 text-sm text-ink-2"><MapPin className="size-3.5" />{ev.location}</p>}
            <p className="mt-1 text-xs text-ink-3">{calendarName}{ev.recurring ? ' · 반복 일정' : ''}</p>
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
        <div className="mt-3 flex justify-end gap-1.5">
          <Button size="sm" variant="ghost" onClick={onClose}>닫기</Button>
          <Button size="sm" onClick={onEdit}>{ev.kind === 'task_block' ? '시간 편집' : '자세히·회의 메모'}</Button>
        </div>
      </div>
    </>
  );
}
