'use client';
import { dtf } from '@/lib/dtf';
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
import koLocale from '@fullcalendar/core/locales/ko';
import dynamic from 'next/dynamic';
import { createPlugin, type EventDropArg, type DatesSetArg, type EventClickArg } from '@fullcalendar/core';
import { Interaction, type InteractionSettings } from '@fullcalendar/core/internal';
import { api, broadcastRefresh, useApi } from '@/components/client';
import { useSession } from '@/components/session';
import { MeetingRecordLine, WorkinMeetingToggle, enableEventMeeting, isWorkinMeet } from '@/components/meet/EventMeeting';
import { Bell, CalendarPlus, Check, ChevronDown, FileSpreadsheet, ChevronLeft, ChevronRight, CircleCheck, ClipboardList, Clock, ExternalLink, ListChecks, MapPin, Pencil, Plus, Timer, Trash2, Users, Video, X } from 'lucide-react';
import { Avatar, AvatarStack, avatarColor, initials, Button, DueChip, ErrorBox, Field, Modal, StatusBadge, cx, fmtDateTime, fmtTime, fmtTimeRange, inputCls, toast } from '@/components/ui';
import { TaskDetail } from '@/components/TaskDetail';
import { useBackClose, useSheetBack } from '@/components/backClose';
import { replaceUrl } from '@/components/urlState';
import { useCalendarSwipe } from '@/components/calSwipe';
import { EventWork, LinkedTaskList } from '@/components/EventWork';
import { MultiUserSelect, RecurSelect, ReminderEditor, UserSelect } from '@/components/pickers';
import { Attachments } from '@/components/Attachments';
import { ABSENCE_KINDS, EVENT_KIND_LABEL } from '@/lib/types';
import { SPACE_META } from '@/components/spaceMeta';
import { DeletedEvents } from '@/components/DeletedEvents';
import { CalColorsDialog, ColorDot, PALETTE_NAMES, eventColorOf, isPersonalTask, saveColorPart, useCalColors } from '@/components/calColors';
import { assignedTo } from '@/components/CoAssignees';

type Scope = 'this' | 'following' | 'all';

/** 199차 #690: FullCalendar 는 시간 칸(1시간) 안에서 일정 '가운데'를 잡은 것처럼 계산해서(useEventCenter), 끌기 단위(15·30분)가 칸보다 작으면
 *  잡은 자리에 따라 끌기 시작하자마자 15~30분 튀어 버린다. 시간 칸(주·일 보기 본문)만 잡은 자리 그대로 따라가게 끈다(종일 줄·월 보기는 그대로).
 *  끌기 처리(EventDragging)보다 먼저 만들어져야 하므로 plugins 맨 앞에 둔다 */
class GrabWhereHeld extends Interaction {
  constructor(settings: InteractionSettings) {
    super(settings);
    if (settings.el.classList.contains('fc-timegrid-body')) settings.useEventCenter = false;
  }
}
const grabWhereHeld = createPlugin({ name: 'wos-grab-where-held', componentInteractions: [GrabWhereHeld] });
const seoulDate = (d: Date | string) => dtf('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(d));
const seoulTime = (d: Date | string) => dtf('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(d));
/** #757 구글처럼 짧은 블록 한 줄의 시각 — '오후 2:30' */
const koTime = (d: Date) => dtf('ko-KR', { timeZone: 'Asia/Seoul', hour: 'numeric', minute: '2-digit' }).format(d);
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

/** 점검 2026-10-16 ④: 이 기기 기억(localStorage)·화면 폭을 첫 렌더에서 읽으므로 브라우저에서만 그린다(하이드레이션 오류 #418 방지) */
function CalendarPage() {
  const { dir, user } = useSession();
  const sp = useSearchParams();
  const router = useRouter();
  const cals = useApi<{ calendars: any[] }>('/api/calendars');
  // 대표 확정(10/19): 영업·마케팅 '주요 일정'(리드 다음 연락·작업 중 입찰 마감·오늘 승인 필요 N건) — 보기만, 왼쪽 '내 캘린더'에서 켜기/끄기·색
  const [agRange, setAgRange] = useState<{ from: string; to: string } | null>(null);
  const agenda = useApi<{ spaces: string[]; items: { date: string; time: string | null; title: string; kind: string; space: 'sales' | 'marketing'; href: string }[] }>(agRange ? `/api/spaces/agenda?from=${agRange.from}&to=${agRange.to}` : null, [agRange?.from, agRange?.to]);
  const spaceCals = (agenda.data?.spaces ?? []).filter((x): x is 'sales' | 'marketing' => x === 'sales' || x === 'marketing');
  const [hidden, setHidden] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('wos_cal_hidden') ?? '[]'); } catch { return []; } });
  const [showTasks, setShowTasks] = useState<boolean>(() => { try { return localStorage.getItem('wos_cal_tasks') !== '0'; } catch { return true; } });
  // V14 20번(대표 결정): 완료된 업무·일정은 기본으로 숨기고 "완료 보기"로만 (이 기기 기억)
  const [showDone, setShowDone] = useState<boolean>(() => { try { return localStorage.getItem('wos_cal_done') === '1'; } catch { return false; } });
  // 대표 10/26 #690(구글 캘린더 레퍼런스): 일정을 끌어 옮기기·늘리기·새로 그리기 단위 — 기본 15분, 칩으로 30분(이 기기 기억). 예전엔 1시간
  const [snap, setSnapState] = useState<15 | 30>(() => { try { return localStorage.getItem('wos_cal_snap') === '30' ? 30 : 15; } catch { return 15; } });
  const setSnap = (n: 15 | 30) => { setSnapState(n); try { localStorage.setItem('wos_cal_snap', String(n)); } catch {} };
  useEffect(() => { try { localStorage.setItem('wos_cal_done', showDone ? '1' : '0'); } catch {} }, [showDone]);
  // 대표 10/22 19:47: 일·3일·주(시간 격자)에서 종일·시간 없는 업무 칸이 위를 차지해 오전 일정을 가림 → 기본 숨김, 날짜 머리 아래 '종일 n' 칩(누르면 그날 목록). 이 기기 기억
  // #592(대표 10/25 구글 주 보기 대조): 휴대폰은 종일 줄 기본 켬 — 하루 2개 + '+n개'(누르면 그날 목록)라 위를 크게 차지하지 않음. 휴대폰은 새 기억 키
  const allDayKey = typeof window !== 'undefined' && window.innerWidth < 640 ? 'wos_cal_allday_m' : 'wos_cal_allday';
  const readAllDay = (k: string) => { try { const v = localStorage.getItem(k); return v === null ? k === 'wos_cal_allday_m' : v === '1'; } catch { return k === 'wos_cal_allday_m'; } };
  const [showAllDay, setShowAllDayState] = useState<boolean>(() => readAllDay(allDayKey));
  // 176차: 사람이 바꿀 때만 그 기기 키에 저장. 창 폭이 640 을 넘나들면(PC ↔ 휴대폰 키) 그 키의 저장값을 다시 읽음 — 예전엔 폭이 바뀔 때 PC 상태(기본 꺼짐)를 휴대폰 키에 덮어써 휴대폰 종일 줄이 꺼지는 일이 있었음(CI E2E 171·172차)
  const setShowAllDay = (v: boolean) => { setShowAllDayState(v); try { localStorage.setItem(allDayKey, v ? '1' : '0'); } catch {} };
  useEffect(() => { setShowAllDayState(readAllDay(allDayKey)); }, [allDayKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const [allDaySheet, setAllDaySheet] = useState<string | null>(null);
  useBackClose(!!allDaySheet, () => setAllDaySheet(null)); // #242 2단계: 뒤로가기 = 종일 목록만 닫힘(캘린더 그대로)
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
  const showTask = (t: any) => who === 'all' || (who === 'mine' ? assignedTo(t, user.id) : who.some((w) => assignedTo(t, w))); // #475 공동 담당 업무도
  const calRef = useRef<FullCalendar>(null);
  const clickAt = useRef<{ x: number; y: number } | null>(null); // 199차 #690: 한 번 누름(dateClick) 자리 → 빠른 입력 위치
  // V14 36번: 좌우로 밀어 이전·다음 기간(휴대폰), 트랙패드 가로 스크롤(PC)
  const swipeWrap = useRef<HTMLDivElement>(null);
  const calApi = useCallback(() => calRef.current?.getApi(), []);
  const { colors: calColors } = useCalColors();
  const [colorDlg, setColorDlg] = useState(false);
  const [trashDlg, setTrashDlg] = useState(false); // 241차 지운 일정(휴지통)
  const mobile = typeof window !== 'undefined' && window.innerWidth < 640;
  // 휴대폰: 보기(일·3일·주·월·목록)를 이 기기에 기억, 처음은 주. PC 는 늘 주 보기로 시작
  const VIEWS = ['timeGridDay', 'timeGrid3', 'timeGridWeek', 'dayGridMonth', 'listWeek'];
  // V14 39번: 보기·날짜·스크롤은 주소(URL)에 — 뒤로가기로 돌아와도 그대로. V14 38번: 휴대폰 기본 보기 = 3일(7일은 선택, 기억 키를 새로)
  const urlView = VIEWS.includes(sp.get('view') ?? '') ? sp.get('view') : null;
  const savedView = !mobile ? null : (() => { try { const v = localStorage.getItem('wos_cal_view2'); return v && ['timeGridDay', 'timeGrid3', 'timeGridWeek', 'dayGridMonth', 'listWeek'].includes(v) ? v : null; } catch { return null; } })();
  const initView = urlView ?? savedView ?? (mobile ? 'timeGrid3' : 'timeGridWeek');
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
    if (sp.get('meeting') === '1') { openMeeting(); router.replace('/calendar'); }
    if (sp.get('new') === '1') { setEditor({ draft: { date: seoulDate(new Date()) } }); router.replace('/calendar'); }
    // V5 홈·+ 버튼의 "일정": 다음 정각 1시간으로 빠른 등록 시트
    if (sp.get('quick') === '1') {
      const want = sp.get('date'); const d = want && /^\d{4}-\d{2}-\d{2}$/.test(want) ? want : seoulDate(new Date()); const h = nextHour();
      setQuick({ x: 16, y: 120, date: d, start: h.start, end: h.end, endDate: d, allDay: false }); router.replace(`/calendar?date=${d}`);
    }
  }, [sp]); // eslint-disable-line react-hooks/exhaustive-deps
  const [preview, setPreview] = useState<{ ev: any; x: number; y: number; folded?: any[] } | null>(null);
  // 시간 보기 높이 = 화면 높이 - 달력 위쪽 - (휴대폰 하단 탭) → FullCalendar 가 시간 칸 안에서 스크롤해 scrollTime 이 먹음
  const calBox = useRef<HTMLDivElement>(null);
  const [calH, setCalH] = useState(640);
  useEffect(() => {
    // #592: 위치는 머리줄 아래 달력 자리(swipeWrap)부터 — 예전엔 머리줄 높이만큼 아래 탭 뒤로 밀려 시간 칸 끝이 가려졌음. 아래는 하단 탭 실제 높이
    const fit = () => { const top = (swipeWrap.current ?? calBox.current)?.getBoundingClientRect().top ?? 160; const nav = window.innerWidth < 1024 ? (document.querySelector('nav[aria-label="하단 메뉴"]')?.getBoundingClientRect().height || 56) + 2 : 24;
      setCalH(Math.max(420, Math.round(window.innerHeight - Math.max(0, top) - nav))); };
    fit(); window.addEventListener('resize', fit); return () => window.removeEventListener('resize', fit);
  }, []);
  const firstScroll = () => { const n = new Date(); const td = seoulDate(n); const inView = range && seoulDate(range.from) <= td && td < seoulDate(range.to);
    const h = inView ? Math.max(0, Number(seoulTime(n).slice(0, 2)) - 1) : 7; return `${String(h).padStart(2, '0')}:00:00`; };
  // #592: 휴대폰 미팅 단추는 시간 칸(또는 화면)을 아래로 밀면 숨고 위로 올리면 다시 — 칸을 가리지 않게
  const [fabHidden, setFabHidden] = useState(false);
  useEffect(() => {
    const last = new WeakMap<EventTarget, number>();
    const onScroll = (e: Event) => {
      const t = e.target, y = t === document ? window.scrollY : (t as HTMLElement | null)?.scrollTop;
      if (!t || typeof y !== 'number') return;
      const prev = last.get(t) ?? y; last.set(t, y);
      if (Math.abs(y - prev) >= 4) setFabHidden(y > prev);
    };
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => document.removeEventListener('scroll', onScroll, { capture: true });
  }, []);
  function openMeeting() { const v = calRef.current?.getApi().getDate(); const d = v ? seoulDate(v) : seoulDate(new Date()); const h = nextHour(); setEditor({ draft: { date: d, start: h.start, end: h.end, title: '미팅 · ', meeting: true } }); }
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
  // 대표 지적(10/19): 시간 칸은 00:00 부터(새벽 일정은 위로 스크롤), 처음 보이는 곳은 지금 시각 - 1시간(오늘이 없으면 07:00) — 높이 고정·칸 안 스크롤
  const earliest = Math.min(0, ...events.filter((e) => !e.allDay).map((e) => Number(seoulTime(e.start).slice(0, 2))), ...tasks.filter((t) => t.due_time).map((t) => Number(t.due_time.slice(0, 2))));
  const slotMin = `${String(earliest).padStart(2, '0')}:00:00`;
  const syncedIds = new Set(events.flatMap((e) => [e.linkedTask?.id, ...(e.linkedTaskIds ?? [])]).filter(Boolean));
  // V14 47: 연결 안 됐어도 같은 날·같은 제목의 일정이 있으면 업무는 따로 그리지 않고 일정 줄에 "업무 n" 으로 묶는다
  const normT = (x: string) => cleanTitle(x).replace(/\s+/g, ' ').trim().toLowerCase();
  // 대표 10/27 ④('입찰 마감이 업무·일정·영업에 여러 번 뜸 — 하나만'): 같은 입찰·리드는 하루 한 줄. 제목 앞 [영업]·[입찰] 머리, '입찰 마감 · '·'현장설명회 · ' 같은 일정 이름,
  // 업무 끝의 ' — 다음 조치'를 떼고 남은 이름(단지·리드 이름)이 같으면 같은 건 — 업무는 일정 줄에 '업무 n'으로 묶고, 영업 주요 일정은 빼냄
  const coreKey = (x: string) => cleanTitle(x).replace(/^(\[[^\]]*\]\s*)+/, '').replace(/^(입찰 마감|참가신청 마감|현장설명회|개찰|다음 연락|연락)\s*·\s*/, '').replace(/\s+—\s+.*$/, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const sameCore = (a: string, b: string) => a.length >= 5 && b.length >= 5 && (a === b || a.startsWith(b) || b.startsWith(a));
  const evByDay = new Map<string, { key: string; core: string }[]>();
  for (const e of events.filter((e) => !e.masked && e.kind !== 'task_block' && !(ABSENCE_KINDS as readonly string[]).includes(e.kind))) {
    const d = seoulDate(e.start); evByDay.set(d, [...(evByDay.get(d) ?? []), { key: normT(e.title), core: coreKey(e.title) }]);
  }
  // V37 2: 마감 시각이 있는 업무에 같은 날 업무 시간 블록이 있으면 블록 하나만(중복 블록 금지)
  const blockedDay = new Set(events.filter((e) => e.kind === 'task_block' && e.blockTask?.id).map((e) => `${e.blockTask.id}|${seoulDate(e.start)}`));
  // 246차 #770(대표 '11/2 로 옮긴 입찰 업무가 앱 스케줄에서 안 보임'): 묶인 업무는 일정 줄에 담당·완료 여부를 붙이고, 일정을 누르면 미리보기에 업무 줄([업무 열기]·[완료])
  const foldedBy = new Map<string, any[]>(); const foldedTasks = new Set<string>();
  for (const t of tasks) {
    if (!t.due_date || syncedIds.has(t.id) || !(showDone || t.status !== 'done')) continue;
    const day = evByDay.get(t.due_date) ?? []; const k = normT(t.title), c = coreKey(t.title);
    const hit = day.find((x) => x.key === k) ?? day.find((x) => sameCore(x.core, c));
    if (hit) { const key = `${t.due_date}|${hit.key}`; foldedBy.set(key, [...(foldedBy.get(key) ?? []), t]); foldedTasks.add(t.id); }
  }
  const foldTail = (fs: any[]) => (!fs.length ? '' : fs.length > 1 ? ` · 업무 ${fs.length}` : ` · 업무 ${fs[0].status === 'done' ? '완료' : fs[0].assignee_name ? `${fs[0].assignee_name}` : '담당 없음'}`);
  const taskCores = new Map<string, string[]>();
  for (const t of tasks) if (t.due_date && (showDone || t.status !== 'done')) taskCores.set(t.due_date, [...(taskCores.get(t.due_date) ?? []), coreKey(t.title)]);
  /** 영업 주요 일정('미팅 · 이름'·'입찰 마감 · 단지명') — 같은 날 같은 건의 일정·업무가 있으면 빼냄 */
  const spaceDup = (x: { date: string; title: string }) => { const c = coreKey(x.title.replace(/^[^·]{1,24}\s·\s/, '')); return (evByDay.get(x.date) ?? []).some((e) => sameCore(e.core, c)) || (taskCores.get(x.date) ?? []).some((tc) => sameCore(tc, c)); };
  // 다른 사람 표시: 약칭 '민수 · ' 또는(설정) 색 점 — 점 색은 그 사람 색(없으면 사람 고유색)
  const whoOf = (id: string | null | undefined, name?: string | null) => (!id ? { who: '' } : calColors.whoDot ? { who: '', whoDot: calColors.people?.[id] ?? avatarColor(id), whoName: name ?? '' } : { who: `${initials(name ?? '')} · ` });
  const spaceColor = (k: 'sales' | 'marketing') => calColors.cals?.[`space:${k}`] ?? SPACE_META[k].color;
  const fcEvents = useMemo(() => [
    ...(agenda.data?.items ?? []).filter((x) => !hidden.includes(`space:${x.space}`) && !spaceDup(x)).map((x, i) => ({ id: `space|${x.space}|${i}`, title: `${SPACE_META[x.space].short} · ${x.title}`,
      start: x.time ? `${x.date}T${x.time}:00+09:00` : x.date, ...(x.time ? { end: new Date(Date.parse(`${x.date}T${x.time}:00+09:00`) + 30 * 60000).toISOString() } : {}), allDay: !x.time,
      editable: false, durationEditable: false, backgroundColor: spaceColor(x.space), borderColor: 'transparent', textColor: '#ffffff', classNames: ['space-item'], extendedProps: { type: 'space', item: x } })),
    ...(hol.data?.holidays ?? []).map((h) => ({ id: `holiday|${h.date}`, title: h.name, start: h.date, allDay: true, editable: false, durationEditable: false,
      backgroundColor: '#fef2f2', borderColor: 'transparent', textColor: '#dc2626', classNames: ['holiday'], extendedProps: { type: 'holiday' } })),
    ...events.filter((e) => !hidden.includes(e.calendarId) && showEvent(e) && (showDone || (e.linkedTask ?? e.blockTask)?.status !== 'done')).map((e) => ({ // 완료된 업무의 일정·업무 시간 블록은 "완료 보기"를 켤 때만
      id: `${e.id}|${e.originalStart ?? ''}`, title: `${(ABSENCE_KINDS as readonly string[]).includes(e.kind) ? `[${EVENT_KIND_LABEL[e.kind as keyof typeof EVENT_KIND_LABEL]}] ` : ''}${cleanTitle(e.title)}${foldTail(foldedBy.get(`${seoulDate(e.start)}|${normT(e.title)}`) ?? [])}`,
      classNames: [...(e.kind === 'task_block' ? ['task-block'] : []), ...(!e.masked && e.location?.trim() ? ['is-travel'] : []), /* V36 4: 장소 있음 = 이동 일정 */ ...(e.linkedTask || foldedBy.has(`${seoulDate(e.start)}|${normT(e.title)}`) ? ['has-task'] : []), ...((e.linkedTask ?? e.blockTask)?.status === 'done' ? ['is-done'] : [])], // R-15 1번: 연결 업무가 끝나면 일정도 완료 모양
      start: e.allDay ? seoulDate(e.start) : e.start, end: e.allDay ? seoulDate(e.end) : e.end, allDay: e.allDay,
      // V7 4번: 색은 개인/회사 두 가지만(사람 구분은 제목 앞 머리글자)
      // 대표 지적(10/19 ②): 일정별 색 → 사람 색 → 캘린더 색 → 개인/회사 기본
      backgroundColor: eventColorOf(e, calColors, user.id), borderColor: 'transparent', textColor: '#ffffff',
      // V14 41번: 사람 머리글자는 제목이 아니라 따로 — 휴대폰 주·3일 보기에선 빼고(색·필터로 구분), 일 보기·PC 에선 앞에 붙인다
      extendedProps: { type: 'event', ev: e, folded: foldedBy.get(`${seoulDate(e.start)}|${normT(e.title)}`) ?? [], ...whoOf(e.ownerId && e.ownerId !== user.id && e.calendarType === 'personal' ? e.ownerId : null, e.ownerName) }, editable: !(e.calendarType === 'personal' && e.ownerId !== user.id && e.createdBy !== user.id),
    })),
    // HQ_SIMPLIFY 3-4: "업무" 캘린더 — 마감일(마감 시각이 있으면 그 시각) 칸에 체크 모양으로. "업무에도 추가"로 일정과 연결된 업무는 일정 블록(✓)으로 보이므로 따로 안 그림
    ...(showTasks ? tasks.filter((t) => t.due_date && t.show_on_calendar !== false && showTask(t) && (showDone || t.status !== 'done') && !syncedIds.has(t.id) && !syncedIds.has(t.recurrence_source_id) && !foldedTasks.has(t.id) && !(t.due_time && blockedDay.has(`${t.id}|${t.due_date}`))).map((t) => ({
      // V7 4번: 일정과 같은 모양 — 업무는 왼쪽 굵은 선(V14 37번, 동그라미 없음), 다른 사람 업무는 머리글자
      id: `task|${t.id}`, title: t.title,
      // V14 13번: 시간 있는 업무는 마감 직전 1시간 블록(한 칸 높이) — 얇게 찌그러지지 않게
      start: t.due_time ? new Date(Math.max(new Date(`${t.due_date}T${t.due_time}:00+09:00`).getTime() - 60 * 60000, new Date(`${t.due_date}T00:00:00+09:00`).getTime())).toISOString() : t.due_date, // 자정 넘지 않게
      end: t.due_time ? `${t.due_date}T${t.due_time}:00+09:00` : undefined, // 검수 11: 주석 안에 있던 end 를 살림
      allDay: !t.due_time, backgroundColor: isPersonalTask(t) ? calColors.personal : calColors.company, borderColor: t.status !== 'done' && t.due_date < seoulDate(new Date()) ? '#ef4444' : 'rgba(15,23,42,0.35)', // V14 37번: 왼쪽 굵은 선 = 업무
      textColor: '#ffffff', classNames: ['task-item', ...(t.status === 'done' ? ['is-done'] : [])], extendedProps: { type: 'task', task: t, ...whoOf(t.assignee_id && t.assignee_id !== user.id && t.assignee_name ? t.assignee_id : null, t.assignee_name) }, durationEditable: false,
    })) : []),
  ], [events, tasks, hidden, showTasks, showDone, hol.data, who, JSON.stringify(calColors), agenda.data]); // eslint-disable-line react-hooks/exhaustive-deps
  // 날짜별 종일 항목(여러 날 종일 일정은 날마다) — 시간 격자의 '종일 n' 칩·목록 시트
  const allDayByDate = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const e of fcEvents as any[]) {
      if (!e.allDay) continue;
      const s = String(e.start).slice(0, 10), endEx = e.end ? String(e.end).slice(0, 10) : null;
      for (let d = s, k = 0; k < 62 && (k === 0 || (endEx && d < endEx)); d = addDays(d, 1), k++) (m.get(d) ?? m.set(d, []).get(d)!).push(e);
    }
    return m;
  }, [fcEvents]);
  // #592: 휴대폰은 보이는 기간에 종일 항목이 없으면 종일 줄을 감춤(빈 줄이 시간 칸을 가리지 않게)
  const rangeHasAllDay = !!range && [...allDayByDate.keys()].some((d) => d >= seoulDate(range.from) && d < seoulDate(range.to));
  const openAllDayItem = (e: any) => {
    const p = e.extendedProps; setAllDaySheet(null);
    if (p.type === 'space') router.push(p.item.href);
    else if (p.type === 'task') setOpenTask(p.task.id);
    else if (p.type === 'event') setPreview({ ev: p.ev, x: 16, y: 120, folded: p.folded });
  };

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
    } catch (er: any) { toast.error(saveError(er)); info.revert(); }
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
  // 높이를 고정한 시간 보기는 달력 안 칸이 스크롤 → 그 위치도 주소에 두고 돌아오면 복원
  const scroller = () => calBox.current?.querySelector<HTMLElement>('.fc-timegrid-body')?.closest<HTMLElement>('.fc-scroller') ?? null;
  useEffect(() => {
    const el = calBox.current; if (!el) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const on = (e: Event) => { const sc = scroller(); if (!sc || e.target !== sc) return; clearTimeout(t); t = setTimeout(() => keepInUrl({ st: String(Math.round(sc.scrollTop)) }), 300); };
    el.addEventListener('scroll', on, true);
    return () => { el.removeEventListener('scroll', on, true); clearTimeout(t); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // 시간 보기로 처음 들어오거나 보기를 바꿀 때 한 번: 지금 - 1시간(오늘이 없으면 07:00). 날짜만 넘기면 위치 유지, 주소에 st 가 있으면 그 복원이 우선
  const firstScrolled = useRef('');
  useEffect(() => {
    const v = range?.view; if (!v?.startsWith('timeGrid') || firstScrolled.current === v) return;
    const restoring = !firstScrolled.current && Number(sp.get('st')) > 0;
    firstScrolled.current = v;
    if (!restoring) requestAnimationFrame(() => calRef.current?.getApi().scrollToTime(firstScroll()));
  }, [range?.view, calH]); // eslint-disable-line react-hooks/exhaustive-deps
  const stDone = useRef(false);
  useEffect(() => {
    const st = Number(sp.get('st'));
    if (stDone.current || !st || !events.length) return;
    stDone.current = true;
    requestAnimationFrame(() => { const sc = scroller(); if (sc) sc.scrollTop = st; });
  }, [events.length]); // eslint-disable-line react-hooks/exhaustive-deps
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
    if (p.type === 'space') { router.push(p.item.href); return; }
    if (p.type === 'task') {
      if ((i.jsEvent.target as HTMLElement).closest('[data-task-check]')) return;
      setOpenTask(p.task.id); return;
    }
    const r = (i.el as HTMLElement).getBoundingClientRect();
    setPreview({ ev: p.ev, x: Math.min(window.innerWidth - 376, Math.max(16, r.left)), y: Math.min(window.innerHeight - 380, r.bottom + 6), folded: p.folded });
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

  const peopleFilter = (
          <div className={cx('-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 text-sm', mobile ? 'sticky bottom-0 z-10 mt-2 border-t border-line bg-white pt-2' : 'mb-2')} role="group" aria-label="누구의 일정" data-testid="people-filter">
            <PeopleChip on={who === 'all'} onClick={() => setWho('all')}>전체</PeopleChip>
            <PeopleChip on={who === 'mine'} onClick={() => setWho('mine')}>내 일정</PeopleChip>
            {people.filter((p) => p.id !== user.id).map((p) => (
              <PeopleChip key={p.id} on={Array.isArray(who) && who.includes(p.id)} onClick={() => pickPerson(p.id)} label={`${p.name} 일정`}>
                <span className="size-2.5 rounded-full" style={{ background: calColors.people?.[p.id] ?? avatarColor(p.id) }} />{p.name}
              </PeopleChip>
            ))}
          </div>
  );
  // 대표 10/21 22:00 ⑥(#419): 휴대폰은 캘린더가 먼저 보이게 — 캘린더·업무 표시 칩 줄을 캘린더 아래로(PC 는 위 그대로)
  const calChips = (
          <div className={cx('flex flex-wrap gap-1.5 text-xs lg:hidden', mobile ? 'mt-2 border-t border-line pt-2' : 'mb-2')} aria-label="표시할 캘린더">
            {/* V36 4 범례: 일정 = 꽉 찬 블록, 업무 = 왼쪽 굵은 선, 이동(장소 있음) = 📍·진한 테두리 */}
            <span className="flex basis-full items-center gap-2 px-1 text-[11px] text-ink-3" data-testid="cal-legend-m">
              <span className="inline-flex items-center gap-1"><span className="inline-block size-2.5 rounded-sm" style={{ background: calColors.company }} />일정</span>
              <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm border-l-[3px] border-slate-700 bg-slate-200" />업무</span>
              <span className="inline-flex items-center gap-0.5"><MapPin className="size-3 text-ink-2" />이동</span>
            </span>
            {cals.data?.calendars.map((c) => (
              <button key={c.id} onClick={() => setHidden(hidden.includes(c.id) ? hidden.filter((x) => x !== c.id) : [...hidden, c.id])} aria-pressed={!hidden.includes(c.id)}
                className={cx('flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium', hidden.includes(c.id) ? 'border-line text-ink-3 line-through' : 'border-line text-ink')}>
                <span className="size-2.5 rounded-full" style={{ background: hidden.includes(c.id) ? '#e2e8f0' : calColors.cals?.[c.id] ?? (c.type === 'personal' ? calColors.personal : calColors.company) }} />{c.type === 'personal' ? '내 일정' : c.name}
              </button>
            ))}
            {spaceCals.map((k) => (
              <button key={k} onClick={() => setHidden(hidden.includes(`space:${k}`) ? hidden.filter((x) => x !== `space:${k}`) : [...hidden, `space:${k}`])} aria-pressed={!hidden.includes(`space:${k}`)}
                className={cx('flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium', hidden.includes(`space:${k}`) ? 'border-line text-ink-3 line-through' : 'border-line text-ink')}>
                <span className="size-2.5 rounded-full" style={{ background: hidden.includes(`space:${k}`) ? '#e2e8f0' : spaceColor(k) }} />{SPACE_META[k].short}
              </button>
            ))}
            <button onClick={() => setShowTasks(!showTasks)} aria-pressed={!showTasks} data-testid="cal-hide-tasks-chip" className={cx('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium', showTasks ? 'border-line text-ink-2' : 'border-indigo-300 bg-indigo-50 text-indigo-700')}><CircleCheck className="size-3.5" />{showTasks ? '업무 숨기기' : '업무 숨김 중'}</button>
            <button onClick={() => setShowAllDay(!showAllDay)} aria-pressed={showAllDay} data-testid="cal-show-allday" title="일·3일·주 보기 위쪽에 종일·시간 없는 업무 칸 보이기" className={cx('hit inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium', showAllDay ? 'border-accent-400 text-accent-700' : 'border-line text-ink-3')}>종일 칸</button>
            <button onClick={() => setShowDone(!showDone)} aria-pressed={showDone} data-testid="cal-show-done" className={cx('hit inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium', showDone ? 'border-green-400 text-green-700' : 'border-line text-ink-3')}><Check className="size-3.5" />완료 보기</button>

            <button onClick={() => setSnap(snap === 15 ? 30 : 15)} title="일정을 끌어서 옮기거나 늘릴 때 시간 단위 — 누르면 15분 ↔ 30분" aria-label={`일정 옮기는 단위 ${snap}분 — 누르면 ${snap === 15 ? 30 : 15}분`} data-testid="cal-snap"
              className="hit inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-1 font-medium text-ink-2"><Clock className="size-3.5" />{snap}분 단위</button>
            {range && <a href={`/api/export/calendar?start=${seoulDate(range.from)}&end=${addDays(seoulDate(range.to), -1)}${who === 'mine' ? `&who=${user.id}` : Array.isArray(who) ? `&who=${who.join(',')}` : ''}`}
              className="inline-flex items-center gap-1 hit rounded-full border border-line px-2.5 py-1 font-medium text-ink-2 sm:hidden" data-testid="cal-export-mobile"><FileSpreadsheet className="size-3.5 text-green-700" />엑셀</a>}{/* #592 휴대폰: 제목 줄을 숨겨 엑셀은 칩 줄로 */}
            <button onClick={() => setColorDlg(true)} className="inline-flex items-center gap-1 hit rounded-full border border-line px-2.5 py-1 font-medium text-ink-2" aria-label="캘린더 색 설정" data-testid="cal-colors"><span className="size-2.5 rounded-full" style={{ background: calColors.personal }} /><span className="size-2.5 rounded-full" style={{ background: calColors.company }} />색</button>
            <button onClick={() => setTrashDlg(true)} className="inline-flex items-center gap-1 hit rounded-full border border-line px-2.5 py-1 font-medium text-ink-2" data-testid="cal-trash"><Trash2 className="size-3.5" />지운 일정</button>{/* 241차 */}
          </div>
  );

  return (
    <div className="-mt-3 space-y-3 sm:mt-0">{/* #592 휴대폰: 숨긴 제목 줄 몫의 위 간격(12px)을 되돌림 */}
      <div className="hidden flex-wrap items-center justify-between gap-2 sm:flex">{/* #592 휴대폰은 숨김(머리줄 한 줄에 + 일정 등록, 미팅은 오른쪽 아래 단추) */}
        <h1 className="text-xl font-bold tracking-tight">캘린더</h1>
        <div className="flex items-center gap-2">
          <Button variant="secondary" className="hidden lg:inline-flex" onClick={() => setSidePanel(!sidePanel)} aria-pressed={sidePanel}><ListChecks />미배정 업무</Button>
          {/* V6 6번 엑셀: 지금 보이는 기간·사람 필터 (남의 비공개 일정은 "바쁨"만) */}
          {range && <a href={`/api/export/calendar?start=${seoulDate(range.from)}&end=${addDays(seoulDate(range.to), -1)}${who === 'mine' ? `&who=${user.id}` : Array.isArray(who) ? `&who=${who.join(',')}` : ''}`}
            className="inline-flex h-9 items-center gap-1.5 rounded-input border border-line bg-white px-3 text-sm font-medium text-ink-2 hover:bg-slate-50" data-testid="cal-export"><FileSpreadsheet className="size-4 text-green-700" /><span className="hidden sm:inline">엑셀</span></a>}
          {/* 대표 지적(10/19): 미팅 일정 만들기를 눈에 띄게(장소 칸 먼저 채우게 '미팅 · ' 제목) */}
          <Button variant="secondary" className="border-rose-200 text-rose-800 hover:bg-rose-50" onClick={() => openMeeting()} data-testid="cal-new-meeting"><MapPin />미팅 일정</Button>
          <Button onClick={() => { const v = calRef.current?.getApi().getDate(); const d = v ? seoulDate(v) : seoulDate(new Date()); const h = nextHour(); setEditor({ draft: { date: d, start: h.start, end: h.end } }); }}><CalendarPlus />일정 등록</Button>
        </div>
      </div>
      <ErrorBox error={err} retry={load} />
      <div className="flex items-start gap-4">
        {/* 왼쪽: 미니 달력 + 캘린더 목록 (Google Calendar 형태) */}
        <aside className="hidden w-56 shrink-0 space-y-4 lg:block" aria-label="캘린더 목록">
          <MiniMonth anchor={visibleStart} holidays={holidaySet} onPick={goto} />
          <p className="flex items-center gap-2.5 px-1 text-[11px] text-ink-3" data-testid="cal-legend">
            <span className="inline-flex items-center gap-1"><span className="inline-block size-2.5 rounded-sm" style={{ background: calColors.company }} />일정</span>
            <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm border-l-[3px] border-slate-700 bg-slate-200" />업무</span>
            <span className="inline-flex items-center gap-0.5"><MapPin className="size-3 text-ink-2" />이동(장소)</span>
          </p>
          <div>
            <p className="mb-1.5 flex items-center px-1 text-xs font-semibold text-ink-2">내 캘린더<button type="button" onClick={() => setColorDlg(true)} className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium text-accent-700 hover:bg-slate-100" data-testid="cal-colors-open"><span className="size-2.5 rounded-full" style={{ background: calColors.personal }} /><span className="size-2.5 rounded-full" style={{ background: calColors.company }} />색</button></p>
            <ul className="space-y-0.5" data-testid="calendar-list">
              {cals.data?.calendars.map((c) => (
                <li key={c.id} className="flex items-center gap-1 rounded-input pr-1.5 hover:bg-slate-100">
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-1.5 py-1 text-sm">
                    <input type="checkbox" className="size-4 rounded" style={{ accentColor: calColors.cals?.[c.id] ?? (c.type === 'personal' ? calColors.personal : calColors.company) }} checked={!hidden.includes(c.id)} onChange={() => setHidden(hidden.includes(c.id) ? hidden.filter((x) => x !== c.id) : [...hidden, c.id])} />
                    <span className="truncate">{c.type === 'personal' ? '내 일정' : c.name}</span>
                  </label>
                  {/* 대표 지적(10/19 ②): 색 점을 누르면 그 캘린더 색 바꾸기(나만) */}
                  <ColorDot color={calColors.cals?.[c.id] ?? (c.type === 'personal' ? calColors.personal : calColors.company)} label={c.type === 'personal' ? '내 일정' : c.name} onPick={(v) => saveColorPart({ cals: { [c.id]: v } })} testId={`cal-color-${c.type}`} />
                </li>
              ))}
              {spaceCals.map((k) => (
                <li key={k} className="flex items-center gap-1 rounded-input pr-1.5 hover:bg-slate-100" data-testid={`cal-space-${k}`}>
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-1.5 py-1 text-sm">
                    <input type="checkbox" className="size-4 rounded" style={{ accentColor: spaceColor(k) }} checked={!hidden.includes(`space:${k}`)} onChange={() => setHidden(hidden.includes(`space:${k}`) ? hidden.filter((x) => x !== `space:${k}`) : [...hidden, `space:${k}`])} aria-label={`${SPACE_META[k].short} 주요 일정`} />
                    <span className="truncate">{SPACE_META[k].short}<span className="ml-1 text-xs text-ink-3">주요 일정</span></span>
                  </label>
                  <ColorDot color={spaceColor(k)} label={SPACE_META[k].short} onPick={(v) => saveColorPart({ cals: { [`space:${k}`]: v } })} />
                </li>
              ))}
              <li>
                <label className="flex cursor-pointer items-center gap-2 rounded-input px-1.5 py-1 text-sm hover:bg-slate-100">
                  <input type="checkbox" className="size-4 rounded accent-indigo-600" checked={!showTasks} onChange={() => setShowTasks(!showTasks)} aria-label="업무 숨기기" data-testid="cal-hide-tasks" />
                  <span className="flex items-center gap-1"><CircleCheck className="size-3.5 text-indigo-600" />업무 숨기기</span>
                </label>
              </li>
              <li>
                <label className="flex cursor-pointer items-center gap-2 rounded-input px-2 py-1.5 text-sm hover:bg-slate-50">
                  <input type="checkbox" className="size-4 rounded accent-green-600" checked={showDone} onChange={() => setShowDone(!showDone)} aria-label="완료된 업무·일정 보기" />
                  <span className="flex items-center gap-1"><Check className="size-3.5 text-green-600" />완료 보기</span>
                </label>
              </li>
              <li>
                <label className="flex cursor-pointer items-center gap-2 rounded-input px-2 py-1.5 text-sm hover:bg-slate-50" title="일·주 보기 위쪽에 종일·시간 없는 업무 칸 보이기(끄면 날짜 머리 '종일 n')">
                  <input type="checkbox" className="size-4 rounded accent-slate-600" checked={showAllDay} onChange={() => setShowAllDay(!showAllDay)} aria-label="종일 칸 보기" data-testid="cal-show-allday-side" />
                  <span>종일 칸 보기</span>
                </label>
              </li>
              {/* 199차 #690: PC 는 왼쪽 목록에서 끌기 단위 고르기(휴대폰·태블릿은 칩 줄의 'N분 단위' 칩) */}
              <li className="flex items-center gap-2 px-2 py-1.5 text-sm" title="일정을 끌어서 옮기거나 늘릴 때 시간 단위(이 기기 기억)">
                <Clock className="size-3.5 text-ink-3" /><span className="min-w-0 flex-1">끌기 단위</span>
                <span className="inline-flex shrink-0 rounded-full border border-line p-0.5 text-xs" role="group" aria-label="일정 끌기 단위" data-testid="cal-snap-side">
                  {([15, 30] as const).map((n) => (
                    <button key={n} type="button" onClick={() => setSnap(n)} aria-pressed={snap === n}
                      className={cx('rounded-full px-2 py-0.5 font-medium', snap === n ? 'bg-brand-600 text-white' : 'text-ink-2 hover:bg-slate-100')}>{n}분</button>
                  ))}
                </span>
              </li>
              {/* 241차(로컬 10/28 19:20 '일정이 사라짐'): 지운 일정 — 누가·언제 지웠는지 보고 되살리기 */}
              <li>
                <button type="button" onClick={() => setTrashDlg(true)} className="flex w-full items-center gap-2 rounded-input px-2 py-1.5 text-left text-sm hover:bg-slate-50" data-testid="cal-trash-side">
                  <Trash2 className="size-3.5 text-ink-3" /><span>지운 일정</span>
                </button>
              </li>
            </ul>
          </div>
          {people.length > 1 && (
            <div data-testid="cal-people-colors">
              <p className="mb-1.5 px-1 text-xs font-semibold text-ink-2">다른 사람 캘린더</p>
              <ul className="space-y-0.5">
                {people.filter((p) => p.id !== user.id).map((p) => (
                  <li key={p.id} className="flex items-center gap-2 rounded-input px-1.5 py-1 text-sm hover:bg-slate-100">
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    <ColorDot color={calColors.people?.[p.id] ?? calColors.personal} label={`${p.name} 일정`} onPick={(v) => saveColorPart({ people: { [p.id]: v } })} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
        <div className="-mx-3 min-w-0 flex-1 border-y border-line bg-white px-1 py-1.5 sm:mx-0 sm:rounded-card sm:border sm:p-3 sm:shadow-card" data-testid="calendar" ref={calBox}>
          {/* 대표 검수 10/20: 휴대폰은 내 일정/다른 사람 전환을 화면 아래(하단 탭 바로 위)로 — 위는 날짜·일정만 */}
          {!mobile && peopleFilter}
          {!mobile && calChips}
          {/* 휴대폰 머리줄 (Google 형): "10월 ▾"(누르면 월 달력) · 보기 전환 · ‹ › · 오늘 · 일정 등록 — #592 한 줄로(시간 칸을 한 화면에 더 많이). 색 설정은 아래 칩 줄 */}
          <div className="mb-1 sm:hidden" data-testid="cal-mobile-head">
            <h1 className="sr-only">캘린더</h1>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => setMonthPicker((v) => !v)} aria-expanded={monthPicker} className="inline-flex shrink-0 items-center gap-0.5 rounded-input px-1 py-1 text-lg font-bold" data-testid="month-toggle">
                {range ? `${Number(seoulDate(range.start).slice(5, 7))}월` : ''}<ChevronDown className={cx('size-4 transition-transform', monthPicker && 'rotate-180')} />
              </button>
              <div className="flex min-w-0 rounded-full bg-slate-100 p-0.5 text-[12px]" role="group" aria-label="보기">
                {([['timeGridDay', '일'], ['timeGrid3', '3일'], ['timeGridWeek', '주'], ['dayGridMonth', '월'], ['listWeek', '목록']] as const).map(([v, l]) => (
                  <button key={v} type="button" onClick={() => calRef.current?.getApi().changeView(v)} aria-pressed={range?.view === v}
                    className={cx('h-7 whitespace-nowrap rounded-full px-[7px] font-medium', range?.view === v ? 'bg-brand-600 text-white' : 'text-ink-2')}>{l}</button>
                ))}
              </div>
              <span className="flex-1" />
              <button type="button" onClick={() => calRef.current?.getApi().prev()} className="shrink-0 rounded-full p-1 text-ink-2 active:bg-slate-100" aria-label="이전"><ChevronLeft className="size-5" /></button>
              <button type="button" onClick={() => calRef.current?.getApi().next()} className="shrink-0 rounded-full p-1 text-ink-2 active:bg-slate-100" aria-label="다음"><ChevronRight className="size-5" /></button>
              <button type="button" onClick={() => calRef.current?.getApi().today()} className="shrink-0 rounded-input border border-line px-1.5 py-0.5 text-xs font-medium">오늘</button>
              <button type="button" onClick={() => { const v = calRef.current?.getApi().getDate(); const d = v ? seoulDate(v) : seoulDate(new Date()); const h = nextHour(); setEditor({ draft: { date: d, start: h.start, end: h.end } }); }}
                className="shrink-0 rounded-full p-1 text-brand-700 active:bg-slate-100" aria-label="일정 등록" data-testid="cal-new-mobile"><CalendarPlus className="size-5" /></button>
            </div>
            {monthPicker && <div className="mt-1 rounded-card border border-line p-2"><MiniMonth anchor={visibleStart} holidays={holidaySet} onPick={(d) => { goto(d); setMonthPicker(false); }} /></div>}
          </div>
          <div ref={swipeWrap} className={cx('overflow-x-clip', mobile && 'cal-phone', mobile && range?.view && `cal-v-${range.view}`)} data-testid="cal-swipe">
          <FullCalendar
            ref={calRef}
            plugins={[grabWhereHeld, dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin, luxonPlugin]}
            timeZone="Asia/Seoul" locale={koLocale} firstDay={0} height={(range?.view ?? initView).startsWith('timeGrid') ? calH : 'auto'} nowIndicator
            initialView={initView}
            initialDate={/^\d{4}-\d{2}-\d{2}$/.test(sp.get('date') ?? '') ? sp.get('date')! : undefined}
            headerToolbar={mobile ? false : { left: 'today prev,next title', center: '', right: 'timeGridDay,timeGridWeek,dayGridMonth,listWeek' }}
            views={{ timeGrid3: { type: 'timeGrid', duration: { days: 3 }, buttonText: '3일' }, dayGridMonth: { dayMaxEvents: mobile ? 4 : 6 }, timeGrid: { dayMaxEvents: false, dayMaxEventRows: 2 } }} eventDisplay="block" // 대표 지적(10/19): 월 보기도 시각 있는 일정을 색 배경 + 흰 글자로(점 모양 대신 블록 — 보기별 옵션은 먹지 않아 전체에)
            // Google 형 날짜 머리: 요일 한 줄 + 날짜 숫자(오늘은 동그라미), 시간 칸 글자 작게
            dayHeaderContent={(a) => { if (!a.view.type.startsWith('timeGrid')) return a.text; // 월·목록 보기는 기본 요일 글자(undefined 를 돌려주면 빈칸 — 로컬 검수 10/17)
              // 날짜는 서울 기준으로 읽는다(a.date 는 서울 0시 = UTC 전날 15시)
              const ds = seoulDate(a.date), dd = new Date(ds + 'T00:00:00Z');
              return (
                <span className="flex flex-col items-center leading-tight">
                  <span className="flex flex-col items-center" data-day-head={ds}>
                    <span className="text-[11px] font-medium">{'일월화수목금토'[dd.getUTCDay()]}</span>
                    <span className={cx('mt-0.5 flex items-center justify-center rounded-full font-semibold tabular-nums', mobile ? 'size-6 text-[14px]' : 'size-7 text-[15px]', ds === seoulDate(new Date()) && 'bg-accent-600 text-white')}>{dd.getUTCDate()}</span>
                  </span>
                  {!showAllDay && (allDayByDate.get(ds)?.length ?? 0) > 0 && (
                    <button type="button" onClick={(ev) => { ev.stopPropagation(); ev.preventDefault(); setAllDaySheet(ds); }} data-testid="allday-chip" data-day={ds}
                      className="mt-0.5 rounded-full bg-slate-100 px-1.5 text-[10px] font-medium leading-4 text-ink-2 hover:bg-slate-200">종일 {allDayByDate.get(ds)!.length}</button>
                  )}
                </span>
              ); }}
            slotLabelFormat={{ hour: 'numeric', hour12: true }}
            // V14 41번: 휴대폰 축은 "오전/오후 n시"를 두 줄로 좁게(날짜 칸을 넓게)
            slotLabelContent={mobile ? (a) => { const h = Number(seoulTime(a.date).slice(0, 2)); return <span className="block text-center text-[10px] leading-[1.1]" data-axis-label><span className="block text-ink-3">{h < 12 ? '오전' : '오후'}</span>{h % 12 || 12}시</span>; } : undefined}
            buttonText={{ today: '오늘', month: '월', week: '주', day: '일', list: '일정목록' }}
            allDaySlot={showAllDay && (!mobile || rangeHasAllDay)} allDayText="종일" noEventsText="일정이 없습니다" slotMinTime={slotMin} scrollTime={firstScroll()} scrollTimeReset={false}
            // 대표 지적(10/19 ③): 월 보기는 칸 안에 최대한(PC 6·휴대폰 4줄), 넘치면 '+N개' — 높이 자동이라 true(칸 높이 맞춤)는 제한이 걸리지 않음
            dayMaxEvents={4} moreLinkContent={(a) => `+${a.num}개`}
            // #592: 시간 격자 종일 줄은 하루 2개까지 — '+n개' 는 그날 종일 목록(휴대폰 시트), 월 보기는 그대로 풍선. 끝에 참 값을 돌려주면 FullCalendar 는 아무것도 하지 않음
            moreLinkClick={(a) => { if (!a.view.type.startsWith('timeGrid')) return 'popover'; setAllDaySheet(seoulDate(a.date)); return true as never; }}
            // #757(대표 10/28 사진: 14:00~16:00 30분 면접 4건이 좌우로 쪼개짐): 최소 높이(28·휴대폰 34px)가 30분 높이(PC 24·휴대폰 주 20px)보다 커서 다음 일정과 겹친 것으로 계산됐음
            // → 최소 높이를 30분 높이 아래로(PC 22·휴대폰 18) — 안 겹치는 일정은 칸 너비 전체로 위아래로 이어짐
            // 241차(대표 10/28 '겹치면 다르게 구현되는거 같은데 구글 캘린더 레퍼런스 해주세요' — 10/19 '나란히' 대신): 실제로 겹치는 일정은 뒤 일정이 오른쪽으로 비켜
            // 겹쳐 쌓임(앞 일정 왼쪽 부분이 보이고 그 부분을 누르면 앞 일정 — 흰 테두리로 구분)
            slotDuration="01:00:00" snapDuration={snap === 30 ? '00:30:00' : '00:15:00'} slotEventOverlap eventMinHeight={mobile ? 18 : 22} eventShortHeight={30}
            editable selectable selectMirror droppable longPressDelay={350} selectMinDistance={touch ? 0 : 4}
            events={fcEvents}
            datesSet={(a: DatesSetArg) => { setAgRange({ from: seoulDate(a.start), to: seoulDate(new Date(a.end.getTime() - 1)) }); setRange({ from: a.start.toISOString(), to: a.end.toISOString(), start: a.view.currentStart, view: a.view.type }); if (mobile) try { localStorage.setItem('wos_cal_view2', a.view.type); } catch {} keepInUrl({ view: a.view.type, date: seoulDate(a.view.calendar.getDate()) }); }}
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
              const hm = (x: Date | null) => (x ? dtf('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' }).format(x) : '');
              // 휴대폰(좁은 칸)은 시작 시각만 "13:00" — "오후 1:00 - 오후 2…"처럼 잘리지 않게
              const when0 = isTask ? (t.due_time ? `${t.due_time.slice(0, 5)} 마감` : '') : mobile && timed ? hm(arg.event.start) : arg.timeText;
              // V36 4: 장소가 있는 일정 = 이동 — 📍 + (넓은 칸) 장소·출발 권장(시작 40분 전, 지도 계산 없음)
              const loc = !isTask ? String(p.ev?.location ?? '').trim() : '';
              const icon = loc ? <MapPin className="mr-0.5 inline size-3 align-[-2px]" aria-label="이동" data-travel-icon /> : !isTask && arg.event.classNames.includes('task-block') ? <Timer className="mr-0.5 inline size-3 align-[-2px]" aria-label="업무 시간" /> : null;
              const depart = loc && timed && arg.event.start ? `${hm(new Date(+arg.event.start - 40 * 60000))} 출발 권장` : '';
              const narrow = mobile && (arg.view.type === 'timeGridWeek' || arg.view.type === 'timeGrid3'); // V14 41번: 휴대폰 주·3일
              const when = loc && !narrow && !month ? [when0, loc, depart].filter(Boolean).join(' · ') : when0;
              const label = narrow ? narrowTitle(arg.event.title) : `${p.who ?? ''}${arg.event.title}`; // #592: 좁은 블록은 앞머리 [태그] 떼고 내용부터(전체 제목은 title)
              const full = `${p.who ?? ''}${arg.event.title}`;
              // 대표 지적(10/19 ③): 사람 약칭 대신 색 점(설정) — 좁은 칸에서도 보임
              const dot = p.whoDot ? <span className="mr-1 inline-block size-2 shrink-0 rounded-full align-[1px] ring-1 ring-white/90" style={{ background: p.whoDot }} title={p.whoName} data-who-dot /> : null;
              const attrs = { ...(isTask ? { 'data-task-item': t.id, title: full } : { 'data-ev-block': '1', title: full, ...(lt ? { 'data-linked-task': lt.id } : {}) }), 'data-done': done ? '1' : undefined, ...(loc ? { 'data-travel': '1' } : {}) };
              // V14 41번(Google 앱 주 보기): 휴대폰 주·3일 — 시간 블록은 제목만 블록 높이만큼 줄바꿈(단어 중간 허용), 시각은 1시간 30분 이상 블록만
              // #592(대표 10/25 구글 대조): 종일 칩은 한 줄(넘치면 …), 블록 글자 11px·중간 굵기, 줄 수 = 블록 높이(주 40·3일 48px/시간)에 들어가는 만큼(1시간 = 주 2줄·3일 3줄)
              if (narrow && arg.event.allDay) return (
                <div className="min-w-0 truncate px-0.5 text-[11px] font-medium leading-[1.3]" data-allday-chip="1" {...attrs}>{dot}{icon}{label}</div>
              );
              if (narrow && timed) {
                const showTime = mins >= 90 && !!when;
                const lines = Math.max(1, Math.floor((Math.max(18, (mins / 60) * (arg.view.type === 'timeGridWeek' ? 40 : 48)) - 4 - (showTime ? 12 : 0)) / 13.2)); // #757 실제 블록 높이(최소 18px)로
                return (
                  <div className="flex h-full min-w-0 flex-col overflow-hidden text-[11px] leading-[1.2]" data-narrow-block="1" {...attrs}>
                    <span className={cx('line-clamp-2 min-h-0 overflow-hidden whitespace-normal break-all font-medium', done && 'line-through opacity-80')} style={{ WebkitLineClamp: lines }}>{dot}{icon}{label}</span>
                    {showTime && <span className="mt-auto shrink-0 truncate text-[10px] font-normal opacity-85" data-block-time>{when}</span>}
                  </div>
                );
              }
              // V36 6: 휴대폰 일 보기 짧은 블록 — 시각은 제목 옆 작게(아래 줄로 내려 제목을 가리지 않음) · #757 30분 이하는 한 줄
              if (mobile && timed && mins <= 30) return (
                <div className="min-w-0 truncate px-[3px] text-[12px] leading-[1.25]" {...attrs} data-short-block="1">
                  <span className={cx('font-semibold', done && 'line-through opacity-80')}>{dot}{icon}{label}</span>{arg.event.start && <span className="text-[10.5px] font-normal opacity-85">, {koTime(arg.event.start)}</span>}
                </div>
              );
              if (mobile && timed && mins < 90) return (
                <div className="line-clamp-2 min-w-0 overflow-hidden whitespace-normal break-all px-[3px] text-[12px] leading-[1.2]" {...attrs}>
                  <span className={cx('font-semibold', done && 'line-through opacity-80')}>{dot}{icon}{label}</span>{when && <span className="ml-1 text-[10.5px] font-normal opacity-85" data-block-time>{when}</span>}
                </div>
              );
              // 대표 지적(10/19 ③ 글자 표시량): 안쪽 여백 3px·줄간 1.2 — 제목 먼저 블록 높이만큼 줄바꿈, 시간은 뒤에 작게
              if (timed && mins >= 45) return (
                <div className="flex h-full min-w-0 flex-col overflow-hidden px-[3px] text-[12px] leading-[1.2]" {...attrs} data-chip-dense="1">
                  <span className={cx('min-h-0 shrink overflow-hidden whitespace-normal break-all font-semibold', done && 'line-through opacity-80')}>{dot}{icon}{label}</span>
                  {when && <span className="shrink-0 truncate text-[10.5px] font-normal opacity-85">{when}</span>}
                </div>
              );
              // #757(구글처럼): 30분 이하 블록은 한 줄 '제목, 오후 2:30'(블록 높이가 한 줄뿐)
              if (timed && mins <= 30) return (
                <div className="min-w-0 truncate px-[3px] text-[12px] leading-[1.25]" {...attrs} data-chip-dense="1" data-short-block="1">
                  <span className={cx('font-semibold', done && 'line-through opacity-80')}>{dot}{icon}{label}</span>{arg.event.start && <span className="font-normal opacity-85">, {koTime(arg.event.start)}</span>}
                </div>
              );
              // 짧은 블록(45분 미만)도 2줄까지 — 시간은 제목 뒤 작게
              if (timed) return (
                <div className="line-clamp-2 min-w-0 overflow-hidden whitespace-normal break-all px-[3px] text-[12px] leading-[1.15]" {...attrs} data-chip-dense="1">
                  <span className={cx('font-semibold', done && 'line-through opacity-80')}>{dot}{icon}{label}</span>
                  {when && <span className="ml-1 text-[10.5px] font-normal opacity-85">{when}</span>}
                </div>
              );
              return (
                <div className="min-w-0 overflow-hidden truncate px-[3px] text-[12px] leading-[1.25]" {...attrs}>
                  {month && !arg.event.allDay && arg.event.start && <span className="mr-1 font-normal opacity-90" data-month-time>{hm(arg.event.start)}</span>}
                  <span className={cx('font-semibold', done && 'line-through opacity-80')}>{dot}{icon}{label}</span>
                  {!month && when && <span className="font-normal opacity-85"> {when}</span>}
                </div>
              );
            }}
            dayCellClassNames={(a) => { const d = seoulDate(a.date); return holidaySet.has(d) ? ['is-holiday'] : []; }}
            dayHeaderClassNames={(a) => (a.view.type !== 'dayGridMonth' && holidaySet.has(seoulDate(a.date)) ? ['is-holiday'] : [])}
            eventDrop={moveEvent}
            eventResize={moveEvent}
            // 휴대폰: 빈 칸 한 번 탭 = 그 시각 1시간 임시 블록 + 빠른 등록 (길게 누를 필요 없음). 월 보기 날짜 탭 = 그날 종일
            // #756(대표 10/28 '캘린더 생성도 15분 단위로 클릭해서 생성'): 한 번 누름도 누른 자리의 끌기 단위(15분, 30분으로 바꿨으면 30분) 칸부터 1시간 — 199차의 '정시부터'를 바꿈
            dateClick={(info) => {
              const api = calRef.current?.getApi(); if (!api) return;
              clickAt.current = { x: info.jsEvent.clientX, y: info.jsEvent.clientY };
              const h = info.date.getTime(); // FullCalendar 가 누른 자리를 끌기 단위(snapDuration)로 맞춘 시각
              // 손 뗌을 다 처리한 뒤에 고름 — 같은 손 뗌에서 바로 고르면 '빈 곳 누름 = 선택 풀기'에 곧바로 풀림
              setTimeout(() => { if (info.allDay) api.select(info.dateStr.slice(0, 10)); else api.select(new Date(h), new Date(h + 3600000)); }, 0);
            }}
            select={(s) => {
              const js = (s.jsEvent as MouseEvent | undefined);
              const pt = js ? { x: js.clientX, y: js.clientY } : clickAt.current; clickAt.current = null;
              const x = pt?.x ?? window.innerWidth / 2, y = pt?.y ?? 200;
              setQuick({ x: Math.min(window.innerWidth - 336, Math.max(16, x - 160)), y: Math.min(window.innerHeight - 380, Math.max(16, y + 8)), date: seoulDate(s.start), allDay: s.allDay, kind: 'event', // 캘린더 = 일정만(10/16 대표 결정). 연결된 할 일이 필요하면 "할 일로도 만들기"
                start: s.allDay ? undefined : seoulTime(s.start), end: s.allDay ? undefined : seoulTime(s.end), endDate: s.allDay ? addDays(seoulDate(s.end), -1) : seoulDate(s.end) });
            }}
          />
          </div>
          {mobile && calChips}
          {mobile && peopleFilter}
        </div>
        {sidePanel && <UnscheduledPanel onClose={() => setSidePanel(false)} onOpen={setOpenTask} />}
      </div>
      <p className="text-xs text-ink-2">빈 칸을 누르거나 끌면 빠른 입력, 업무는 체크로 완료합니다. 오른쪽 “미배정 업무”를 시간 칸으로 끌어 놓으면 업무 시간이 잡힙니다. 단축키 D·W·M·A·T·C</p>
      <ScopeDialog />
      {/* 휴대폰: 캘린더 오른쪽 아래 미팅 일정 단추(하단 탭 위) — #592 긴 알약 대신 둥근 48px 아이콘(칸을 덜 가림), 아래로 밀면 숨김 */}
      <button type="button" onClick={() => openMeeting()} aria-label="미팅 일정" title="미팅 일정" data-hidden={fabHidden ? '1' : '0'}
        className={cx('fixed bottom-[calc(var(--sab)+76px)] right-4 z-30 inline-flex size-12 items-center justify-center rounded-full bg-rose-600 text-white shadow-pop transition-[opacity,transform] duration-200 lg:hidden', fabHidden && 'pointer-events-none translate-y-3 opacity-0')} data-testid="cal-meeting-fab"><MapPin className="size-5" /></button>
      {colorDlg && <CalColorsDialog onClose={() => setColorDlg(false)} />}
      {trashDlg && <DeletedEvents onClose={() => setTrashDlg(false)} />}
      {/* 대표 결정(10/16): 캘린더에서는 일정만 등록 — 업무는 업무 화면·홈 [+업무]. 일정과 함께 할 일이 필요하면 "업무 리스트에도 추가" */}
      {allDaySheet && (
        <div className="fixed inset-0 z-50 bg-slate-900/40" onClick={() => setAllDaySheet(null)}>
          <div role="dialog" aria-label={`${allDaySheet} 종일`} data-testid="allday-sheet" onClick={(e) => e.stopPropagation()}
            className="absolute bottom-0 left-0 right-0 max-h-[70dvh] overflow-y-auto rounded-t-2xl bg-white p-3 pb-[calc(var(--sab)+16px)] sm:bottom-auto sm:left-1/2 sm:top-24 sm:w-[380px] sm:-translate-x-1/2 sm:rounded-card sm:shadow-pop">
            <div className="flex items-center gap-2 px-1 pb-2"><b className="flex-1 text-sm">{Number(allDaySheet.slice(5, 7))}월 {Number(allDaySheet.slice(8))}일 종일 · {allDayByDate.get(allDaySheet)?.length ?? 0}개</b>
              <button onClick={() => setAllDaySheet(null)} className="rounded-full p-1.5 text-ink-3" aria-label="닫기"><X className="size-4" /></button></div>
            <ul className="space-y-1">{(allDayByDate.get(allDaySheet) ?? []).map((e: any) => (
              <li key={e.id}><button type="button" onClick={() => openAllDayItem(e)} disabled={e.extendedProps.type === 'holiday'} className="flex min-h-[44px] w-full items-center gap-2 rounded-input px-2 text-left text-sm hover:bg-slate-50 disabled:cursor-default">
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: e.extendedProps.type === 'holiday' ? '#dc2626' : e.backgroundColor }} aria-hidden />
                <span className="min-w-0 flex-1 truncate">{e.title}</span>
                <span className="shrink-0 text-[11px] text-ink-3">{e.extendedProps.type === 'task' ? '업무' : e.extendedProps.type === 'holiday' ? '공휴일' : e.extendedProps.type === 'space' ? '공간' : '일정'}</span>
              </button></li>))}</ul>
            <button type="button" onClick={() => { setAllDaySheet(null); setShowAllDay(true); }} className="mt-2 w-full rounded-input px-2 py-1.5 text-xs text-ink-3 hover:bg-slate-50">캘린더 위쪽에 종일 칸 보이기</button>
          </div>
        </div>
      )}
      {quick && <QuickCreate {...quick} sheet={touch} calendars={cals.data?.calendars ?? []} onClose={() => { setQuick(null); calRef.current?.getApi().unselect(); }}
        onMore={(draft) => { setQuick(null); setEditor({ draft }); }} onSaved={() => { setQuick(null); calRef.current?.getApi().unselect(); load(); broadcastRefresh(); }} />}
      {preview && <EventPreview ev={preview.ev} folded={preview.folded} x={preview.x} y={preview.y} calendarName={cals.data?.calendars.find((c) => c.id === preview.ev.calendarId)?.name}
        onClose={() => setPreview(null)} onEdit={() => { setEditor({ id: preview.ev.id, occurrenceStart: preview.ev.originalStart ?? undefined }); setPreview(null); }} onChanged={() => { setPreview(null); load(); broadcastRefresh(); }}
        onOpenTask={(id) => { setOpenTask(id); setPreview(null); }} />}
      {editor && <EventEditor {...editor} calendars={cals.data?.calendars ?? []} onClose={() => { setEditor(null); if (sp.get('event')) { const p = new URLSearchParams(location.search); p.delete('event'); replaceUrl(`/calendar${p.size ? `?${p}` : ''}`); } }} onSaved={() => { load(); broadcastRefresh(); }} dirUsers={dir.users} />}
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
  const startDow = first.getUTCDay(); // 일요일 시작(큰 캘린더와 같게)
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
        {'일월화수목금토'.split('').map((d, i) => <span key={d} className={cx('py-0.5 font-medium text-ink-3', i === 0 && 'text-red-400')}>{d}</span>)}
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
  const list = (tasks.data?.tasks ?? []).filter((t) => assignedTo(t, user.id) && !hidden.has(t.id) && !t.due_time
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
function QuickCreate({ x, y, date, start: start0, end: end0, endDate, allDay: allDay0, calendars, onClose, onMore, onSaved, sheet, onSwitchTask }: {
  onSwitchTask?: () => void; x: number; y: number; date: string; start?: string; end?: string; endDate?: string; allDay: boolean; calendars: any[]; onClose: () => void; onMore: (draft: any) => void; onSaved: () => void; sheet?: boolean;
}) {
  const [start, setStart] = useState(start0);
  const [end, setEnd] = useState(end0);
  // #480(대표 10/23): 월 칸(종일)에서 만들 때도 시작·끝 시각을 고를 수 있게 — 기본은 종일, [시간 지정]을 누르면 시각 칸(연결 업무 마감 시각도 따라감)
  const [allDay, setAllDay] = useState(allDay0);
  const timeable = allDay0 && (endDate ?? date) === date; // 하루짜리 종일 칸만(여러 날 끌어 고른 칸은 종일 그대로)
  const setTimed = () => { const n = date === seoulDate(new Date()) ? nextHour() : { start: '09:00', end: '10:00' }; setStart(n.start); setEnd(n.end); setAllDay(false); };
  const setAllDayBack = () => { setAllDay(true); setStart(undefined); setEnd(undefined); };
  const [priv, setPriv] = useState(false);
  const [rrule, setRrule] = useState<string | null>(null);
  const [alsoTask, setAlsoTask] = useState(false);
  const [remind, setRemind] = useState<string>('default'); // 대표: 빠른 입력에 알림 설정이 안 보임 → 기본·없음·10분·30분·1시간·하루 전
  const [color, setColor] = useState<string | null>(null); // 로컬 10/20(대표): 색 고르기를 첫 화면에
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
      await api('/api/events', { body: { calendarId: calendarId || undefined, title: title.trim(), start: s, end: en, allDay, isPrivate: priv, rrule, alsoTask, color, // 236차: 목록 전이면 서버가 내 개인 일정으로
        ...(remind !== 'default' ? { reminderMinutes: remind === 'none' ? [] : [Number(remind)] } : {}),
        ...(alsoTask ? { taskAssigneeId: taskWho ?? user.id, taskRequestedById: taskReq ?? user.id, taskPriority: taskPrio } : {}) } });
      pushRecentColor(color);
      toast.ok(alsoTask ? `일정을 저장하고 업무에도 추가했습니다${(taskWho ?? user.id) === user.id ? '. 본인 업무는 마감 때 알려 드립니다' : '. 담당자에게 알렸습니다'}` : '일정을 저장했습니다');
      onSaved();
    } catch (er: any) { toast.error(er.message); } finally { setBusy(false); }
  }
  // V37 3: 닫기(Esc·앱 뒤로·바깥) = 제목이 있으면 저장, 없으면 그냥 닫기
  const dismiss = () => { if (busy) return; if (title.trim()) quickForm.current?.requestSubmit(); else onClose(); };
  useSheetBack(!!sheet, dismiss);
  return (
    <>
      {/* V37 3: [저장] 버튼 항상 보임 + Enter·바깥·닫기도 저장(제목이 없으면 그냥 닫기) */}
      <div className="fixed inset-0 z-40" onClick={dismiss} data-testid="quick-outside" />
      <form ref={quickForm} role="dialog" aria-label="빠른 입력" onSubmit={save} className={cx('fixed z-50 animate-fade-up border border-line bg-white p-4 shadow-pop', sheet ? 'inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-2xl pb-[calc(var(--sab)+16px)]' : 'w-80 overflow-y-auto rounded-card')}
        // "할 일로도 만들기" 칸이 펼쳐져도 [저장]이 화면 밖으로 나가지 않게 — 화면 높이 안에서 스크롤
        style={sheet ? undefined : { left: x, top: Math.max(8, Math.min(y, (typeof window !== 'undefined' ? window.innerHeight : 800) - 420)), maxHeight: `calc(100dvh - ${Math.max(8, Math.min(y, (typeof window !== 'undefined' ? window.innerHeight : 800) - 420)) + 8}px)` }} data-testid="quick-create"
        onKeyDown={(e) => { if (e.key === 'Escape') dismiss(); }}>
        {onSwitchTask && (
          <div className="mb-3 inline-flex rounded-full bg-slate-100 p-0.5 text-sm" data-testid="quick-kind">
            <button type="button" className="rounded-full px-3 py-1 text-ink-2 hover:text-ink" onClick={onSwitchTask} data-testid="quick-switch-task">업무</button>
            <span className="rounded-full bg-white px-3 py-1 font-semibold shadow-sm">일정</span>
          </div>
        )}
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="제목 추가" aria-label="빠른 입력 제목" enterKeyHint="done"
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); quickForm.current?.requestSubmit(); } }}
          className="w-full border-b-2 border-line pb-1.5 text-lg font-medium placeholder:text-ink-3 focus:border-accent-500 focus:outline-none" />
        <p className="mt-3 flex items-center gap-2 text-sm text-ink-2"><Clock className="size-4" /><span className="min-w-0 flex-1">{allDay ? when : fmtDateK(date)}</span>
          {timeable && (allDay
            ? <button type="button" className="shrink-0 rounded-full border border-line px-2 py-0.5 text-xs font-medium text-ink-2 hover:bg-slate-50" onClick={setTimed} data-testid="quick-set-time">시간 지정</button>
            : <button type="button" className="shrink-0 rounded-full border border-line px-2 py-0.5 text-xs font-medium text-ink-2 hover:bg-slate-50" onClick={setAllDayBack} data-testid="quick-all-day">종일로</button>)}
        </p>
        {!allDay && start && end && (endDate ?? date) === date && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5" data-testid="quick-times">
            <TimeSelect label="시작 시각" value={start} onChange={(v) => { setEnd(shiftEnd(start, end, v)); setStart(v); }} />
            <span className="text-ink-3">–</span><TimeSelect label="종료 시각" value={end} from={start} onChange={setEnd} />
          </div>
        )}
        <select className={cx(inputCls, 'mt-2 h-9')} value={calendarId} onChange={(e) => setCalendarId(e.target.value)} aria-label="캘린더">
          {!calendarId && <option value="">{editable.length ? '내 일정(기본)' : '캘린더 불러오는 중…'}</option>}
          {editable.map((c) => <option key={c.id} value={c.id}>{c.type === 'personal' ? '내 일정' : c.name}</option>)}
        </select>
        <div className="mt-2"><ColorRow value={color} onChange={setColor} testId="quick-color" /></div>
        {/* V5 반복(일정·업무 모두) — 반복 일정 + 업무에도 추가 = 같은 규칙의 반복 업무 */}
        <div className="mt-2" data-testid="quick-repeat"><RecurSelect value={rrule} onChange={setRrule} anchorDate={date} /></div>
        {!allDay && (
          <label className="mt-2 flex items-center gap-2 text-sm"><Bell className="size-4 shrink-0 text-ink-2" aria-hidden />
            <select className={cx(inputCls, 'h-9 flex-1')} value={remind} onChange={(e) => setRemind(e.target.value)} aria-label="알림" data-testid="quick-remind">
              <option value="default">알림: 기본(설정 시간)</option><option value="10">알림: 10분 전</option><option value="30">알림: 30분 전</option>
              <option value="60">알림: 1시간 전</option><option value="1440">알림: 하루 전</option><option value="none">알림 없음</option>
            </select></label>
        )}
        <label className="relative mt-2 flex cursor-pointer items-center gap-2.5 text-sm font-medium text-ink">
          <input type="checkbox" role="switch" className="peer absolute left-0 top-0.5 size-5 cursor-pointer opacity-0" checked={alsoTask} onChange={(e) => setAlsoTask(e.target.checked)} data-testid="quick-also-task" aria-label="업무 리스트에도 추가" />
          <span aria-hidden className="relative h-5 w-9 shrink-0 rounded-full bg-slate-300 transition-colors after:absolute after:left-0.5 after:top-0.5 after:size-4 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:bg-brand-600 peer-checked:after:translate-x-4" />
          <span className="min-w-0"><span className="whitespace-nowrap">업무 리스트에도 추가</span><span className="block text-xs font-normal text-ink-3">날짜를 바꾸면 서로 따라갑니다</span></span>
        </label>
        {alsoTask && (
          <div className="mt-2 grid grid-cols-2 gap-1.5 rounded-input bg-slate-50 p-2 text-xs" data-testid="quick-task-fields">
            <label className="col-span-2 flex items-center gap-2"><span className="w-10 shrink-0 text-ink-2">담당</span><UserSelect className="h-8 flex-1" value={taskWho ?? user.id} onChange={setTaskWho} ariaLabel="업무 담당자" /></label>
            <label className="col-span-2 flex items-center gap-2"><span className="w-10 shrink-0 text-ink-2">지시</span><UserSelect className="h-8 flex-1" value={taskReq ?? user.id} onChange={setTaskReq} ariaLabel="업무 요청자" /></label>
            <label className="col-span-2 flex items-center gap-2"><span className="w-10 shrink-0 text-ink-2">우선</span>
              <select className="h-8 flex-1 rounded-input border border-line bg-white px-2" value={taskPrio} onChange={(e) => setTaskPrio(e.target.value as typeof taskPrio)} aria-label="업무 우선순위">
                <option value="low">낮음</option><option value="normal">보통</option><option value="high">높음</option><option value="urgent">긴급</option>
              </select></label>
          </div>
        )}
        {<label className="mt-2 flex items-center gap-2 text-sm text-ink-2"><input type="checkbox" className="size-4" checked={priv} onChange={(e) => setPriv(e.target.checked)} />비공개 (다른 사람에게는 &ldquo;바쁨&rdquo;으로만)</label>}
        <div className="mt-4 flex items-center justify-between">
          {<button type="button" className="text-sm font-medium text-ink-2 hover:text-ink" onClick={() => onMore({ date, allDay, start: start ?? '09:00', end: end ?? '10:00', endDate: endDate ?? date, title, calendarId, isPrivate: priv, rrule, alsoTask, color })}>옵션 더보기</button>}
          <Button type="submit" size="sm" disabled={busy || !title.trim()} data-testid="quick-save">{busy ? '저장 중…' : '저장'}</Button>
        </div>
      </form>
    </>
  );
}
const fmtDateK = (d: string) => { const dt = new Date(d + 'T00:00:00Z'); return `${dt.getUTCMonth() + 1}월 ${dt.getUTCDate()}일 (${'일월화수목금토'[dt.getUTCDay()]})`; };

/** 로컬 10/20(대표): 색 고르기를 '옵션 더보기' 안이 아니라 일정 만들기·편집 첫 화면에 — 캘린더 색 · 최근 쓴 색 6 · 팔레트 · 직접 선택. 최근 색은 이 기기(localStorage) */
const RECENT_KEY = 'wos_recent_event_colors';
const recentColors = (): string[] => { try { return (JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') as string[]).slice(0, 6); } catch { return []; } };
const pushRecentColor = (c?: string | null) => { if (!c) return; try { localStorage.setItem(RECENT_KEY, JSON.stringify([c, ...recentColors().filter((x) => x !== c)].slice(0, 6))); } catch {} };
function ColorRow({ value, onChange, testId }: { value: string | null; onChange: (v: string | null) => void; testId: string }) {
  const [recent] = useState(recentColors);
  const extra = recent.filter((c) => !(c in PALETTE_NAMES));
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="일정 색" data-testid={testId}>
      <span className="mr-1 text-xs text-ink-2">색</span>
      <button type="button" role="radio" aria-checked={!value} onClick={() => onChange(null)} className={cx('rounded-full border border-line px-2 py-0.5 text-xs', !value ? 'bg-slate-800 text-white' : 'text-ink-2')}>캘린더 색</button>
      {extra.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={value === c} aria-label={`최근 색 ${c}`} title={`최근 ${c}`} onClick={() => onChange(c)}
          className={cx('flex size-5 items-center justify-center rounded-full ring-1 ring-line', value === c && 'ring-2 ring-ink ring-offset-1')} style={{ background: c }}>{value === c && <Check className="size-3 text-white" strokeWidth={3} />}</button>))}
      {Object.keys(PALETTE_NAMES).map((c) => (
        <button key={c} type="button" role="radio" aria-checked={value === c} aria-label={PALETTE_NAMES[c]} title={PALETTE_NAMES[c]} onClick={() => onChange(c)}
          className={cx('flex size-5 items-center justify-center rounded-full', value === c && 'ring-2 ring-ink ring-offset-1')} style={{ background: c }}>{value === c && <Check className="size-3 text-white" strokeWidth={3} />}</button>
      ))}
      <input type="color" value={value ?? '#039be5'} onChange={(e) => onChange(e.target.value)} className="size-5 cursor-pointer border-0 bg-transparent p-0" aria-label="직접 선택" title="직접 선택" />
    </div>
  );
}

function EventEditor({ id, occurrenceStart, draft, calendars, onClose, onSaved }: { id?: string; occurrenceStart?: string; draft?: any; calendars: any[]; onClose: () => void; onSaved: () => void; dirUsers: any[] }) {
  const { user, features } = useSession();
  const meetOn = !!features.meetings; const [meetNew, setMeetNew] = useState(false); // 219차 [워크인 화상회의](새 일정은 저장할 때 켬)
  const existing = useApi<any>(id ? `/api/events/${id}` : null);
  const [f, setF] = useState<any>(null);
  const prepList = useApi<{ presets: { id: string; label: string }[] }>(!id ? '/api/events/_/prep' : (null as unknown as string)); // 준비 업무 묶음(새 일정일 때만)
  const prepPresets = prepList.data?.presets ?? [];
  const [conf, setConf] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const editable = calendars.filter((c) => c.perms.edit);

  // 로컬 10/20(대표 재발 "생성 후 편집이 안 됨"): 다른 곳(빠른 입력 저장·자동 저장·알림·다른 탭)의 wos-refresh 로 /api/events/{id} 가 다시 올 때마다 폼을 서버 값으로 되돌려
  // 입력 중인 글이 사라지고, 자동 저장이 올린 버전을 옛 응답이 덮어써 [완료]가 409 가 나던 문제 — 폼은 일정 하나당 한 번만 채우고, 다시 온 응답은 버전(더 큰 값)만 따라간다
  const initedFor = useRef<string | null>(null);
  useEffect(() => {
    if (id) {
      const d = existing.data;
      if (!d) return;
      if (initedFor.current === id) return;
      initedFor.current = id;
      const e = d.event;
      const dur = new Date(e.end_at).getTime() - new Date(e.start_at).getTime();
      const s = occurrenceStart && !e.recurring_event_id ? new Date(occurrenceStart) : new Date(e.start_at);
      const en = new Date(s.getTime() + dur);
      setF({ title: e.title, calendarId: e.calendar_id, allDay: e.all_day, date: seoulDate(s), start: seoulTime(s),
        endDate: e.all_day ? addDays(seoulDate(en), -1) : seoulDate(en), end: seoulTime(en), rrule: e.rrule, location: e.location, meetingUrl: e.meetingUrl ?? '',
        description: e.description, kind: e.kind, attendeeIds: d.attendees.map((a: any) => a.user_id), version: e.version, reminders: e.reminder_minutes ?? null, alarm: e.alarm ?? null, isPrivate: !!e.is_private, color: e.color ?? null });
    } else {
      const personal = calendars.find((c) => c.type === 'personal');
      setF({ title: draft?.title ?? '', calendarId: draft?.calendarId || personal?.id || editable[0]?.id || '', allDay: draft?.allDay ?? false, date: draft?.date, start: draft?.start ?? '09:00',
        endDate: draft?.endDate ?? draft?.date, end: draft?.end ?? '10:00', rrule: draft?.rrule ?? null, location: '', meetingUrl: '', description: '', kind: 'normal', attendeeIds: [], reminders: null, isPrivate: !!draft?.isPrivate, prep: '', color: draft?.color ?? null, alsoTask: !!draft?.alsoTask });
    }
  }, [existing.data, id]); // eslint-disable-line react-hooks/exhaustive-deps
  // 236차(대표 10/28 '일정생성불가함' — 로컬 재현): 창이 캘린더 목록보다 먼저 열리면 새 일정의 캘린더가 빈 채로 남고, 고르기 칸은 첫 캘린더를 보여 줘
  // 저장이 '캘린더: 필수 항목'으로 막혔다 — 목록이 오면 내 개인 일정(없으면 쓸 수 있는 첫 캘린더)으로 채움
  useEffect(() => {
    if (id || !f || f.calendarId) return;
    const c = (calendars.find((x) => x.type === 'personal') ?? editable[0])?.id;
    if (c) setF((p: any) => (p && !p.calendarId ? { ...p, calendarId: c } : p));
  }, [calendars, id, f?.calendarId]); // eslint-disable-line react-hooks/exhaustive-deps

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
  // 대표 지적(10/19 ① 수정 실패): 자동 저장이 서버 버전을 올린 뒤 [완료]가 처음 버전을 보내 409 가 나던 문제 — 버전은 저장할 때마다 따라감, 진행 중 자동 저장은 기다림
  const verRef = useRef<number | undefined>(undefined);
  const autoRun = useRef<Promise<unknown> | null>(null);
  const [autoState, setAutoState] = useState<'' | 'saving' | 'saved' | 'error'>('');
  useEffect(() => { if (existing.data?.event) verRef.current = Math.max(verRef.current ?? 0, existing.data.event.version); }, [existing.data]);
  /** 409(다른 곳에서 먼저 바뀜)면 최신 버전을 다시 불러와 지금 고친 내용으로 한 번 더 저장 — 로컬 10/20: "다시 불러와 적용" 자동 재시도 1회 */
  const patchWithRetry = async (body: Record<string, unknown>) => {
    try { return await api(`/api/events/${id}`, { method: 'PATCH', body: { ...body, version: verRef.current } }); }
    catch (er: any) {
      if (er?.status !== 409) throw er;
      const cur = (er?.detail?.currentVersion as number | undefined) ?? (await api(`/api/events/${id}`).then((x) => x.event.version as number));
      verRef.current = cur;
      return api(`/api/events/${id}`, { method: 'PATCH', body: { ...body, version: cur } });
    }
  };
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
      const run = patchWithRetry({ title: f.title, calendarId: f.calendarId, allDay: f.allDay, start: t.start, end: t.end, rrule: f.rrule, location: f.location, meetingUrl: f.meetingUrl || '', description: f.description, kind: f.kind, attendeeIds: f.attendeeIds, reminderMinutes: f.reminders, alarm: f.alarm ?? null, isPrivate: !!f.isPrivate, color: f.color ?? null, scope: 'all' });
      autoRun.current = run.catch(() => {});
      try {
        const r = await run;
        if (typeof r?.version === 'number') verRef.current = r.version;
        baseRef.current = cur; setAutoState('saved'); onSaved();
      } catch (er: any) { setAutoState('error'); toast.error(`자동 저장 실패: ${saveError(er)}`); }
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
    await autoRun.current;
    try {
      const body = { title: f.title, calendarId: f.calendarId || undefined, allDay: f.allDay, start: t.start, end: t.end, rrule: f.rrule, location: f.location, meetingUrl: f.meetingUrl || '', description: f.description, kind: f.kind, attendeeIds: f.attendeeIds, reminderMinutes: f.reminders, alarm: f.alarm ?? null, isPrivate: !!f.isPrivate, color: f.color ?? null };
      if (!id) {
        const made = await api<{ id?: string }>('/api/events', { body: { ...body, alsoTask: !!f.alsoTask } }); pushRecentColor(f.color);
        if (meetOn && meetNew && made?.id) await enableEventMeeting(made.id);
        // 대표 10/21 12:20 ②: 준비 업무는 '선택 창(체크, 기본 꺼짐)' — 자동 생성 없음. 체크했을 때만 묶음으로 만든다
        if (f.prep && made?.id) { try { const pr = await api<{ ids: string[] }>(`/api/events/${made.id}/prep`, { body: { preset: f.prep } }); toast.ok(`준비 업무 ${pr.ids?.length ?? 0}건을 만들었습니다`); } catch (e: any) { toast.error(`준비 업무를 만들지 못했습니다: ${e.message}`); } }
      } else {
        let scope: Scope = 'all';
        if (d.event.recurring_event_id) scope = 'this';
        else if (d.event.rrule) { const s = await askScope(); if (!s) { setBusy(false); return; } scope = s; }
        const { rrule, ...rest } = body;
        const pb = { ...rest, ...(scope !== 'this' ? { rrule } : {}), scope, occurrenceStart };
        if (scope === 'all' || !isRecurring) { const r = await patchWithRetry(pb); if (typeof r?.version === 'number') verRef.current = r.version; pushRecentColor(f.color); }
        else await api(`/api/events/${id}`, { method: 'PATCH', body: { ...pb, version: undefined } });
      }
      toast.ok('저장했습니다'); onSaved(); onClose();
    } catch (er: any) { toast.error(saveError(er)); if (er?.status === 409) api(`/api/events/${id}`).then((x) => { verRef.current = x.event.version; }).catch(() => {}); } finally { setBusy(false); }
  }
  async function remove() {
    let scope: Scope = 'all';
    if (d.event.recurring_event_id) scope = 'this';
    else if (d.event.rrule) { const s = await askScope(); if (!s) return; scope = s; }
    else if (!confirm('일정을 삭제할까요?')) return;
    const alsoTask = askAlsoTask(d.syncTask, scope, isRecurring);
    try {
      await api(`/api/events/${id}?scope=${scope}${occurrenceStart ? `&occurrenceStart=${encodeURIComponent(occurrenceStart)}` : ''}${alsoTask ? '&alsoTask=1' : ''}`, { method: 'DELETE' });
      toast.ok('삭제했습니다', id && scope === 'all' ? undoDelete(id) : undefined); onSaved(); onClose();
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
              <select className={inputCls} value={f.calendarId ?? ''} onChange={(e) => set('calendarId')(e.target.value)}>
                {!f.calendarId && <option value="">{calendars.length ? '내 개인 일정(기본)' : '캘린더 불러오는 중…'}</option>}
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
          {/* 대표 지적(10/19 ②): 일정별 색 덮어쓰기(Google 일정 색) — 비우면 캘린더 색. 로컬 10/20: 첫 화면에 바로(빠른 입력에도 같은 줄) */}
          {canEdit && <ColorRow value={f.color ?? null} onChange={set('color')} testId="event-color" />}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!f.isPrivate} onChange={(e) => set('isPrivate')(e.target.checked)} />비공개 — 다른 사람에게는 시간만 &ldquo;바쁨&rdquo;으로 보입니다</label>
          {/* V5 일정 ↔ 업무 연동 */}
          {!id ? (
            <><label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={!!f.alsoTask} onChange={(e) => set('alsoTask')(e.target.checked)} data-testid="editor-also-task" />업무 리스트에도 추가 <span className="text-xs font-normal text-ink-3">— 같은 이름·날짜의 업무(담당 나), 날짜를 바꾸면 서로 따라갑니다{f.rrule ? ' · 반복 업무로' : ''}</span></label>
            {/* 대표 10/21 12:20 ②: 준비 업무 만들기 — 선택 창(기본 꺼짐), 묶음 고르면 저장 뒤 D-n 마감 업무로 */}
            <label className="flex flex-wrap items-center gap-2 text-sm font-medium"><input type="checkbox" checked={!!f.prep} onChange={(e) => set('prep')(e.target.checked ? 'contract_meeting' : '')} data-testid="editor-prep" />준비 업무 만들기
              {f.prep ? <select className={cx(inputCls, 'h-8 w-auto py-1 text-xs')} value={f.prep} onChange={(e) => set('prep')(e.target.value)} aria-label="준비 업무 묶음" data-testid="editor-prep-preset">{prepPresets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
                : <span className="text-xs font-normal text-ink-3">— 체크하면 묶음(현장 점검·계약 미팅·행사 등)대로 D-n 마감 업무를 만듭니다. 자동으로 만들지 않습니다</span>}</label></>
          ) : d?.syncTask ? (
            <p className="flex items-center gap-2 text-sm" data-testid="editor-sync-task"><CircleCheck className="size-4 text-green-600" />연결된 업무: <Link href={`/tasks/${d.syncTask.id}`} className="font-medium underline">{d.syncTask.title}</Link><span className="text-xs text-ink-3">날짜 연동</span></p>
          ) : canEdit ? (
            <button type="button" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline" data-testid="editor-add-task"
              onClick={async () => { try { await api(`/api/events/${id}`, { method: 'PATCH', body: { alsoTask: true } }); toast.ok('업무에도 추가했습니다'); existing.reload(); onSaved(); } catch (er: any) { toast.error(er.message); } }}>
              <Plus className="size-4" />업무 리스트에도 추가</button>
          ) : null}
          {(!d?.event?.recurring_event_id) && <div><div className="mb-1 text-xs font-medium text-slate-600">반복</div><RecurSelect value={f.rrule} onChange={set('rrule')} anchorDate={f.date} /></div>}
          <div><div className="mb-1 text-xs font-medium text-slate-600">알림 {isRecurring && <span className="font-normal text-slate-400">(반복 일정 전체에 적용)</span>}</div><ReminderEditor value={f.reminders} onChange={set('reminders')} alarm={f.alarm ?? null} onAlarm={set('alarm')} /></div>
          <div><div className="mb-1 text-xs font-medium text-slate-600">참석자</div><MultiUserSelect value={f.attendeeIds} onChange={set('attendeeIds')} /></div>
          {conf.length > 0 && (
            <div className="rounded bg-amber-50 p-2 text-xs text-amber-900" role="alert" data-testid="conflicts">
              <b>일정 충돌 안내</b>
              <ul className="mt-1 list-disc pl-4">{conf.map((c, i) => <li key={i}>{c.who.join(', ')}: {c.title} ({fmtTimeRange(c.start, c.end)})</li>)}</ul>
            </div>
          )}
          <Field label="장소"><input className={inputCls} value={f.location} onChange={(e) => set('location')(e.target.value)} placeholder="예: 음성 아이파크 — 적으면 이동 일정" /></Field>
          {/* V36 4: 장소를 적으면 이동 일정 — 캘린더에서 📍·진한 테두리, 알림 따로 안 정하면 30분 전 알림이 더해짐 */}
          {f.location?.trim() && <p className="-mt-1 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800" data-testid="editor-travel"><MapPin className="size-3" />이동 있음{!f.reminders ? ' · 30분 전 알림 기본' : ''}</p>}
          {/* 219차 [워크인 화상회의] — 켜면 회의 주소 칸에 워크인 회의 주소(직접 붙여 넣는 칸은 숨김) */}
          {meetOn && <WorkinMeetingToggle eventId={id} canEdit={!!canEdit} url={f.meetingUrl ?? ''} onUrl={(u) => set('meetingUrl')(u)} newOn={meetNew} setNewOn={setMeetNew} />}
          {/* V30 ⑪ (#111) 화상 회의 링크 — 적으면 일정 상세에 [회의 참여] */}
          {!(meetOn && (id ? isWorkinMeet(f.meetingUrl) : meetNew)) && <Field label="화상 회의 링크 (Zoom·Google Meet 등, 선택)" hint="없으면 비워 두세요 · 줌 회의 번호만 적어도 됩니다"><input className={inputCls} inputMode="url" value={f.meetingUrl ?? ''} onChange={(e) => set('meetingUrl')(e.target.value)} placeholder="https://meet.google.com/…" data-testid="ev-meeting-url" /></Field>}
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
        {/* 로컬 검수 10/17: 휴대폰 시트에서도 [완료]/[닫기]가 늘 보이게 아래에 붙임(메일 시안과 같은 방식) */}
        <div className="sticky bottom-0 z-10 -mx-5 -mb-[calc(var(--sab)+20px)] flex justify-between gap-2 border-t border-line bg-white px-5 pb-[calc(var(--sab)+12px)] pt-3 sm:-mb-5 sm:pb-4" data-testid="editor-actions">
          <div>{id && canEdit && <Button type="button" variant="danger" onClick={remove}>삭제</Button>}</div>
          <div className="flex gap-2">
            {canEdit && <span className="self-center text-xs text-ink-3" aria-live="polite" data-testid="editor-autosave">{busy || autoState === 'saving' ? '저장 중…' : autoState === 'saved' ? '저장됨' : autoState === 'error' ? '저장하지 못했습니다' : id ? '바꾸면 자동 저장' : '닫으면 자동 저장'}</span>}
            <Button type="button" variant={canEdit && dirty ? 'primary' : 'secondary'} onClick={closeAndSave} data-testid="editor-close">{canEdit && dirty ? '완료' : '닫기'}</Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

/** 대표 지적(10/19 ①): 저장 실패 이유를 화면에 — 권한·버전 충돌·입력 오류를 사람 말로 */
function saveError(er: any): string {
  const st = er?.status;
  if (st === 409) return '다른 곳에서 먼저 바뀌었습니다. 지금 고친 내용으로 덮어쓰려면 [완료]를 한 번 더 눌러 주세요.';
  if (st === 403) return `${er.message || '이 일정을 고칠 권한이 없습니다'} (일정 주인이나 캘린더 관리자만 고칠 수 있습니다)`;
  if (st === 404) return '일정을 찾을 수 없습니다(삭제되었거나 볼 수 없는 일정).';
  if (st === 400) return `입력을 확인해 주세요: ${er.message}`;
  return er?.message || '저장하지 못했습니다';
}

/** 업무 시간 블록 제목의 옛 접두어 정리 ("[업무] …") — 화면에서는 아이콘으로 구분 */
function cleanTitle(t: string) { return t.replace(/^(\[(업무|업무 시간)\]\s*)+/, ''); }
// #592(대표 10/25 구글 주 보기 대조): 좁은 블록(휴대폰 주·3일)은 앞머리 [다짐 문의]·[영업]·[시험] 같은 태그를 떼고 내용부터 — 태그 뜻은 색·왼쪽 선으로.
// 부재 종류([연차]·[출장]·[휴가] 등)는 남긴다. 태그뿐인 제목은 그대로
const KEEP_TAG = /^(연차|반차|반반차|외근|출장|휴가|병가|재택|부재|공가|교육|훈련|경조사?)$/;
function narrowTitle(t: string) {
  let s = t, keep = '';
  for (let m = /^\s*\[([^\]]{1,20})\]\s*/.exec(s); m; m = /^\s*\[([^\]]{1,20})\]\s*/.exec(s)) { if (KEEP_TAG.test(m[1].trim())) keep += `[${m[1].trim()}] `; s = s.slice(m[0].length); }
  return s.trim() ? keep + s.trim() : t;
}

/** 일정 미리보기: 시간·장소·참석자·연결 업무, 업무 시간 블록이면 그 업무의 상태·완료 */
function EventPreview({ ev, folded = [], x, y, calendarName, onClose, onEdit, onChanged, onOpenTask }: { ev: any; folded?: any[]; x: number; y: number; calendarName?: string; onClose: () => void; onEdit: () => void; onChanged: () => void; onOpenTask: (id: string) => void }) {
  // #242 2단계: 업무 시간 블록의 업무는 캘린더 위 업무 패널로(예전엔 페이지를 새로 불러와 닫으면 업무 목록으로 감). Ctrl·⌘·가운데 클릭은 새 탭
  const openIn = (e: React.MouseEvent, id: string) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); onOpenTask(id); };
  const occ = ev.recurring && !ev.exception && ev.originalStart ? `?occurrenceStart=${encodeURIComponent(new Date(ev.originalStart).toISOString())}` : '';
  const linked = useApi<{ tasks: any[] }>(ev.masked ? null : `/api/events/${ev.id}/tasks${occ}`);
  const tasks = linked.data?.tasks ?? [];
  const block = ev.kind === 'task_block' ? tasks.find((t) => t.link_role === 'block') ?? tasks[0] : null;
  const going = (ev.attendees ?? []).filter((a: any) => a.response !== 'declined');
  const { user, features } = useSession(); const meetOn = !!features.meetings;
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
      toast.ok('삭제했습니다', scope === 'all' ? undoDelete(ev.id) : undefined); onChanged();
    } catch (e: any) { toast.error(e.message); }
  }
  const [doneIds, setDoneIds] = useState<string[]>([]);
  async function complete(t: any) {
    const to = t.status === 'review' ? 'done' : t.approval_line_id || t.approval_required ? 'review' : 'done';
    try {
      await api(`/api/tasks/${t.id}`, { method: 'PATCH', body: { status: to, version: t.version } });
      toast.ok(to === 'review' ? '검토를 요청했습니다' : '업무를 완료했습니다'); setDoneIds((xs) => [...xs, t.id]); linked.reload(); onChanged();
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
            {ev.meetingUrl && <a href={ev.meetingUrl} target="_blank" rel="noreferrer" className="mt-1.5 inline-flex h-8 items-center gap-1 rounded-input bg-brand-600 px-2.5 text-xs font-medium text-white hover:bg-brand-700" data-testid="ev-join"><Video className="size-3.5" />회의 참여</a>}
            {meetOn && !ev.masked && isWorkinMeet(ev.meetingUrl) && <MeetingRecordLine eventId={ev.id} />}
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
              <a href={`/tasks/${block.id}`} onClick={(e) => openIn(e, block.id)} className="min-w-0 flex-1 truncate font-medium hover:underline">{block.title}</a>
              <DueChip due={block.due_date} status={block.status} />
            </div>
            <div className="mt-2 flex items-center gap-1.5">
              <Avatar id={block.assignee_id} name={block.assignee_name} size={20} /><span className="flex-1 text-xs text-ink-2">{block.assignee_name ?? '담당자 없음'}</span>
              <a href={`/tasks/${block.id}`} onClick={(e) => openIn(e, block.id)} data-testid="block-task-open"><Button type="button" size="sm" variant="ghost"><ExternalLink />업무 열기</Button></a>
              {block.status !== 'done' && <Button type="button" size="sm" onClick={() => complete(block)}><CircleCheck />{block.status === 'review' ? '최종 완료' : '완료'}</Button>}
            </div>
          </div>
        ) : tasks.length > 0 && (
          <div className="mt-3">
            <p className="mb-1 flex items-center gap-1 text-xs font-semibold text-ink-2"><ClipboardList className="size-3.5" />연결 업무 {tasks.length}건{tasks.some((t) => t.status !== 'done' && t.due_date && t.due_date < new Date().toISOString().slice(0, 10)) ? ' · 지연 있음' : ''}</p>
            <LinkedTaskList tasks={tasks.slice(0, 4)} compact />
          </div>
        )}
        {folded.length > 0 && (
          <div className="mt-3 space-y-1.5" data-testid="preview-folded">
            <p className="flex items-center gap-1 text-xs font-semibold text-ink-2"><ClipboardList className="size-3.5" />같은 건 업무 {folded.length}건 — 이 일정 줄에 함께 보입니다</p>
            {folded.map((t) => { const done = t.status === 'done' || doneIds.includes(t.id); return (
              <div key={t.id} className="rounded-input border border-line p-2.5" data-testid="preview-folded-task">
                <div className="flex items-center gap-2 text-sm">
                  <StatusBadge status={done ? 'done' : t.status} />
                  <a href={`/tasks/${t.id}`} onClick={(e) => openIn(e, t.id)} className="min-w-0 flex-1 truncate font-medium hover:underline">{cleanTitle(t.title)}</a>
                  <span className="shrink-0 text-xs text-ink-2">{t.due_time ? `마감 ${t.due_time.slice(0, 5)}` : ''}</span>
                </div>
                <div className="mt-2 flex items-center gap-1.5">
                  <Avatar id={t.assignee_id} name={t.assignee_name} size={20} /><span className="flex-1 truncate text-xs text-ink-2">{t.assignee_name ?? '담당자 없음'}</span>
                  <a href={`/tasks/${t.id}`} onClick={(e) => openIn(e, t.id)} data-testid="preview-folded-open"><Button type="button" size="sm" variant="ghost"><ExternalLink />업무 열기</Button></a>
                  {!done && <Button type="button" size="sm" onClick={() => complete(t)} data-testid="preview-folded-done"><CircleCheck />{t.status === 'review' ? '최종 완료' : '완료'}</Button>}
                </div>
              </div>); })}
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

/** 241차: 통째로 지운 일정은 안내의 [되돌리기]로 바로 되살림(나중에는 캘린더 › 지운 일정) */
function undoDelete(id: string) {
  return { label: '되돌리기', run: () => { api(`/api/events/${id}/restore`, { method: 'POST' }).then(() => { toast.ok('일정을 되살렸습니다'); broadcastRefresh(); }, (e: Error) => toast.error(e.message)); } };
}

export default dynamic(() => Promise.resolve(CalendarPage), { ssr: false });
