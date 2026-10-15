'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DateField, TimeSelect, nextHour, shiftEnd } from '@/components/DateTimePickers';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin, { Draggable } from '@fullcalendar/interaction';
import luxonPlugin from '@fullcalendar/luxon3';
import type { EventDropArg, DatesSetArg, EventClickArg } from '@fullcalendar/core';
import { api, broadcastRefresh, useApi } from '@/components/client';
import { useSession } from '@/components/session';
import { CalendarPlus, Check, ChevronDown, FileSpreadsheet, ChevronLeft, ChevronRight, CircleCheck, ClipboardList, Clock, ExternalLink, ListChecks, MapPin, Pencil, Plus, Timer, Trash2, Users, X, Palette } from 'lucide-react';
import { Avatar, AvatarStack, avatarColor, initials, Button, DueChip, ErrorBox, Field, Modal, StatusBadge, cx, fmtDateTime, fmtTime, fmtTimeRange, inputCls, toast } from '@/components/ui';
import { TaskDetail } from '@/components/TaskDetail';
import { QuickAddTask } from '@/components/QuickAddTask';
import { useBackClose, useSheetBack } from '@/components/backClose';
import { useCalendarSwipe } from '@/components/calSwipe';
import { EventWork, LinkedTaskList } from '@/components/EventWork';
import { MultiUserSelect, RecurSelect, ReminderEditor, UserSelect } from '@/components/pickers';
import { Attachments } from '@/components/Attachments';
import { ABSENCE_KINDS, EVENT_KIND_LABEL } from '@/lib/types';
import { CalColorsDialog, isPersonalEvent, isPersonalTask, useCalColors } from '@/components/calColors';

type Scope = 'this' | 'following' | 'all';
const seoulDate = (d: Date | string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(d));
const seoulTime = (d: Date | string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(d));
const addDays = (d: string, n: number) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

/** V5 연결된 업무가 있는 일정을 지울 때: 업무도 지울지 (반복 일정은 전체 삭제일 때만 물음) */
function askAlsoTask(task: { title?: string } | null | undefined, scope: Scope, recurring: boolean) {
  if (!task || (recurring && scope !== 'all')) return false;
  return confirm(`연결된 업무${task.title ? ` '${task.title}'` : ''}도 함께 삭제할까요?\n취소를 누르면 일정만 삭제하고 업무는 남깁니다.`);
}

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
  // V14 20번(대표 결정): 완료된 업무·일정은 기본으로 숨기고 "완료 보기"로만 (이 기기 기억)
  const [showDone, setShowDone] = useState<boolean>(() => { try { return localStorage.getItem('wos_cal_done') === '1'; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem('wos_cal_done', showDone ? '1' : '0'); } catch {} }, [showDone]);
  const [sidePanel, setSidePanel] = useState<boolean>(() => { try { const v = localStorage.getItem('wos_cal_unscheduled'); return v === null ? typeof window !== 'undefined' && window.innerWidth >= 1440 : v === '1'; } catch { return false; } });
  const [range, setRange] = useState<{ from: string; to: string; start: Date; view: string } | null>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [err, setErr] = useState<any>(null);
  const [editor, setEditor] = useState<{ id?: string; occurrenceStart?: string; draft?: any } | null>(null);
  useBackClose(!!editor, () => setEditor(null));
  const [quick, setQuick] = useState<{ x: number; y: number; date: string; start?: string; end?: string; endDate?: string; allDay: boolean; kind?: 'task' | 'event' } | null>(null);
  // V14 35번: 빈 칸 빠른 등록은 업무가 기본 — 주·일 보기는 누른 시각이 마감 시각
  useSheetBack(!!quick && quick.kind !== 'task', () => { setQuick(null); calRef.current?.getApi().unselect(); });
  const quickTaskDefaults = useMemo(() => quick && quick.kind === 'task' ? { dueDate: quick.date, dueTime: quick.allDay ? undefined : quick.start } : undefined, [quick]);
  const [openTask, setOpenTask] = useState<string | null>(null);
  // V14 39번: 상세·미리보기·일정 창은 history 한 칸 — 뒤로가기는 이것만 닫고 캘린더(날짜·보기·스크롤)는 그대로
  useBackClose(!!openTask, () => { setOpenTask(null); load(); });
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
  // V14 36번: 좌우로 밀어 이전·다음 기간(휴대폰), 트랙패드 가로 스크롤(PC)
  const swipeWrap = useRef<HTMLDivElement>(null);
  const calApi = useCallback(() => calRef.current?.getApi(), []);
  const { colors: calColors } = useCalColors();
  const [colorDlg, setColorDlg] = useState(false);
  const mobile = typeof window !== 'undefined' && window.innerWidth < 640;
  // 휴대폰: 보기(일·3일·주·월·목록)를 이 기기에 기억, 처음은 주. PC 는 늘 주 보기로 시작
  const VIEWS = ['timeGridDay', 'timeGrid3', 'timeGridWeek', 'dayGridMonth', 'listWeek'];
  // V14 39번: 보기·날짜·스크롤은 주소(URL)에 — 뒤로가기로 돌아와도 그대로. V14 38번: 휴대폰 기본 보기 = 3일(7일은 선택, 기억 키를 새로)
  const urlView = VIEWS.includes(sp.get('view') ?? '') ? sp.get('view') : null;
  const savedView = !mobile ? null : (() => { try { const v = localStorage.getItem('wos_cal_view2'); return v && ['timeGridDay', 'timeGrid3', 'timeGridWeek', 'dayGridMonth', 'listWeek'].includes(v) ? v : null; } catch { return null; } })();
  const [monthPicker, setMonthPicker] = useState(false);
  const touch = typeof window !== 'undefined' && (window.innerWidth < 640 || !!window.matchMedia?.('(pointer: coarse)').matches);
  useCalendarSwipe(swipeWrap, calApi, touch);

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
    // V5 홈·+ 버튼의 "일정": 다음 정각 1시간으로 빠른 등록 시트
    if (sp.get('quick') === '1') {
      const want = sp.get('date'); const d = want && /^\d{4}-\d{2}-\d{2}$/.test(want) ? want : seoulDate(new Date()); const h = nextHour();
      setQuick({ x: 16, y: 120, date: d, start: h.start, end: h.end, endDate: d, allDay: false }); router.replace(`/calendar?date=${d}`);
    }
  }, [sp]); // eslint-disable-line react-hooks/exhaustive-deps
  const [preview, setPreview] = useState<{ ev: any; x: number; y: number } | null>(null);
  useBackClose(!!preview, () => setPreview(null));

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

  // 시간 칸은 6시부터, 그보다 이른 일정·업무가 보이는 기간이면 그 시각부터(새벽 일정이 안 보이던 문제)
  const earliest = Math.min(6, ...events.filter((e) => !e.allDay).map((e) => Number(seoulTime(e.start).slice(0, 2))), ...tasks.filter((t) => t.due_time).map((t) => Number(t.due_time.slice(0, 2))));
  const slotMin = `${String(earliest).padStart(2, '0')}:00:00`;
  const syncedIds = new Set(events.flatMap((e) => [e.linkedTask?.id, ...(e.linkedTaskIds ?? [])]).filter(Boolean));
  // V14 47: 연결 안 됐어도 같은 날·같은 제목의 일정이 있으면 업무는 따로 그리지 않고 일정 줄에 "업무 n" 으로 묶는다
  const normT = (x: string) => cleanTitle(x).replace(/\s+/g, ' ').trim().toLowerCase();
  const evKey = new Set(events.filter((e) => !e.masked && e.kind !== 'task_block' && !(ABSENCE_KINDS as readonly string[]).includes(e.kind)).map((e) => `${seoulDate(e.start)}|${normT(e.title)}`));
  const dupTasks = new Map<string, number>();
  for (const t of tasks) if (t.due_date && !syncedIds.has(t.id) && evKey.has(`${t.due_date}|${normT(t.title)}`)) dupTasks.set(`${t.due_date}|${normT(t.title)}`, (dupTasks.get(`${t.due_date}|${normT(t.title)}`) ?? 0) + 1);
  const fcEvents = useMemo(() => [
    ...(hol.data?.holidays ?? []).map((h) => ({ id: `holiday|${h.date}`, title: h.name, start: h.date, allDay: true, editable: false, durationEditable: false,
      backgroundColor: '#fef2f2', borderColor: 'transparent', textColor: '#dc2626', classNames: ['holiday'], extendedProps: { type: 'holiday' } })),
    ...events.filter((e) => !hidden.includes(e.calendarId) && showEvent(e) && (showDone || (e.linkedTask ?? e.blockTask)?.status !== 'done')).map((e) => ({ // 완료된 업무의 일정·업무 시간 블록은 "완료 보기"를 켤 때만
      id: `${e.id}|${e.originalStart ?? ''}`, title: `${(ABSENCE_KINDS as readonly string[]).includes(e.kind) ? `[${EVENT_KIND_LABEL[e.kind as keyof typeof EVENT_KIND_LABEL]}] ` : ''}${cleanTitle(e.title)}${dupTasks.get(`${seoulDate(e.start)}|${normT(e.title)}`) ? ` · 업무 ${dupTasks.get(`${seoulDate(e.start)}|${normT(e.title)}`)}` : ''}`,
      classNames: [...(e.kind === 'task_block' ? ['task-block'] : []), ...(e.linkedTask ? ['has-task'] : []), ...((e.linkedTask ?? e.blockTask)?.status === 'done' ? ['is-done'] : [])], // R-15 1번: 연결 업무가 끝나면 일정도 완료 모양
      start: e.allDay ? seoulDate(e.start) : e.start, end: e.allDay ? seoulDate(e.end) : e.end, allDay: e.allDay,
      // V7 4번: 색은 개인/회사 두 가지만(사람 구분은 제목 앞 머리글자)
      backgroundColor: isPersonalEvent(e) ? calColors.personal : calColors.company, borderColor: 'transparent', textColor: '#ffffff',
      // V14 41번: 사람 머리글자는 제목이 아니라 따로 — 휴대폰 주·3일 보기에선 빼고(색·필터로 구분), 일 보기·PC 에선 앞에 붙인다
      extendedProps: { type: 'event', ev: e, who: e.ownerId && e.ownerId !== user.id && e.calendarType === 'personal' ? `${initials(e.ownerName ?? '')} · ` : '' }, editable: !(e.calendarType === 'personal' && e.ownerId !== user.id && e.createdBy !== user.id),
    })),
    // HQ_SIMPLIFY 3-4: "업무" 캘린더 — 마감일(마감 시각이 있으면 그 시각) 칸에 체크 모양으로. "업무에도 추가"로 일정과 연결된 업무는 일정 블록(✓)으로 보이므로 따로 안 그림
    ...(showTasks ? tasks.filter((t) => t.due_date && t.show_on_calendar !== false && showTask(t) && (showDone || t.status !== 'done') && !syncedIds.has(t.id) && !syncedIds.has(t.recurrence_source_id) && !dupTasks.has(`${t.due_date}|${normT(t.title)}`)).map((t) => ({
      // V7 4번: 일정과 같은 모양 — 업무는 왼쪽 굵은 선(V14 37번, 동그라미 없음), 다른 사람 업무는 머리글자
      id: `task|${t.id}`, title: t.title,
      // V14 13번: 시간 있는 업무는 마감 직전 1시간 블록(한 칸 높이) — 얇게 찌그러지지 않게
      start: t.due_time ? new Date(Math.max(new Date(`${t.due_date}T${t.due_time}:00+09:00`).getTime() - 60 * 60000, new Date(`${t.due_date}T00:00:00+09:00`).getTime())).toISOString() : t.due_date, // 자정 넘지 않게
      end: t.due_time ? `${t.due_date}T${t.due_time}:00+09:00` : undefined, // 검수 11: 주석 안에 있던 end 를 살림
      allDay: !t.due_time, backgroundColor: isPersonalTask(t) ? calColors.personal : calColors.company, borderColor: t.status !== 'done' && t.due_date < seoulDate(new Date()) ? '#ef4444' : 'rgba(15,23,42,0.35)', // V14 37번: 왼쪽 굵은 선 = 업무
      textColor: '#ffffff', classNames: ['task-item', ...(t.status === 'done' ? ['is-done'] : [])], extendedProps: { type: 'task', task: t, who: t.assignee_id && t.assignee_id !== user.id && t.assignee_name ? `${initials(t.assignee_name)} · ` : '' }, durationEditable: false,
    })) : []),
  ], [events, tasks, hidden, showTasks, showDone, hol.data, who, calColors.personal, calColors.company]); // eslint-disable-line react-hooks/exhaustive-deps

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
        // 블록 끝 = 마감 시각 (블록은 마감 1시간 전부터)
        const dueAt = info.event.end ?? new Date(info.event.start.getTime() + 60 * 60000);
        await api(`/api/tasks/${t.id}`, { method: 'PATCH', body: { dueDate: info.event.allDay ? nd : seoulDate(dueAt), ...(!info.event.allDay ? { dueTime: seoulTime(dueAt) } : t.due_time ? { dueTime: null } : {}), ...(t.start_date ? { startDate: addDays(t.start_date, shift) } : {}), version: t.version } });
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

  /** 주소창만 바꿈(화면 다시 그리지 않음) — 다른 화면에 갔다가 뒤로 오면 같은 보기·날짜·스크롤 */
  function keepInUrl(p: Record<string, string>) {
    if (window.history.state?.__overlay) return; // 상세가 열린 칸은 건드리지 않음
    const u = new URL(window.location.href);
    for (const [k, v] of Object.entries(p)) u.searchParams.set(k, v);
    for (const k of ['quick', 'new', 'event']) u.searchParams.delete(k); // 한 번 쓰는 값(다시 열리지 않게)
    if (u.href !== window.location.href) window.history.replaceState(window.history.state, '', u.pathname + u.search);
  }
  const scrolled = useRef(false);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => { clearTimeout(t); t = setTimeout(() => keepInUrl({ y: String(Math.round(window.scrollY)) }), 300); };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { window.removeEventListener('scroll', onScroll); clearTimeout(t); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { // 돌아왔을 때 스크롤 위치 복원(일정을 불러와 높이가 잡힌 뒤 한 번)
    const y = Number(sp.get('y'));
    if (scrolled.current || !y || !events.length) return;
    scrolled.current = true;
    requestAnimationFrame(() => window.scrollTo(0, y));
  }, [events.length]); // eslint-disable-line react-hooks/exhaustive-deps

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
    // V14 46: 시간을 잡은 업무는 미배정 목록에서 바로 뺀다(실패하면 되돌림)
    window.dispatchEvent(new CustomEvent('wos-task-scheduled', { detail: { taskId, on: true } }));
    try {
      await api('/api/events', { body: { calendarId: personal.id, title, start: start.toISOString(), end: end.toISOString(), taskId, kind: 'task_block' } });
      toast.ok(`${fmtTimeRange(start, end)} 업무 시간을 잡았습니다`); load(); broadcastRefresh();
    } catch (e: any) { window.dispatchEvent(new CustomEvent('wos-task-scheduled', { detail: { taskId, on: false } })); toast.error(e.message); }
  }

  const goto = (d: string) => calRef.current?.getApi().gotoDate(d);
  const visibleStart = range ? seoulDate(range.start) : seoulDate(new Date());

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold tracking-tight">캘린더</h1>
        <div className="flex items-center gap-2">
          <Button variant="secondary" className="hidden lg:inline-flex" onClick={() => setSidePanel(!sidePanel)} aria-pressed={sidePanel}><ListChecks />미배정 업무</Button>
          {/* V6 6번 엑셀: 지금 보이는 기간·사람 필터 (남의 비공개 일정은 "바쁨"만) */}
          {range && <a href={`/api/export/calendar?start=${seoulDate(range.from)}&end=${addDays(seoulDate(range.to), -1)}${who === 'mine' ? `&who=${user.id}` : Array.isArray(who) ? `&who=${who.join(',')}` : ''}`}
            className="inline-flex h-9 items-center gap-1.5 rounded-input border border-line bg-white px-3 text-sm font-medium text-ink-2 hover:bg-slate-50" data-testid="cal-export"><FileSpreadsheet className="size-4 text-green-700" /><span className="hidden sm:inline">엑셀</span></a>}
          <Button onClick={() => { const v = calRef.current?.getApi().getDate(); const d = v ? seoulDate(v) : seoulDate(new Date()); const h = nextHour(); setEditor({ draft: { date: d, start: h.start, end: h.end } }); }}><CalendarPlus />일정 등록</Button>
        </div>
      </div>
      <ErrorBox error={err} retry={load} />
      <div className="flex items-start gap-4">
        {/* 왼쪽: 미니 달력 + 캘린더 목록 (Google Calendar 형태) */}
        <aside className="hidden w-56 shrink-0 space-y-4 lg:block" aria-label="캘린더 목록">
          <MiniMonth anchor={visibleStart} holidays={holidaySet} onPick={goto} />
          <div>
            <p className="mb-1.5 flex items-center px-1 text-xs font-semibold text-ink-2">내 캘린더<button type="button" onClick={() => setColorDlg(true)} className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium text-accent-700 hover:bg-slate-100" data-testid="cal-colors-open"><span className="size-2.5 rounded-full" style={{ background: calColors.personal }} /><span className="size-2.5 rounded-full" style={{ background: calColors.company }} />색</button></p>
            <ul className="space-y-0.5" data-testid="calendar-list">
              {cals.data?.calendars.map((c) => (
                <li key={c.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-input px-1.5 py-1 text-sm hover:bg-slate-100">
                    <input type="checkbox" className="size-4 rounded" style={{ accentColor: c.type === 'personal' ? calColors.personal : calColors.company }} checked={!hidden.includes(c.id)} onChange={() => setHidden(hidden.includes(c.id) ? hidden.filter((x) => x !== c.id) : [...hidden, c.id])} />
                    <span className="truncate">{c.type === 'personal' ? '내 일정' : c.name}</span>
                  </label>
                </li>
              ))}
              <li>
                <label className="flex cursor-pointer items-center gap-2 rounded-input px-1.5 py-1 text-sm hover:bg-slate-100">
                  <input type="checkbox" className="size-4 rounded accent-indigo-600" checked={showTasks} onChange={() => setShowTasks(!showTasks)} aria-label="업무 캘린더 표시" />
                  <span className="flex items-center gap-1"><CircleCheck className="size-3.5 text-indigo-600" />업무 마감</span>
                </label>
              </li>
              <li>
                <label className="flex cursor-pointer items-center gap-2 rounded-input px-2 py-1.5 text-sm hover:bg-slate-50">
                  <input type="checkbox" className="size-4 rounded accent-green-600" checked={showDone} onChange={() => setShowDone(!showDone)} aria-label="완료된 업무·일정 보기" />
                  <span className="flex items-center gap-1"><Check className="size-3.5 text-green-600" />완료 보기</span>
                </label>
              </li>
            </ul>
          </div>
        </aside>
        <div className="min-w-0 flex-1 rounded-card border border-line bg-white p-1.5 shadow-card sm:p-3" data-testid="calendar">
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
                <span className="size-2.5 rounded-full" style={{ background: hidden.includes(c.id) ? '#e2e8f0' : c.type === 'personal' ? calColors.personal : calColors.company }} />{c.type === 'personal' ? '내 일정' : c.name}
              </button>
            ))}
            <button onClick={() => setShowTasks(!showTasks)} aria-pressed={showTasks} className={cx('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium', showTasks ? 'border-indigo-300 text-indigo-700' : 'border-line text-ink-3 line-through')}><CircleCheck className="size-3.5" />업무 마감</button>
            <button onClick={() => setShowDone(!showDone)} aria-pressed={showDone} data-testid="cal-show-done" className={cx('hit inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium', showDone ? 'border-green-400 text-green-700' : 'border-line text-ink-3')}><Check className="size-3.5" />완료 보기</button>
            <button onClick={() => setColorDlg(true)} className="hidden items-center gap-1 hit rounded-full border border-line px-2.5 py-1 font-medium text-ink-2 sm:inline-flex" aria-label="캘린더 색 설정"><span className="size-2.5 rounded-full" style={{ background: calColors.personal }} /><span className="size-2.5 rounded-full" style={{ background: calColors.company }} />색</button>
          </div>
          {/* 휴대폰 머리줄 (Google 형): "10월 ▾"(누르면 월 달력) · ‹ › · 오늘, 아래 보기 전환 */}
          <div className="mb-2 sm:hidden" data-testid="cal-mobile-head">
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => setMonthPicker((v) => !v)} aria-expanded={monthPicker} className="inline-flex items-center gap-1 rounded-input px-1.5 py-1 text-lg font-bold" data-testid="month-toggle">
                {range ? `${Number(seoulDate(range.start).slice(5, 7))}월` : ''}<ChevronDown className={cx('size-4 transition-transform', monthPicker && 'rotate-180')} />
              </button>
              <span className="flex-1" />
              <button type="button" onClick={() => calRef.current?.getApi().prev()} className="rounded-full p-2 text-ink-2 active:bg-slate-100" aria-label="이전"><ChevronLeft className="size-5" /></button>
              <button type="button" onClick={() => calRef.current?.getApi().next()} className="rounded-full p-2 text-ink-2 active:bg-slate-100" aria-label="다음"><ChevronRight className="size-5" /></button>
              <button type="button" onClick={() => calRef.current?.getApi().today()} className="rounded-input border border-line px-2.5 py-1 text-sm font-medium">오늘</button>
              {/* V14 41번: 휴대폰은 "●● 색" 칩 대신 머리줄 아이콘(칩 줄이 잘려 보이던 문제) */}
              <button type="button" onClick={() => setColorDlg(true)} className="rounded-full p-2 text-ink-2 active:bg-slate-100" aria-label="캘린더 색 설정" data-testid="cal-colors-mobile"><Palette className="size-5" /></button>
            </div>
            {monthPicker && <div className="mt-1 rounded-card border border-line p-2"><MiniMonth anchor={visibleStart} holidays={holidaySet} onPick={(d) => { goto(d); setMonthPicker(false); }} /></div>}
            <div className="mt-1.5 flex gap-1 text-xs" role="group" aria-label="보기">
              {([['timeGridDay', '일'], ['timeGrid3', '3일'], ['timeGridWeek', '주'], ['dayGridMonth', '월'], ['listWeek', '목록']] as const).map(([v, l]) => (
                <button key={v} type="button" onClick={() => calRef.current?.getApi().changeView(v)} aria-pressed={range?.view === v}
                  className={cx('flex-1 rounded-full border py-1 font-medium', range?.view === v ? 'border-brand-600 bg-brand-600 text-white' : 'border-line text-ink-2')}>{l}</button>
              ))}
            </div>
          </div>
          <div ref={swipeWrap} className={cx('overflow-x-clip', mobile && 'cal-phone', mobile && range?.view && `cal-v-${range.view}`)} data-testid="cal-swipe">
          <FullCalendar
            ref={calRef}
            plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin, luxonPlugin]}
            timeZone="Asia/Seoul" locale="ko" firstDay={1} height="auto" nowIndicator
            initialView={urlView ?? savedView ?? (mobile ? 'timeGrid3' : 'timeGridWeek')}
            initialDate={/^\d{4}-\d{2}-\d{2}$/.test(sp.get('date') ?? '') ? sp.get('date')! : undefined}
            headerToolbar={mobile ? false : { left: 'today prev,next title', center: '', right: 'timeGridDay,timeGridWeek,dayGridMonth,listWeek' }}
            views={{ timeGrid3: { type: 'timeGrid', duration: { days: 3 }, buttonText: '3일' } }}
            // Google 형 날짜 머리: 요일 한 줄 + 날짜 숫자(오늘은 동그라미), 시간 칸 글자 작게
            dayHeaderContent={(a) => { if (!a.view.type.startsWith('timeGrid')) return undefined;
              // 날짜는 서울 기준으로 읽는다(a.date 는 서울 0시 = UTC 전날 15시)
              const ds = seoulDate(a.date), dd = new Date(ds + 'T00:00:00Z');
              return (
                <span className="flex flex-col items-center leading-tight" data-day-head={ds}>
                  <span className="text-[11px] font-medium">{'일월화수목금토'[dd.getUTCDay()]}</span>
                  <span className={cx('mt-0.5 flex size-7 items-center justify-center rounded-full text-[15px] font-semibold tabular-nums', ds === seoulDate(new Date()) && 'bg-accent-600 text-white')}>{dd.getUTCDate()}</span>
                </span>
              ); }}
            slotLabelFormat={{ hour: 'numeric', hour12: true }}
            // V14 41번: 휴대폰 축은 "오전/오후 n시"를 두 줄로 좁게(날짜 칸을 넓게)
            slotLabelContent={mobile ? (a) => { const h = Number(seoulTime(a.date).slice(0, 2)); return <span className="block text-center text-[10px] leading-[1.1]" data-axis-label><span className="block text-ink-3">{h < 12 ? '오전' : '오후'}</span>{h % 12 || 12}시</span>; } : undefined}
            buttonText={{ today: '오늘', month: '월', week: '주', day: '일', list: '일정목록' }}
            allDayText="종일" noEventsText="일정이 없습니다" dayMaxEvents={4} slotMinTime={slotMin} scrollTime="08:00:00"
            slotDuration="01:00:00" snapDuration="01:00:00" slotEventOverlap eventMinHeight={28} eventShortHeight={30}
            editable selectable selectMirror droppable longPressDelay={350}
            events={fcEvents}
            datesSet={(a: DatesSetArg) => { setRange({ from: a.start.toISOString(), to: a.end.toISOString(), start: a.view.currentStart, view: a.view.type }); if (mobile) try { localStorage.setItem('wos_cal_view2', a.view.type); } catch {} keepInUrl({ view: a.view.type, date: seoulDate(a.view.calendar.getDate()) }); }}
            eventClick={onClick}
            eventReceive={receive}
            eventContent={(arg) => {
              // V14 37번: 업무 동그라미 아이콘 제거 — 업무는 블록 왼쪽 굵은 선(CSS .task-item)으로 구분, 완료는 흐림·취소선
              // V14 38번(Google 수준 가독성): 12px·줄간 1.25, 제목은 블록 높이만큼 여러 줄, 시간은 아래 작은 글자, 짧은 블록은 "제목, 9:00" 한 줄, 월 보기는 시간 생략 한 줄
              const p = arg.event.extendedProps;
              if (p.type === 'holiday') return true;
              const isTask = p.type === 'task';
              const t = p.task, lt = p.ev?.linkedTask ?? p.ev?.blockTask;
              const done = isTask ? t.status === 'done' : lt?.status === 'done';
              const timed = arg.view.type.startsWith('timeGrid') && !arg.event.allDay;
              const month = arg.view.type === 'dayGridMonth';
              const mins = arg.event.end && arg.event.start ? (+arg.event.end - +arg.event.start) / 60000 : 60;
              const hm = (x: Date | null) => (x ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' }).format(x) : '');
              // 휴대폰(좁은 칸)은 시작 시각만 "13:00" — "오후 1:00 - 오후 2…"처럼 잘리지 않게
              const when = isTask ? (t.due_time ? `${t.due_time.slice(0, 5)} 마감` : '') : mobile && timed ? hm(arg.event.start) : arg.timeText;
              const icon = !isTask && arg.event.classNames.includes('task-block') ? <Timer className="mr-0.5 inline size-3 align-[-2px]" aria-label="업무 시간" /> : null;
              const narrow = mobile && (arg.view.type === 'timeGridWeek' || arg.view.type === 'timeGrid3'); // V14 41번: 휴대폰 주·3일
              const label = `${narrow ? '' : p.who ?? ''}${arg.event.title}`;
              const attrs = { ...(isTask ? { 'data-task-item': t.id, title: label } : { 'data-ev-block': '1', title: label, ...(lt ? { 'data-linked-task': lt.id } : {}) }), 'data-done': done ? '1' : undefined };
              // V14 41번(Google 앱 주 보기): 휴대폰 주·3일 — 종일 칩은 2줄까지 줄바꿈 11px, 시간 블록은 제목만 블록 높이만큼 줄바꿈(단어 중간 허용), 시각은 1시간 이상 블록만
              if (narrow && arg.event.allDay) return (
                <div className="line-clamp-2 min-w-0 whitespace-normal break-all px-0.5 text-[11px] font-semibold leading-[1.2]" data-allday-chip="1" {...attrs}>{icon}{label}</div>
              );
              if (narrow && timed) return (
                <div className={cx('flex h-full min-w-0 flex-col overflow-hidden leading-[1.2]', arg.view.type === 'timeGridWeek' ? 'text-[11px]' : 'text-[12px]')} data-narrow-block="1" {...attrs}>
                  <span className={cx('min-h-0 shrink overflow-hidden whitespace-normal break-all font-semibold', done && 'line-through opacity-80')}>{icon}{label}</span>
                  {mins >= 60 && when && <span className="shrink-0 truncate text-[10px] font-normal opacity-85">{when}</span>}
                </div>
              );
              if (timed && mins >= 45) return (
                <div className="flex h-full min-w-0 flex-col overflow-hidden px-1 text-[12px] leading-[1.25]" {...attrs}>
                  <span className={cx('min-h-0 shrink overflow-hidden break-all font-semibold', done && 'line-through opacity-80')}>{icon}{label}</span>
                  {when && <span className="shrink-0 truncate text-[11px] font-normal opacity-85">{when}</span>}
                </div>
              );
              return (
                <div className="min-w-0 overflow-hidden truncate px-1 text-[12px] leading-[1.25]" {...attrs}>
                  <span className={cx('font-semibold', done && 'line-through opacity-80')}>{icon}{label}</span>
                  {!month && when && <span className="font-normal opacity-85">{timed ? ', ' : ' '}{when}</span>}
                </div>
              );
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
              setQuick({ x: Math.min(window.innerWidth - 336, Math.max(16, x - 160)), y: Math.min(window.innerHeight - 380, Math.max(16, y + 8)), date: seoulDate(s.start), allDay: s.allDay, kind: 'task',
                start: s.allDay ? undefined : seoulTime(s.start), end: s.allDay ? undefined : seoulTime(s.end), endDate: s.allDay ? addDays(seoulDate(s.end), -1) : seoulDate(s.end) });
            }}
          />
          </div>
        </div>
        {sidePanel && <UnscheduledPanel onClose={() => setSidePanel(false)} onOpen={setOpenTask} />}
      </div>
      <p className="text-xs text-ink-2">빈 칸을 누르거나 끌면 빠른 입력, 업무는 체크로 완료합니다. 오른쪽 “미배정 업무”를 시간 칸으로 끌어 놓으면 업무 시간이 잡힙니다. 단축키 D·W·M·A·T·C</p>
      <ScopeDialog />
      {colorDlg && <CalColorsDialog onClose={() => setColorDlg(false)} />}
      {quick?.kind === 'task' && <QuickAddTask open defaults={quickTaskDefaults} onClose={() => { setQuick(null); calRef.current?.getApi().unselect(); }}
        onCreated={() => { setQuick(null); calRef.current?.getApi().unselect(); load(); broadcastRefresh(); }}
        switchTo={{ label: '일정', onClick: () => setQuick((q) => q && { ...q, kind: 'event' }) }} />}
      {quick && quick.kind !== 'task' && <QuickCreate {...quick} onSwitchTask={() => setQuick((q) => q && { ...q, kind: 'task' })} sheet={touch} calendars={cals.data?.calendars ?? []} onClose={() => { setQuick(null); calRef.current?.getApi().unselect(); }}
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
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  useEffect(() => {
    const h = (e: Event) => { const { taskId, on } = (e as CustomEvent).detail; setHidden((x) => { const n = new Set(x); if (on) n.add(taskId); else n.delete(taskId); return n; }); };
    window.addEventListener('wos-task-scheduled', h);
    return () => window.removeEventListener('wos-task-scheduled', h);
  }, []);
  useEffect(() => {
    if (!ref.current) return;
    const d = new Draggable(ref.current, {
      itemSelector: '[data-plan-task]',
      eventData: (el) => ({ title: el.getAttribute('data-title') ?? '', duration: { minutes: Math.min(Math.max(30, Number(el.getAttribute('data-remaining')) || 60), 240) }, create: true, extendedProps: { taskId: el.getAttribute('data-plan-task') } }),
    });
    return () => d.destroy();
  }, [tasks.data]);
  // V14 46: 미배정 = 마감 시각도 업무 시간도 아직 없는 업무(예상 시간이 있으면 잡은 시간이 예상보다 적을 때까지)
  const list = (tasks.data?.tasks ?? []).filter((t) => t.assignee_id === user.id && !hidden.has(t.id) && !t.due_time
      && (t.estimate_minutes ? (t.scheduled_minutes ?? 0) < t.estimate_minutes : !(t.scheduled_minutes > 0)))
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
function QuickCreate({ x, y, date, start: start0, end: end0, endDate, allDay, calendars, onClose, onMore, onSaved, sheet, onSwitchTask }: {
  onSwitchTask?: () => void; x: number; y: number; date: string; start?: string; end?: string; endDate?: string; allDay: boolean; calendars: any[]; onClose: () => void; onMore: (draft: any) => void; onSaved: () => void; sheet?: boolean;
}) {
  const [start, setStart] = useState(start0);
  const [end, setEnd] = useState(end0);
  const [priv, setPriv] = useState(false);
  const [rrule, setRrule] = useState<string | null>(null);
  const [alsoTask, setAlsoTask] = useState(false);
  const quickForm = useRef<HTMLFormElement>(null);
  const { user } = useSession();
  const [taskWho, setTaskWho] = useState<string | null>(null);
  const [taskReq, setTaskReq] = useState<string | null>(null);
  const [taskPrio, setTaskPrio] = useState<'low' | 'normal' | 'high' | 'urgent'>('normal');
  const [title, setTitle] = useState('');
  const editable = calendars.filter((c) => c.perms?.edit);
  const [calendarId, setCalendarId] = useState(editable.find((c) => c.type === 'personal')?.id ?? editable[0]?.id ?? '');
  // 캘린더 목록이 늦게 오면(홈에서 바로 열 때) 그때 기본값(내 일정)으로
  useEffect(() => { if (!calendarId && editable.length) setCalendarId(editable.find((c) => c.type === 'personal')?.id ?? editable[0].id); }, [editable.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const [busy, setBusy] = useState(false);
  const when = allDay ? (endDate && endDate !== date ? `${fmtDateK(date)} ~ ${fmtDateK(endDate)} 종일` : `${fmtDateK(date)} 종일`) : fmtTimeRange(`${date}T${start}:00+09:00`, `${endDate ?? date}T${end}:00+09:00`);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      // 하나의 일정 양식 + "업무에도 추가" 스위치 (V6 3번)
      const s = allDay ? `${date}T00:00:00+09:00` : `${date}T${start}:00+09:00`;
      const en = allDay ? `${addDays(endDate ?? date, 1)}T00:00:00+09:00` : `${endDate ?? date}T${end}:00+09:00`;
      await api('/api/events', { body: { calendarId, title: title.trim(), start: s, end: en, allDay, isPrivate: priv, rrule, alsoTask,
        ...(alsoTask ? { taskAssigneeId: taskWho ?? user.id, taskRequestedById: taskReq ?? user.id, taskPriority: taskPrio } : {}) } });
      toast.ok(alsoTask ? `일정을 저장하고 업무에도 추가했습니다${(taskWho ?? user.id) === user.id ? ' — 본인 업무는 마감 때 알려 드립니다' : ' — 담당자에게 알림을 보냈습니다'}` : '일정을 저장했습니다');
      onSaved();
    } catch (er: any) { toast.error(er.message); } finally { setBusy(false); }
  }
  return (
    <>
      {/* 저장 버튼 없이: Enter 또는 바깥을 누르면 저장(제목이 없으면 닫기) */}
      <div className="fixed inset-0 z-40" onClick={() => (title.trim() ? quickForm.current?.requestSubmit() : onClose())} data-testid="quick-outside" />
      <form ref={quickForm} role="dialog" aria-label="빠른 입력" onSubmit={save} className={cx('fixed z-50 animate-fade-up border border-line bg-white p-4 shadow-pop', sheet ? 'inset-x-0 bottom-0 rounded-t-2xl pb-[calc(var(--sab)+16px)]' : 'w-80 rounded-card')} style={sheet ? undefined : { left: x, top: y }} data-testid="quick-create"
        onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
        {onSwitchTask && (
          <div className="mb-3 inline-flex rounded-full bg-slate-100 p-0.5 text-sm" data-testid="quick-kind">
            <button type="button" className="rounded-full px-3 py-1 text-ink-2 hover:text-ink" onClick={onSwitchTask} data-testid="quick-switch-task">업무</button>
            <span className="rounded-full bg-white px-3 py-1 font-semibold shadow-sm">일정</span>
          </div>
        )}
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="제목 추가" aria-label="빠른 입력 제목" enterKeyHint="done"
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); quickForm.current?.requestSubmit(); } }}
          className="w-full border-b-2 border-line pb-1.5 text-lg font-medium placeholder:text-ink-3 focus:border-accent-500 focus:outline-none" />
        <p className="mt-3 flex items-center gap-2 text-sm text-ink-2"><Clock className="size-4" />{allDay ? when : fmtDateK(date)}</p>
        {!allDay && start && end && (endDate ?? date) === date && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5" data-testid="quick-times">
            <TimeSelect label="시작 시각" value={start} onChange={(v) => { setEnd(shiftEnd(start, end, v)); setStart(v); }} />
            <span className="text-ink-3">–</span><TimeSelect label="종료 시각" value={end} from={start} onChange={setEnd} />
          </div>
        )}
        <select className={cx(inputCls, 'mt-2 h-9')} value={calendarId} onChange={(e) => setCalendarId(e.target.value)} aria-label="캘린더">
          {editable.map((c) => <option key={c.id} value={c.id}>{c.type === 'personal' ? '내 일정' : c.name}</option>)}
        </select>
        {/* V5 반복(일정·업무 모두) — 반복 일정 + 업무에도 추가 = 같은 규칙의 반복 업무 */}
        <div className="mt-2" data-testid="quick-repeat"><RecurSelect value={rrule} onChange={setRrule} anchorDate={date} /></div>
        <label className="mt-2 flex cursor-pointer items-center gap-2.5 text-sm font-medium text-ink">
          <input type="checkbox" role="switch" className="peer sr-only" checked={alsoTask} onChange={(e) => setAlsoTask(e.target.checked)} data-testid="quick-also-task" aria-label="업무에도 추가" />
          <span aria-hidden className="relative h-5 w-9 shrink-0 rounded-full bg-slate-300 transition-colors after:absolute after:left-0.5 after:top-0.5 after:size-4 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:bg-brand-600 peer-checked:after:translate-x-4" />
          업무에도 추가 <span className="text-xs font-normal text-ink-3">(날짜를 바꾸면 서로 따라감)</span>
        </label>
        {alsoTask && (
          <div className="mt-2 grid grid-cols-2 gap-1.5 rounded-input bg-slate-50 p-2 text-xs" data-testid="quick-task-fields">
            <label className="col-span-2 flex items-center gap-2"><span className="w-10 shrink-0 text-ink-2">담당</span><UserSelect className="h-8 flex-1" value={taskWho ?? user.id} onChange={setTaskWho} ariaLabel="업무 담당자" /></label>
            <label className="col-span-2 flex items-center gap-2"><span className="w-10 shrink-0 text-ink-2">지시</span><UserSelect className="h-8 flex-1" value={taskReq ?? user.id} onChange={setTaskReq} ariaLabel="업무 지시자" /></label>
            <label className="col-span-2 flex items-center gap-2"><span className="w-10 shrink-0 text-ink-2">우선</span>
              <select className="h-8 flex-1 rounded-input border border-line bg-white px-2" value={taskPrio} onChange={(e) => setTaskPrio(e.target.value as typeof taskPrio)} aria-label="업무 우선순위">
                <option value="low">낮음</option><option value="normal">보통</option><option value="high">높음</option><option value="urgent">긴급</option>
              </select></label>
          </div>
        )}
        {<label className="mt-2 flex items-center gap-2 text-sm text-ink-2"><input type="checkbox" className="size-4" checked={priv} onChange={(e) => setPriv(e.target.checked)} />비공개 (다른 사람에게는 &ldquo;바쁨&rdquo;으로만)</label>}
        <div className="mt-4 flex items-center justify-between">
          {<button type="button" className="text-sm font-medium text-ink-2 hover:text-ink" onClick={() => onMore({ date, allDay, start: start ?? '09:00', end: end ?? '10:00', endDate: endDate ?? date, title, calendarId, isPrivate: priv, rrule, alsoTask })}>옵션 더보기</button>}
          <span className="text-xs text-ink-3">{busy ? '저장 중…' : 'Enter 또는 바깥을 누르면 저장'}</span>
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
        endDate: draft?.endDate ?? draft?.date, end: draft?.end ?? '10:00', rrule: draft?.rrule ?? null, location: '', description: '', kind: 'normal', attendeeIds: [], reminders: null, isPrivate: !!draft?.isPrivate, alsoTask: !!draft?.alsoTask });
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

  // 처음 불러온 값(변경 여부 비교용)과 자동 저장 상태
  const baseRef = useRef<string | null>(null);
  const [autoState, setAutoState] = useState<'' | 'saving' | 'saved' | 'error'>('');
  useEffect(() => { if (f && baseRef.current === null) baseRef.current = JSON.stringify(f); }, [f]);
  useEffect(() => {
    if (!id || !f || !baseRef.current || !existing.data?.perms.edit) return;
    const ev = existing.data.event;
    if (ev.rrule || ev.recurring_event_id) return; // 반복 일정은 "이 일정만/이후 모두" 를 물어야 하므로 닫을 때 저장
    const cur = JSON.stringify(f);
    if (cur === baseRef.current || !f.title?.trim()) return;
    const h = setTimeout(async () => {
      const t = times();
      if (t.end < t.start) return;
      setAutoState('saving');
      try {
        await api(`/api/events/${id}`, { method: 'PATCH', body: { title: f.title, calendarId: f.calendarId, allDay: f.allDay, start: t.start, end: t.end, rrule: f.rrule, location: f.location, description: f.description, kind: f.kind, attendeeIds: f.attendeeIds, reminderMinutes: f.reminders, isPrivate: !!f.isPrivate, scope: 'all' } });
        baseRef.current = cur; setAutoState('saved'); onSaved();
      } catch (er: any) { setAutoState('error'); toast.error(`자동 저장 실패: ${er.message}`); }
    }, 1000);
    return () => clearTimeout(h);
  }, [f]); // eslint-disable-line react-hooks/exhaustive-deps
  if (id && existing.error) return <Modal open onClose={onClose} title="일정"><ErrorBox error={existing.error} /></Modal>;
  if (!f) return null;
  const d = existing.data;
  const canEdit = !id || d?.perms.edit;
  const isRecurring = !!(d?.event?.rrule || d?.event?.recurring_event_id);
  const myAtt = d?.attendees?.find((a: any) => a.user_id === user.id);

  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    const t = times();
    if (t.end < t.start) return toast.error('종료가 시작보다 빠릅니다');
    setBusy(true);
    try {
      const body = { title: f.title, calendarId: f.calendarId, allDay: f.allDay, start: t.start, end: t.end, rrule: f.rrule, location: f.location, description: f.description, kind: f.kind, attendeeIds: f.attendeeIds, reminderMinutes: f.reminders, isPrivate: !!f.isPrivate };
      if (!id) {
        await api('/api/events', { body: { ...body, alsoTask: !!f.alsoTask } });
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
    const alsoTask = askAlsoTask(d.syncTask, scope, isRecurring);
    try {
      await api(`/api/events/${id}?scope=${scope}${occurrenceStart ? `&occurrenceStart=${encodeURIComponent(occurrenceStart)}` : ''}${alsoTask ? '&alsoTask=1' : ''}`, { method: 'DELETE' });
      toast.ok('삭제했습니다'); onSaved(); onClose();
    } catch (er: any) { toast.error(er.message); }
  }
  async function respond(r: string) {
    try { await api(`/api/events/${id}/respond`, { body: { response: r } }); existing.reload(); toast.ok('응답했습니다'); } catch (er: any) { toast.error(er.message); }
  }
  const set = (k: string) => (v: any) => setF((x: any) => ({ ...x, [k]: v }));
  // 저장 버튼 없이 (WORKIN_AUTOSAVE): 기존(반복 아닌) 일정은 칸을 바꾸면 1초 뒤 바로 저장, 새 일정·반복 일정은 창을 닫을 때 저장
  const dirty = !!baseRef.current && JSON.stringify(f) !== baseRef.current;
  const closeAndSave = () => { if (canEdit && dirty && f.title?.trim()) save(); else onClose(); };

  return (
    <Modal open onClose={closeAndSave} title={id ? (canEdit ? '일정 수정' : '일정') : '일정 등록'} wide>
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
              <select className={inputCls} value={f.kind} onChange={(e) => { set('kind')(e.target.value); if (e.target.value === 'vacation' || e.target.value === 'business_trip') set('allDay')(true); }}>
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
          {/* V5 일정 ↔ 업무 연동 */}
          {!id ? (
            <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={!!f.alsoTask} onChange={(e) => set('alsoTask')(e.target.checked)} data-testid="editor-also-task" />업무에도 추가 <span className="text-xs font-normal text-ink-3">— 같은 이름·날짜의 업무(담당 나), 날짜를 바꾸면 서로 따라갑니다{f.rrule ? ' · 반복 업무로' : ''}</span></label>
          ) : d?.syncTask ? (
            <p className="flex items-center gap-2 text-sm" data-testid="editor-sync-task"><CircleCheck className="size-4 text-green-600" />연결된 업무: <Link href={`/tasks/${d.syncTask.id}`} className="font-medium underline">{d.syncTask.title}</Link><span className="text-xs text-ink-3">날짜 연동</span></p>
          ) : canEdit ? (
            <button type="button" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline" data-testid="editor-add-task"
              onClick={async () => { try { await api(`/api/events/${id}`, { method: 'PATCH', body: { alsoTask: true } }); toast.ok('업무에도 추가했습니다'); existing.reload(); onSaved(); } catch (er: any) { toast.error(er.message); } }}>
              <Plus className="size-4" />업무에도 추가</button>
          ) : null}
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
            {canEdit && <span className="self-center text-xs text-ink-3" aria-live="polite" data-testid="editor-autosave">{busy || autoState === 'saving' ? '저장 중…' : autoState === 'saved' ? '저장됨 ✓' : autoState === 'error' ? '저장 안 됨' : id ? '바꾸면 자동 저장' : '닫으면 자동 저장'}</span>}
            <Button type="button" variant={canEdit && dirty ? 'primary' : 'secondary'} onClick={closeAndSave} data-testid="editor-close">{canEdit && dirty ? '완료' : '닫기'}</Button>
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
    const alsoTask = askAlsoTask(ev.linkedTask, scope, !!ev.recurring);
    try {
      await api(`/api/events/${ev.id}?scope=${scope}${ev.originalStart ? `&occurrenceStart=${encodeURIComponent(new Date(ev.originalStart).toISOString())}` : ''}${alsoTask ? '&alsoTask=1' : ''}`, { method: 'DELETE' });
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
