'use client';
import { PhoneInquiryButton } from './PhoneInquiry';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useRowOpen } from './rowOpen';
import { DndContext, MouseSensor, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
import { api, broadcastRefresh, useApi } from './client';
import { useSession } from './session';
import { CalendarDays as CalIcon, Camera, CheckCheck, ChevronLeft, ChevronRight, ChevronDown, CircleCheck, Diamond, GanttChart, KanbanSquare, LayoutList, ListChecks, MessageSquare, Paperclip, FileSpreadsheet, GripVertical, MoreHorizontal, Plus, Repeat, Search, SlidersHorizontal, Stamp, Trash2, X, Check, Lock } from 'lucide-react';
import { Avatar, BrandDot, Button, DueChip, Empty, ErrorBox, Modal, PriorityTag, STATUS_TONE, Skeleton, StatusBadge, cx, fmtDate, inputCls, toast, todayStr } from './ui';
import { HIDDEN_BRANDS, STATUSES, STATUS_LABEL, type TaskStatus } from '@/lib/types';
import { UnitSelect } from './pickers';
import { TaskDetail } from './TaskDetail';
import { AssigneePicker, DuePicker, InlineAddTask, OrderMenu, Popover, PriorityPicker, isFresh, quickDues } from './TaskQuick';
import { QuickAddTask } from './QuickAddTask';
import { CarriedBadge } from './carried';

export type Task = {
  id: string; title: string; status: TaskStatus; priority: any; project_id: string | null; project_name: string | null; project_color: string | null;
  team_id?: string | null; team_name?: string | null; team_color?: string | null;
  org_unit_id: string; org_unit_name: string; brand_id: string | null; assignee_id: string | null; assignee_name: string | null;
  start_date: string | null; due_date: string | null; due_time: string | null; version: number; subtask_count: number; subtask_done: number;
  checklist_total: number; checklist_done: number; comment_count: number; attachment_count: number; blocked_by_count: number;
  recurrence_rule: string | null; approval_required: boolean; tags: string[];
  section_id?: string | null; assignee_ack_at?: string | null; created_by?: string; sort_order?: number;
  task_type?: 'normal' | 'milestone' | 'approval' | 'inspection'; approval_line_id?: string | null; photo_required?: number; photo_count?: number;
  fields?: Record<string, unknown>;
  requested_by?: string | null; requested_by_name?: string | null; created_at?: string; completed_at?: string | null;
  assigned_at?: string | null;
  batch_id?: string | null; batch?: { total: number; done: number } | null; recurrence_source_id?: string | null;
};

/** B-1 업무를 목록 옆 오른쪽 패널로 연다. URL 은 /tasks/:id 로 바꿔 새로고침·공유가 가능하다. 새 탭(Ctrl/⌘/가운데 클릭)은 그대로 전체 화면 */
const OpenTaskCtx = createContext<(id: string) => void>(() => {});
/** V14 12번 다중 선택: 선택 모드·선택된 id·토글(Shift 는 화면 순서로 범위) */
type Sel = { on: boolean; sel: Set<string>; toggle: (id: string, range?: boolean) => void; enter: (id: string) => void };
const SelectCtx = createContext<Sel | null>(null);

function TaskLink({ id, className, children }: { id: string; className?: string; children: React.ReactNode }) {
  const open = useContext(OpenTaskCtx);
  return (
    <a href={`/tasks/${id}`} className={className} data-open-task={id} onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); open(id); }}>{children}</a>
  );
}
type Section = { id: string; name: string; sort: number };

type ViewMode = 'list' | 'board' | 'calendar' | 'timeline';
const VIEW_MODES: ViewMode[] = ['list', 'board', 'calendar', 'timeline'];
const LIST_VIEWS = ['all', 'my', 'today', 'overdue', 'week', 'review', 'risk', 'requested', 'done'];
const cleanView = (v: string | null) => (v && LIST_VIEWS.includes(v) ? v : '');

/** V14 40번: 진행 중·대기 중인 끌기(dnd-kit) 취소 — 센서는 창 resize 에 취소되며 문서 클릭 가로채기도 걷어 낸다 */
const NO_SENSORS: never[] = [];
/** V14 40번: 꾹 눌러 선택한 뒤 손을 뗄 때 오는 클릭 한 번은 어디에 떨어져도(행이 움직여 옆 행이어도) 버린다 */
function swallowNextClick() {
  const h = (e: Event) => { e.preventDefault(); e.stopPropagation(); };
  document.addEventListener('click', h, { capture: true, once: true });
  setTimeout(() => document.removeEventListener('click', h, { capture: true }), 900);
}
function cancelDrag() { try { window.dispatchEvent(new Event('resize')); } catch {} }

export function TaskViews({ fixed, title, defaultMode = 'list' }: { fixed?: Record<string, string>; title?: string; defaultMode?: ViewMode }) {
  const sp = useSearchParams();
  const router = useRouter();
  const sess = useSession(); const { dir } = sess;
  const [mode, setMode] = useState<ViewMode>(() => {
    // U-0a ?view=board 처럼 보기 이름이 view 로 들어와도 화면 보기로 해석, 모르는 값은 기본 보기
    const m = sp.get('mode') ?? sp.get('view');
    return VIEW_MODES.includes(m as ViewMode) ? (m as ViewMode) : defaultMode;
  });
  const [q, setQ] = useState(sp.get('q') ?? '');
  const [filters, setFilters] = useState<Record<string, string>>(() => {
    const f: Record<string, string> = {};
    for (const k of ['brandId', 'orgUnitId', 'assigneeId', 'status', 'from', 'to', 'teamId']) { const v = sp.get(k); if (v) f[k] = v; }
    const v = cleanView(sp.get('view')); if (v) f.view = v;
    return f;
  });
  // V11 2번: "완료된 업무도 보기" 체크박스는 없앰(상단 "완료" 칩 = 완료 업무 월별). 주소 ?done=1 만 호환
  const [showDone] = useState(sp.get('done') === '1');
  // 묶기: 담당자별(기본) · 마감일 · 프로젝트 · 묶지 않음. "내 업무"는 마감일 묶음(새로 배정됨 확인 포함)이 기본
  const [groupPick, setGroupPick] = useState<GroupBy | ''>(() => {
    const g = sp.get('group'); if (GROUPS.includes(g as GroupBy)) return g as GroupBy;
    try { const v = localStorage.getItem('wos_task_group'); return GROUPS.includes(v as GroupBy) ? (v as GroupBy) : ''; } catch { return ''; }
  });
  const [adding, setAdding] = useState(false);
  // 정렬: 마감순(기본, V14 16번)·직접 순서·우선순위·최근 생성 … 사용자별(이 기기) 기억
  const [sortBy, setSortBy] = useState<SortKey>(() => { try { const v = localStorage.getItem('wos_task_sort2'); return SORTS.includes(v as SortKey) ? (v as SortKey) : 'due'; } catch { return 'due'; } });
  const pickSort = (k: SortKey) => { setSortBy(k); try { localStorage.setItem('wos_task_sort2', k); } catch {} };
  const [quickOpen, setQuickOpen] = useState(false);
  const kbProxy = useRef<HTMLInputElement>(null);
  const [moreMenu, setMoreMenu] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [addKey, setAddKey] = useState(0);
  // V6 12번: 휴대폰은 업무 등록 시트(맨 위 줄이 화면 밖이거나 이미 열려 있어 반응 없던 문제), PC 는 맨 위 한 줄 추가(누를 때마다 새로 열고 초점)
  const openAdd = () => {
    const phone = window.innerWidth < 640;
    if (phone || mode !== 'list') { kbProxy.current?.focus(); setQuickOpen(true); return; }
    setAdding(true); setAddKey((k) => k + 1);
    setTimeout(() => document.querySelector<HTMLElement>('[data-testid="task-groups"] [aria-label="업무 추가 제목"]')?.scrollIntoView({ block: 'center' }), 50);
  };
  useEffect(() => { // URL 변경(메뉴 이동) 반영 — 패널로 /tasks/:id 가 된 동안에는 목록 필터를 그대로 둔다
    if (/^\/tasks\/[0-9a-f-]{36}$/.test(location.pathname)) return;
    const v = cleanView(sp.get('view'));
    setFilters((f) => ((f.view ?? '') === v ? f : { ...f, view: v }));
  }, [sp]);

  const qs = useMemo(() => {
    const p = new URLSearchParams({ ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)), ...(fixed ?? {}) });
    if (q) p.set('q', q);
    // V6 16번: 기본 목록에도 오늘 완료한 업무(댓글 있으면 7일)는 남겨 취소선으로 — "완료" 보기는 완료 업무 전체(월별)
    if (!showDone && mode !== 'board' && !filters.status && (fixed?.view ?? filters.view) !== 'done') p.set('includeDone', 'recent');
    if ((fixed?.view ?? filters.view) === 'done') { p.set('limit', '1000'); if (mode === 'list') p.set('doneMonth', todayStr().slice(0, 7)); } // V20: 목록은 이번 달만, 지난달은 펼칠 때
    return p.toString();
  }, [filters, fixed, q, showDone, mode]);
  const { data, error, loading, reload, setData } = useApi<{ tasks: Task[] }>(`/api/tasks?${qs}`);
  const tasks = useMemo(() => sortTasks(data?.tasks ?? [], sortBy), [data, sortBy]);
  // V14 42번: 보기 칩 건수 — 목록과 같은 필터(보기·담당자 제외), 목록이 바뀔 때마다 다시
  const countQs = useMemo(() => { const p = new URLSearchParams(qs); ['view', 'assigneeId', 'limit', 'doneMonth', 'carried'].forEach((k) => p.delete(k)); return p.toString(); }, [qs]);
  const counts = useApi<{ counts: Record<string, number> }>(fixed?.view ? null : `/api/tasks/counts?${countQs}`);
  useEffect(() => { if (data) counts.reload(); }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const p = new URLSearchParams(sp.toString());
    p.set('mode', mode);
    router.replace(`?${p}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  /** 모든 보기에서 같은 경로로 원본 업무를 수정 → 다른 보기에도 즉시 반영 */
  // "방금 완료한 업무": 완료되어 목록에서 빠진 업무를 다시 찾고 되돌릴 수 있게 (실수로 사라진 듯 보이지 않게)
  const [justDone, setJustDone] = useState<{ t: Task; prev: TaskStatus }[]>([]);
  const [justOpen, setJustOpen] = useState(false);
  // 이 화면에서 방금 완료한 업무는 그 자리에 취소선으로 남긴다(목록을 새로 불러와도)
  const keepIds = useMemo(() => new Set(justDone.map((x) => x.t.id)), [justDone]);
  async function patch(t: Task, body: Record<string, unknown>) {
    const before = data;
    if (body.status === 'done' && t.status !== 'done') setJustDone((x) => [{ t, prev: t.status }, ...x.filter((y) => y.t.id !== t.id)].slice(0, 20));
    if (body.status && body.status !== 'done') setJustDone((x) => x.filter((y) => y.t.id !== t.id));
    setData((d) => d && { tasks: d.tasks.map((x) => (x.id === t.id ? { ...x, ...snake(body) } : x)) });
    try {
      const r = await api(`/api/tasks/${t.id}`, { method: 'PATCH', body: { ...body, version: t.version } });
      setData((d) => d && { tasks: d.tasks.map((x) => (x.id === t.id ? { ...x, version: r.version } : x)) });
      if (r.spawned) toast.info('반복 업무의 다음 회차가 생성되었습니다');
      broadcastRefresh();
      return true;
    } catch (e: any) {
      setData(before);
      toast.error(e.message);
      if (e.status === 409 || e.status === 403) reload();
      return false;
    }
  }

  /** 직접 순서 저장 (끌어 놓기). 화면에 바로 반영하고 서버에 보이는 순서대로 보낸다 */
  async function reorder(ids: string[]) {
    setData((d) => d && { tasks: d.tasks.map((x) => { const i = ids.indexOf(x.id); return i >= 0 ? { ...x, sort_order: i } : x; }) });
    try { await api('/api/tasks/reorder', { body: { ids } }); broadcastRefresh(); } catch (e: any) { toast.error(e.message); reload(); }
  }

  // 오른쪽 패널
  const [panelId, setPanelId] = useState<string | null>(null);
  const listUrl = useRef<string | null>(null);
  const openTask = useCallback((id: string) => {
    if (!listUrl.current) listUrl.current = location.pathname + location.search;
    // V12 4번: 패널이 열린 채 다른 업무를 누르면 닫지 않고 그 업무로 교체(기록은 한 칸만 — 닫으면 바로 목록)
    if (window.history.state?.wosPanel) window.history.replaceState({ wosPanel: id }, '', `/tasks/${id}`);
    else window.history.pushState({ wosPanel: id }, '', `/tasks/${id}`);
    setPanelId(id);
  }, []);
  const closePanel = useCallback(() => {
    if (window.history.state?.wosPanel) window.history.back();
    else { if (listUrl.current) window.history.replaceState(null, '', listUrl.current); setPanelId(null); }
  }, []);
  useEffect(() => {
    const onPop = () => {
      const m = /^\/tasks\/([0-9a-f-]{36})$/.exec(location.pathname);
      setPanelId(m && window.history.state?.wosPanel ? m[1] : null);
      if (!m) listUrl.current = null;
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && panelId && !document.querySelector('[role=dialog]')) closePanel(); };
    // V12 4번(PC): 패널 바깥(목록 빈 곳·사이드바 등)을 누르면 닫힘 — 업무 행·선택 창·대화상자·알림 띠는 제외. 입력 중이던 칸은 초점이 빠지며 자동 저장
    const onDown = (e: PointerEvent) => {
      if (!panelId || window.innerWidth < 640) return;
      const el = e.target as HTMLElement | null;
      if (!el?.closest || el.closest('[data-testid="task-panel"],[data-row],[data-open-task],[data-task-id],[role=dialog],[data-sheet],[role=status],[role=alert],.fixed.inset-0')) return;
      closePanel();
    };
    window.addEventListener('popstate', onPop);
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => { window.removeEventListener('popstate', onPop); window.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onDown); };
  }, [panelId, closePanel]);

  // B-3 프로젝트 섹션
  const projectId = fixed?.projectId;
  const sectionsApi = useApi<{ sections: Section[] }>(projectId ? `/api/projects/${projectId}/sections` : null);
  const sections = sectionsApi.data?.sections ?? [];
  const [boardBy, setBoardBy] = useState<'status' | 'section'>('status');

  const curView = fixed?.view ?? filters.view ?? '';
  // V14 34-보정: 기본 묶기는 PC·휴대폰 모두 담당자별(각 묶음 안은 마감 일시 오름차순 — 기본 정렬 'due'), 마감별은 묶기 메뉴에서 선택
  const group: GroupBy = groupPick || (curView === 'my' ? 'due' : 'assignee');
  const pickGroup = (g: GroupBy) => { setGroupPick(g); try { localStorage.setItem('wos_task_group', g); } catch {} };
  // 상단 칩: 전체 · 내 업무 · 사람별 · 내가 지시한 업무 · 지연 · 이번 주 · 검토 대기. 사람 칩은 본사 사람(없으면 앞쪽 5명)
  const hqIds = new Set(dir.orgUnits.filter((o) => o.type === 'hq').map((o) => o.id));
  const people = (() => {
    const hq = dir.users.filter((u) => u.org_unit_ids?.some((id) => hqIds.has(id)));
    return (hq.length ? hq : dir.users).slice(0, 5);
  })();
  const views: [string, string][] = [['', '전체'], ['my', '내 업무'], ['requested', '내가 지시한 업무'], ['overdue', '지연'], ['week', '이번 주'], ['review', '검토 대기'], ['done', '완료']];
  const teamList = useApi<{ teams: { id: string; name: string }[] }>('/api/teams'); // V14 8번 팀 필터
  // V14 12번 다중 선택
  const [selOn, setSelOn] = useState(false);
  const [selTip, setSelTip] = useState(false);
  useEffect(() => { try { setSelTip(localStorage.getItem('wos_sel_tip') !== '1'); } catch {} }, []);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const lastPick = useRef<string | null>(null);
  const selCtx = useMemo<Sel>(() => ({
    on: selOn, sel,
    toggle: (id, range) => setSel((cur) => {
      const n = new Set(cur);
      if (range && lastPick.current) { // 화면에 보이는 순서로 범위 선택
        const ids = Array.from(document.querySelectorAll<HTMLElement>('[data-row]')).map((e) => e.dataset.row!);
        const [a, b] = [ids.indexOf(lastPick.current), ids.indexOf(id)].sort((x, y) => x - y);
        if (a >= 0 && b >= 0) for (const x of ids.slice(a, b + 1)) n.add(x);
      } else if (n.has(id)) n.delete(id); else n.add(id);
      lastPick.current = id;
      return n;
    }),
    enter: (id) => { cancelDrag(); setSelOn(true); setSel(new Set([id])); lastPick.current = id; },
  }), [selOn, sel]);
  const exitSel = () => { cancelDrag(); setSelOn(false); setSel(new Set()); };
  // 대표 신고: 켜진 보기 칩(완료·내 업무·지연·이번 주…)을 다시 누르면 해제 → 전체
  const setView = (v: string) => setFilters((f) => ({ ...f, view: v && (f.view ?? '') === v && !f.assigneeId ? '' : v, assigneeId: '' }));
  const [filterOpen, setFilterOpen] = useState(false);
  const unitName = (id: string) => dir.orgUnits.find((o) => o.id === id)?.name ?? '';
  const chips: [string, string][] = [
    ...(filters.brandId ? [['brandId', `브랜드: ${dir.brands.find((b) => b.id === filters.brandId)?.name ?? filters.brandId}`]] : []),
    ...(filters.orgUnitId ? [['orgUnitId', `소속: ${unitName(filters.orgUnitId)}`]] : []),
    ...(filters.assigneeId ? [['assigneeId', `담당: ${dir.users.find((u) => u.id === filters.assigneeId)?.name ?? ''}`]] : []),
    ...(filters.teamId ? [['teamId', `팀: ${teamList.data?.teams.find((t) => t.id === filters.teamId)?.name ?? ''}`]] : []),
    ...(filters.status ? [['status', `상태: ${filters.status.split(',').map((x) => STATUS_LABEL[x as TaskStatus] ?? x).join('·')}`]] : []),
    ...(filters.carried ? [['carried', '이월만']] : []),
    ...(filters.from || filters.to ? [['period', `기간: ${filters.from ? fmtDate(filters.from) : '처음'} ~ ${filters.to ? fmtDate(filters.to) : '끝'}`]] : []),
  ] as [string, string][];
  const clearChip = (k: string) => setFilters((f) => (k === 'period' ? { ...f, from: '', to: '' } : { ...f, [k]: '' }));
  const MODES: [ViewMode, string, typeof LayoutList][] = [['list', '목록', LayoutList], ['board', '보드', KanbanSquare], ['calendar', '캘린더', CalIcon], ['timeline', '타임라인', GanttChart]];

  return (
    <OpenTaskCtx.Provider value={openTask}>
    {/* V12 4번: 넓은 화면에서는 패널만큼 목록을 좁혀 칩·마감 열이 가려지지 않게 */}
    <div className={cx('space-y-3', panelId && 'xl:pr-[560px]')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold tracking-tight">{title ?? '업무'}</h1>
        {sess.tenant?.inquiries && !fixed?.view && <PhoneInquiryButton className="ml-auto" />}
        <div className="flex rounded-input border border-line bg-white p-0.5 text-sm shadow-card" role="tablist" aria-label="보기 방식">
          {MODES.map(([m, l, I]) => (
            <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
              className={cx('inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium', mode === m ? 'bg-brand-600 text-white shadow-card' : 'text-ink-2 hover:bg-slate-100')}>
              <I className="size-4" aria-hidden /><span className={cx(mode !== m && 'hidden sm:inline')}>{l}</span>
            </button>
          ))}
        </div>
      </div>
      {!fixed?.view && (
        // V14 42번: 보기 칩 7개는 휴대폰에서도 스크롤 없이 한눈에(4칸 격자 2줄, PC 는 한 줄) + 건수, 사람 칩은 둘째 줄 가로 스크롤
        <div className="space-y-1.5 text-sm" data-testid="view-chips">
        <div className="grid grid-cols-4 gap-1.5 sm:flex sm:flex-wrap sm:items-center">
          {views.filter(([v]) => v !== 'done').map(([v, l]) => {
            const n = counts.data?.counts?.[v] ?? 0;
            return (
              <ViewChip key={v} on={(filters.view ?? '') === v && !filters.assigneeId} onClick={() => setView(v)} label={l} grid>
                {(v === 'overdue' || v === 'review') && n > 0 && <span className={cx('size-1.5 shrink-0 rounded-full', v === 'overdue' ? 'bg-red-500' : 'bg-amber-500')} aria-hidden />}
                <span className="truncate">{v === 'requested' ? <><span className="sm:hidden">내가 지시</span><span className="hidden sm:inline">{l}</span></> : l}</span>
                {n > 0 && <span className={cx('absolute -right-1 -top-1.5 min-w-[18px] rounded-full border px-1 text-center text-[10px] font-bold leading-4 tabular-nums sm:static sm:min-w-0 sm:border-0 sm:bg-transparent sm:px-0 sm:text-[11px] sm:font-semibold sm:opacity-80', (filters.view ?? '') === v && !filters.assigneeId ? 'border-white bg-brand-700 text-white' : v === 'overdue' ? 'border-red-200 bg-red-50 text-red-700 sm:text-inherit' : 'border-line bg-white text-ink-2')} data-count={v}>{n}</span>}
              </ViewChip>
            );
          })}
          {/* V11 2번: "완료" 칩 — 다시 누르면 해제 */}
          <span className="contents sm:block" data-testid="done-chip"><ViewChip on={filters.view === 'done' && !filters.assigneeId} onClick={() => setView("done")} label="완료" grid><CircleCheck className="size-3.5 shrink-0" />완료</ViewChip></span>
          {!views.some(([v]) => v === (filters.view ?? '')) && <ViewChip on onClick={() => setView('')} grid>{({ today: '오늘 할 일', risk: '마감 위험' } as Record<string, string>)[filters.view ?? ''] ?? filters.view}</ViewChip>}
        </div>
        {people.length > 0 && (
          <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 pb-0.5 sm:mx-0 sm:px-0" data-testid="people-chips" aria-label="사람별 업무">
            {people.map((u) => (
              <ViewChip key={u.id} on={filters.assigneeId === u.id} onClick={() => setFilters((f) => ({ ...f, view: '', assigneeId: f.assigneeId === u.id ? '' : u.id }))} label={`${u.name} 업무`}>
                <Avatar id={u.id} name={u.name} size={18} badge={false} />{u.name}
              </ViewChip>
            ))}
          </div>
        )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={openAdd} data-testid="add-task-top"><Plus />업무 추가</Button>
        {/* 휴대폰 키보드: 누른 그 순간(클릭 처리 안)에 입력칸에 초점이 가야 WebView 가 키보드를 띄운다 → 임시 칸에 먼저 초점, 시트가 열리면 제목 칸으로 넘김 */}
        <input ref={kbProxy} aria-hidden tabIndex={-1} className="pointer-events-none fixed left-0 top-0 h-0 w-0 opacity-0" />
        <div className="relative min-w-[160px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
          <input className={cx(inputCls, 'h-9 pl-8')} placeholder="제목·설명·태그 검색" value={q} onChange={(e) => setQ(e.target.value)} aria-label="업무 검색" />
        </div>
        <div className="relative">
          <Button variant="secondary" onClick={() => setMoreMenu(!moreMenu)} aria-expanded={moreMenu} aria-label="업무 더보기 메뉴" data-testid="tasks-more"><MoreHorizontal /></Button>
          {moreMenu && (
            // V7 3번: 휴대폰은 아래에서 올라오는 시트(잘리지 않게), PC 는 버튼 아래 — 화면 오른쪽을 넘으면 오른쪽 맞춤(가장자리 8px)
            <>
              <div className="fixed inset-0 z-40 bg-slate-900/30 sm:z-30 sm:bg-transparent" onClick={() => setMoreMenu(false)} />
              <div role="menu" aria-label="업무 더보기" ref={(el) => {
                if (!el || window.innerWidth < 640) return;
                const r = el.getBoundingClientRect();
                if (r.right > window.innerWidth - 8) { el.style.left = 'auto'; el.style.right = '0'; }
              }}
                className="fixed inset-x-0 bottom-0 z-50 animate-fade-up rounded-t-2xl border-t border-line bg-white p-2 pb-[calc(var(--sab)+12px)] shadow-pop sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-0 sm:z-40 sm:mt-1 sm:w-60 sm:rounded-card sm:border sm:p-1 sm:pb-1">
                <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-slate-200 sm:hidden" aria-hidden />
                <button role="menuitem" className="flex min-h-11 w-full items-center gap-2 rounded-input px-3 text-left text-sm hover:bg-slate-50" onClick={() => { setMoreMenu(false); setExportOpen(true); }}><FileSpreadsheet className="size-4 text-green-700" />엑셀로 내려받기</button>
                <Link role="menuitem" href="/tasks/trash" className="flex min-h-11 w-full items-center gap-2 rounded-input px-3 text-sm hover:bg-slate-50" onClick={() => setMoreMenu(false)}><Trash2 className="size-4 text-ink-2" />휴지통 (30일 복원)</Link>
              </div>
            </>
          )}
        </div>
        {(mode === 'list' || mode === 'board') && <Button variant={selOn ? 'primary' : 'secondary'} onClick={() => (selOn ? exitSel() : setSelOn(true))} aria-pressed={selOn} data-testid="select-mode">{selOn ? '선택 끝내기' : '선택'}</Button>}
        <Button variant="secondary" onClick={() => setFilterOpen(!filterOpen)} aria-expanded={filterOpen} data-testid="filter-toggle">
          <SlidersHorizontal />필터{chips.length > 0 && <span className="rounded-full bg-brand-600 px-1.5 text-[11px] leading-4 text-white">{chips.length}</span>}
          <ChevronDown className={cx('!size-3.5 transition-transform', filterOpen && 'rotate-180')} />
        </Button>
        {mode === 'list' && !projectId && (
          <label className="inline-flex h-9 items-center gap-1.5 text-sm text-ink-2">묶기
            <select className="h-9 rounded-input border border-line bg-white px-2 text-sm" value={group} onChange={(e) => pickGroup(e.target.value as GroupBy)} aria-label="묶기 기준" data-testid="group-by">
              <option value="assignee">담당자별</option><option value="requester">지시자별</option><option value="due">마감일</option><option value="project">프로젝트</option><option value="status">상태별</option><option value="team">팀별</option><option value="none">묶지 않음</option>
            </select>
          </label>
        )}
        {mode === 'list' && (
          <label className="inline-flex h-9 items-center gap-1.5 text-sm text-ink-2">정렬
            <select className="h-9 rounded-input border border-line bg-white px-2 text-sm" value={sortBy} onChange={(e) => pickSort(e.target.value as SortKey)} aria-label="정렬" data-testid="sort-by">
              {SORTS.map((k) => <option key={k} value={k}>{SORT_LABEL[k]}</option>)}
            </select>
          </label>
        )}
        {chips.map(([k, l]) => (
          <span key={k} className="inline-flex h-7 items-center gap-1 rounded-full bg-brand-50 pl-2.5 pr-1 text-xs font-medium text-brand-700" data-testid="filter-chip">
            {l}<button onClick={() => clearChip(k)} className="rounded-full p-0.5 hover:bg-brand-100" aria-label={`${l} 필터 해제`}><X className="size-3" /></button>
          </span>
        ))}
        {chips.length > 1 && <button className="text-xs font-medium text-ink-2 underline" onClick={() => setFilters((f) => ({ view: f.view ?? '' }))}>모두 지우기</button>}
      </div>
      {filterOpen && (
        <div className="grid animate-fade-up grid-cols-2 gap-2 rounded-card border border-line bg-white p-3 shadow-card sm:grid-cols-3 xl:grid-cols-6" data-testid="filter-panel">
          <select className={inputCls} value={filters.brandId ?? ''} onChange={(e) => setFilters((f) => ({ ...f, brandId: e.target.value }))} aria-label="브랜드">
            <option value="">모든 브랜드</option>{dir.brands.filter((b) => !HIDDEN_BRANDS.includes(b.id)).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <UnitSelect value={filters.orgUnitId ?? ''} onChange={(v) => setFilters((f) => ({ ...f, orgUnitId: v }))} allowEmpty="모든 현장·부서" />
          <select className={inputCls} value={filters.assigneeId ?? ''} onChange={(e) => setFilters((f) => ({ ...f, assigneeId: e.target.value }))} aria-label="담당자">
            <option value="">모든 담당자</option>{dir.users.map((u) => <option key={u.id} value={u.id}>{u.name}{u.title ? ` · ${u.title}` : ''}</option>)}
          </select>
          <select className={inputCls} value={filters.teamId ?? ''} onChange={(e) => setFilters((f) => ({ ...f, teamId: e.target.value }))} aria-label="팀">
            <option value="">모든 팀</option>{(teamList.data?.teams ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select className={inputCls} value={filters.status ?? ''} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} aria-label="상태">
            <option value="">모든 상태</option>{STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
          <input type="date" className={inputCls} value={filters.from ?? ''} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} aria-label="기간 시작" />
          <input type="date" className={inputCls} value={filters.to ?? ''} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} aria-label="기간 끝" />
          {/* V20 이월만 보기 (담당자 묶음 안에서도) */}
          <label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-input border border-line px-3 text-sm"><input type="checkbox" checked={filters.carried === '1'} onChange={(e) => setFilters((f) => ({ ...f, carried: e.target.checked ? '1' : '' }))} data-testid="filter-carried" />이월만 보기</label>
        </div>
      )}
      {justDone.length > 0 && !showDone && (
        <div className="rounded-card border border-green-200 bg-green-50 text-sm" data-testid="just-done">
          <button onClick={() => setJustOpen(!justOpen)} aria-expanded={justOpen} className="flex w-full items-center gap-2 px-3 py-2 text-left font-medium text-green-800">
            <CircleCheck className="size-4" />방금 완료한 업무 {justDone.length}건<span className="ml-auto text-xs font-normal">{justOpen ? '접기' : '보기 · 되돌리기'}</span>
          </button>
          {justOpen && (
            <ul className="divide-y divide-green-100 border-t border-green-200">
              {justDone.map(({ t, prev }) => (
                <li key={t.id} className="flex items-center gap-2 px-3 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-ink-2 line-through">{t.title}</span>
                  <Button size="sm" variant="secondary" onClick={async () => { if (await patch({ ...t, status: 'done', version: t.version + 1 }, { status: prev === 'done' ? 'in_progress' : prev })) { setJustDone((x) => x.filter((y) => y.t.id !== t.id)); reload(); } }}>되돌리기</Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {error ? <ErrorBox error={error} retry={reload} /> : loading && !data ? <Skeleton /> : (
        <>
          {mode === 'list' && projectId && adding && <div className="overflow-hidden rounded-card border border-line bg-white shadow-card"><InlineAddTask autoFocus projectId={projectId} onEscape={() => setAdding(false)} /></div>}
          {selOn && <BulkBar ids={[...sel]} tasks={tasks} onClear={exitSel} onDone={(action, done) => {
            // V14 40번: 완료·삭제 뒤에는 선택 모드를 끝내고(남아 있으면 다음 터치가 "선택"으로 먹힘), 지운 업무의 상세 패널은 닫는다
            if (action === 'patch') setSel(new Set()); else exitSel();
            if (action === 'delete' && panelId && done.includes(panelId)) closePanel();
            reload(); broadcastRefresh();
          }} />}
          <SelectCtx.Provider value={mode === 'list' || mode === 'board' ? selCtx : null}>
          {mode === 'list' && (projectId ? <SectionedList projectId={projectId} sections={sections} tasks={tasks} onPatch={patch} reloadSections={sectionsApi.reload} reloadTasks={reload} />
            : curView === 'done' ? <DoneArchive thisMonth={tasks} filterQs={new URLSearchParams(Object.entries({ assigneeId: filters.assigneeId, teamId: filters.teamId, projectId: fixed?.projectId }).filter(([, v]) => v) as [string, string][]).toString()} onPatch={patch} />
            : <GroupedTasks tasks={tasks} group={group} view={curView} keepIds={keepIds} assigneeFilter={filters.assigneeId || null} onPatch={patch} onAcked={reload}
                people={people} sortBy={sortBy} onSort={pickSort} onReorder={reorder}
                top={adding ? <InlineAddTask key={addKey} autoFocus defaultAssignee={filters.assigneeId || undefined} onEscape={() => setAdding(false)} placeholder="업무 이름 입력 후 Enter — 저장하고 다음 줄, Esc 로 끝내기" /> : null} />)}
          {mode === 'board' && projectId && (
            <div className="flex items-center gap-2 text-sm text-ink-2">열 기준
              <select className="h-8 rounded-input border border-line bg-white px-2 text-sm" value={boardBy} onChange={(e) => setBoardBy(e.target.value as any)} aria-label="보드 열 기준">
                <option value="status">상태</option><option value="section">섹션</option>
              </select>
            </div>
          )}
          {mode === 'board' && (boardBy === 'section' && projectId ? <SectionBoard sections={sections} tasks={tasks} onPatch={patch} /> : <BoardView tasks={tasks} onPatch={patch} />)}
          </SelectCtx.Provider>
          {/* V14 20번: 처음 쓰는 사람에게 "선택" 안내 (목록 아래 — 늦게 떠도 행이 밀리지 않게) */}
          {!selOn && selTip && (mode === 'list' || mode === 'board') && (
            <p className="mt-2 flex items-center gap-2 rounded-input border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-800" data-testid="select-tip">
              <span className="flex-1">여러 업무를 한 번에 옮기거나 지우려면 위의 <b>선택</b>을 누르세요. PC 는 행에 마우스를 올리면 체크칸, 휴대폰은 행을 길게 누르면 선택됩니다.</span>
              <button className="shrink-0 text-xs underline" onClick={() => { setSelTip(false); try { localStorage.setItem('wos_sel_tip', '1'); } catch {} }}>알겠어요</button>
            </p>
          )}

          {mode === 'calendar' && <CalendarView tasks={tasks} onPatch={patch} />}
          {mode === 'timeline' && <TimelineView tasks={tasks} onPatch={patch} />}
        </>
      )}
    </div>
    {exportOpen && <ExportTasks qs={qs} onClose={() => setExportOpen(false)} />}
    <QuickAddTask open={quickOpen} onClose={() => setQuickOpen(false)} defaults={{ projectId, assigneeId: filters.assigneeId || undefined }} onCreated={() => { setQuickOpen(false); reload(); }} />
    {panelId && (
      <aside className="fixed inset-0 z-40 animate-slide-in overflow-y-auto bg-white shadow-pop sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[min(560px,100vw-240px)] sm:border-l sm:border-line" data-testid="task-panel" aria-label="업무 상세 패널">
        <TaskDetail key={panelId} id={panelId} inPanel onClose={closePanel} />
      </aside>
    )}
    </OpenTaskCtx.Provider>
  );
}

function snake(b: Record<string, unknown>) {
  const m: Record<string, string> = { dueDate: 'due_date', startDate: 'start_date', assigneeId: 'assignee_id', sectionId: 'section_id', sortOrder: 'sort_order' };
  return Object.fromEntries(Object.entries(b).map(([k, v]) => [m[k] ?? k, v]));
}

function Meta({ t, compact, onPatch }: { t: Task; compact?: boolean; onPatch?: (t: Task, b: any) => any }) {
  const { dir } = useSession();
  const hq = dir.orgUnits.find((o) => o.id === t.org_unit_id)?.type === 'hq';
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-ink-2">
      {/* V11 1번: 휴대폰은 제목 아래 줄에 상태 칩(누르면 바로 변경) — PC 는 상태 열 */}
      {onPatch && <span className="sm:hidden"><StatusChip t={t} onPatch={onPatch} /></span>}
      {t.team_name && <span className="inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 text-[11px] font-medium" style={{ background: `${t.team_color ?? '#0F766E'}1a`, color: t.team_color ?? '#0F766E' }} data-testid="team-chip">{t.team_name}</span>}
      {t.project_name && <span className="inline-flex min-w-0 items-center gap-1"><span className="size-2 shrink-0 rounded-[3px]" style={{ background: t.project_color ?? '#999' }} /><span className="truncate">{t.project_name}</span></span>}
      {t.requested_by && t.requested_by !== t.assignee_id && t.requested_by_name && <span className="truncate md:hidden" title="지시자 → 담당자">{t.requested_by_name} → {t.assignee_name ?? '미배정'}</span>}
      {!compact && <span className={cx('truncate', onPatch && hq && 'hidden sm:inline')}>{t.org_unit_name}</span>}
      {!compact && <BrandDot brand={t.brand_id} />}
      {t.subtask_count > 0 && <span className="inline-flex items-center gap-0.5 tabular-nums" title="하위 업무"><ListChecks className="size-3.5" />{t.subtask_done}/{t.subtask_count}</span>}
      {t.checklist_total > 0 && <span className="inline-flex items-center gap-0.5 tabular-nums" title="체크리스트"><CheckCheck className="size-3.5" />{t.checklist_done}/{t.checklist_total}</span>}
      {t.comment_count > 0 && <span className="inline-flex items-center gap-0.5 tabular-nums" title="댓글"><MessageSquare className="size-3.5" />{t.comment_count}</span>}
      {t.attachment_count > 0 && <span className="inline-flex items-center gap-0.5 tabular-nums" title="첨부"><Paperclip className="size-3.5" />{t.attachment_count}</span>}
      {!!t.photo_required && <span className={cx('inline-flex items-center gap-0.5 tabular-nums', (t.photo_count ?? 0) >= t.photo_required ? 'text-green-600' : 'text-amber-700')} title="완료 증빙 사진"><Camera className="size-3.5" />{t.photo_count ?? 0}/{t.photo_required}</span>}
      {t.recurrence_rule && <span title="반복 업무"><Repeat className="size-3.5" /></span>}
      {t.batch && t.batch.total > 1 && <span className="rounded-full bg-violet-50 px-1.5 text-[11px] font-medium text-violet-700" title="담당자별로 같이 만든 업무 — 완료/전체" data-batch>일괄 {t.batch.total}건 · {t.batch.done}/{t.batch.total}</span>}
      {t.blocked_by_count > 0 && <span className="font-medium text-amber-700">선행 대기 {t.blocked_by_count}</span>}
    </span>
  );
}

/** V14 50(대표 결정): 상태는 담당자만(없으면 지시자·만든 사람). 검토 중인 업무의 승인·반려는 검토 담당자(지시자)만 — 서버와 같은 규칙 */
export function canSetStatus(t: Task, uid: string, to: TaskStatus) {
  if (to === t.status) return true;
  const reviewer = t.requested_by && t.requested_by !== t.assignee_id ? t.requested_by : null;
  if (t.status === 'review' && reviewer) return reviewer === uid && (to === 'done' || to === 'in_progress');
  return (t.assignee_id ?? t.requested_by ?? t.created_by) === uid;
}
const NOT_MINE = '상태는 담당자만 바꿀 수 있어요 (검토 중인 업무는 검토 담당자만 승인·반려)';
/** 진행 전 업무는 담당자 확인 여부를 뒤에 — V14 43번: "확인 완료"가 "완료"와 헷갈려 "진행 전 · 확인함/확인 전" */
export function statusText(t: Task) {
  if (t.status === 'todo' && t.assignee_id) return `진행 전 · ${t.assignee_ack_at ? '확인함' : '확인 전'}`;
  return STATUS_LABEL[t.status];
}
/** 원형 완료 체크: 결재선·관리자 확인 업무는 "검토 요청", 아니면 완료. 완료 상태에서 누르면 다시 진행 중 */
function nextStatusOnCheck(t: Task, role: string): TaskStatus {
  if (t.status === 'done') return 'in_progress';
  if (t.status === 'review') return 'done';
  if (t.approval_line_id) return 'review';
  if (t.approval_required && role === 'staff') return 'review';
  return 'done';
}
function TypeIcon({ t }: { t: Task }) {
  if (t.task_type === 'milestone') return <span title="마일스톤"><Diamond className="size-3.5 shrink-0 fill-violet-500 text-violet-500" /></span>;
  if (t.task_type === 'approval') return <span title="결재 업무"><Stamp className="size-3.5 shrink-0 text-amber-600" /></span>;
  if (t.task_type === 'inspection') return <span title="점검 업무"><Camera className="size-3.5 shrink-0 text-sky-600" /></span>;
  return null;
}
/** V14 43번 상태 칩 색: 진행 전 회색·진행 중 파랑·검토 요청 주황·보류 노랑·완료 초록 */
const CHIP_TONE: Record<TaskStatus, string> = {
  todo: 'border-slate-300 bg-white text-slate-700', in_progress: 'border-blue-300 bg-blue-50 text-blue-700', review: 'border-orange-300 bg-orange-50 text-orange-700',
  on_hold: 'border-yellow-300 bg-yellow-50 text-yellow-800', done: 'border-green-300 bg-green-50 text-green-700',
};
const CHIP_DOT: Record<TaskStatus, string> = { todo: 'bg-slate-400', in_progress: 'bg-blue-500', review: 'bg-orange-500', on_hold: 'bg-yellow-500', done: 'bg-green-500' };
let tipClaimed = false; // 한 화면에 말풍선은 하나만
/**
 * V11 1번·V14 43번: 상태 칩 = 누르는 버튼(테두리 알약 + ▾, 터치 44px, 눌림 효과) — 누르면 메뉴 맨 위 [✓ 완료](결재가 필요하면 [검토 요청]) 다음 나머지 상태.
 * 바꿀 수 없는 사람에게는 ▾ 없는 평평한 표시 + 자물쇠(누르면 이유 안내). 처음 3번은 "눌러서 상태 바꾸기" 말풍선(칩 오른쪽 — 제목을 가리지 않게).
 */
function StatusChip({ t, onPatch }: { t: Task; onPatch: (t: Task, b: any) => any }) {
  const { user } = useSession();
  const [open, setOpen] = useState(false);
  const [tip, setTip] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const quick = nextStatusOnCheck(t, user.role); // 완료(또는 검토 요청, 완료 상태면 다시 진행 중)
  const can = STATUSES.some((s) => s !== t.status && canSetStatus(t, user.id, s));
  const ack = t.status === 'todo' && t.assignee_id ? (t.assignee_ack_at ? '확인함' : '확인 전') : null;
  useEffect(() => {
    if (!can || tipClaimed) return;
    try { const n = Number(localStorage.getItem('wos_status_tip') ?? 0); if (n < 3) { tipClaimed = true; setTip(true); localStorage.setItem('wos_status_tip', String(n + 1)); } } catch {}
    return () => { tipClaimed = false; };
  }, [can]);
  async function go(s: TaskStatus) {
    setOpen(false); setTip(false);
    if (s === t.status) return;
    const before = t.status;
    const ok = await onPatch(t, { status: s });
    if (ok !== false && (s === quick || s === 'done')) toast.ok(s === 'done' ? '완료했습니다' : s === 'review' ? '검토를 요청했습니다' : '다시 진행 중으로 바꿨습니다', { label: '되돌리기', run: () => onPatch({ ...t, status: s, version: t.version + 1 }, { status: before }) });
  }
  const sub = ack && <span className={cx('text-[10.5px] font-normal', ack === '확인 전' ? 'text-red-600' : 'text-ink-3')}>· {ack}</span>;
  if (!can) return (
    <span role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); toast.info(NOT_MINE); }} onPointerDown={(e) => e.stopPropagation()} aria-label={`${t.title} 상태: ${statusText(t)} (담당자만 변경)`} data-testid="row-status-locked"
      className="inline-flex h-8 min-w-0 items-center gap-1 whitespace-nowrap px-1 text-[12px] font-medium text-ink-2">
      <span className={cx('size-1.5 shrink-0 rounded-full', CHIP_DOT[t.status])} aria-hidden />{STATUS_LABEL[t.status]}{sub}<Lock className="size-3 shrink-0 text-ink-3" aria-hidden />
    </span>
  );
  return (
    <span className="relative inline-flex min-w-0">
      <button ref={ref} type="button" onClick={(e) => { e.stopPropagation(); setTip(false); setOpen(true); }} onPointerDown={(e) => e.stopPropagation()} aria-haspopup="dialog" aria-label={`${t.title} 상태: ${statusText(t)}`} data-testid="row-status-chip"
        className={cx('hit inline-flex h-8 min-w-0 items-center gap-1 whitespace-nowrap rounded-full border pl-2 pr-1.5 text-[12px] font-semibold shadow-sm transition active:scale-95 active:shadow-none', CHIP_TONE[t.status])}>
        <span className={cx('size-1.5 shrink-0 rounded-full', ack === '확인 전' ? 'bg-red-500' : CHIP_DOT[t.status])} aria-hidden />{STATUS_LABEL[t.status]}{sub}<ChevronDown className="size-3.5 shrink-0 opacity-70" aria-hidden />
      </button>
      {tip && <span className="pointer-events-none absolute left-full top-1/2 z-10 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-[11px] text-white shadow-pop after:absolute after:right-full after:top-1/2 after:-translate-y-1/2 after:border-4 after:border-transparent after:border-r-ink" data-testid="status-tip">눌러서 상태 바꾸기</span>}
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref} title="상태 바꾸기" width={200}>
        {canSetStatus(t, user.id, quick) && quick !== t.status && (
          <button type="button" onClick={() => go(quick)} data-testid="status-quick"
            className="mb-1 flex w-full items-center gap-2 rounded-input bg-green-50 px-2.5 py-2 text-left text-sm font-bold text-green-800 hover:bg-green-100">
            <Check className="size-4" />{quick === 'done' ? '완료' : quick === 'review' ? '검토 요청' : '다시 진행 중'}
          </button>
        )}
        {(['in_progress', 'todo', 'review', 'on_hold', 'done'] as TaskStatus[]).filter((s) => s !== quick).map((s) => (
          <button key={s} type="button" disabled={!canSetStatus(t, user.id, s)} onClick={() => go(s)} aria-pressed={s === t.status}
            className="flex w-full items-center gap-2 rounded-input px-2.5 py-1.5 text-left text-sm hover:bg-slate-50 disabled:opacity-40">
            <span className={cx('size-2 rounded-full', CHIP_DOT[s])} />{STATUS_LABEL[s]}{s === t.status && <Check className="ml-auto size-3.5 text-accent-600" />}
          </button>
        ))}
      </Popover>
    </span>
  );
}
/** 마감일 칩 + 그 위의 투명 날짜 입력 (눌러서 바로 변경) */
function DueEdit({ t, onPatch }: { t: Task; onPatch: (t: Task, b: any) => void }) {
  return <span className="inline-flex w-[92px] justify-end"><DuePicker value={t.due_date} status={t.status} onChange={(v) => onPatch(t, { dueDate: v })} label={`${t.title} 마감일`} /></span>;
}

type GroupBy = 'assignee' | 'requester' | 'due' | 'project' | 'status' | 'team' | 'none';
const GROUPS: GroupBy[] = ['assignee', 'requester', 'due', 'project', 'status', 'team', 'none'];
type SortKey = 'manual' | 'due' | 'priority' | 'created' | 'title' | 'assignee' | 'requester' | 'status';
const SORTS: SortKey[] = ['manual', 'due', 'priority', 'created', 'title', 'assignee', 'requester', 'status'];
const SORT_LABEL: Record<SortKey, string> = { manual: '직접 순서', due: '마감일순', priority: '우선순위순', created: '최근 생성순', title: '이름순', assignee: '담당자순', requester: '지시자순', status: '상태순' };
const PRI_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
const ko = (a?: string | null, b?: string | null) => (a ?? '\uffff').localeCompare(b ?? '\uffff', 'ko');
/** 마감 일시 오름차순: 기한 지남 → 오늘 → 이후, 시간 없는 마감은 그날 끝, 마감 없는 업무는 맨 아래 */
const dueKey = (t: Task) => (t.due_date ? `${t.due_date} ${t.due_time ?? '24:00'}` : '9999-12-31 99');
const byDue = (x: Task, y: Task) => dueKey(x).localeCompare(dueKey(y));
function sortTasks(ts: Task[], k: SortKey) {
  const cmp: Record<SortKey, (x: Task, y: Task) => number> = {
    manual: (x, y) => (x.sort_order ?? 0) - (y.sort_order ?? 0) || ko(x.created_at, y.created_at),
    due: (x, y) => byDue(x, y) || PRI_RANK[x.priority] - PRI_RANK[y.priority],
    priority: (x, y) => PRI_RANK[x.priority] - PRI_RANK[y.priority] || byDue(x, y),
    created: (x, y) => (y.created_at ?? '').localeCompare(x.created_at ?? ''),
    title: (x, y) => ko(x.title, y.title),
    assignee: (x, y) => ko(x.assignee_name, y.assignee_name) || byDue(x, y),
    requester: (x, y) => ko(x.requested_by_name, y.requested_by_name) || byDue(x, y),
    status: (x, y) => STATUSES.indexOf(x.status) - STATUSES.indexOf(y.status) || byDue(x, y),
  };
  return [...ts].sort(cmp[k]);
}

/** PC 열 머리: 누르면 그 기준으로 정렬 */
function ListHeader({ sortBy, onSort, compact }: { sortBy: SortKey; onSort: (k: SortKey) => void; compact?: boolean }) {
  // V14 48: 맨 위 줄은 스크롤해도 붙어 있고(정렬 버튼), 묶음마다 같은 열 제목을 작은 회색 글씨로(정렬 화살표 없음)
  const H = ({ k, children, className }: { k: SortKey; children: React.ReactNode; className?: string }) => compact
    ? <span className={cx('truncate text-left', className)}>{children}</span>
    : (
    <button type="button" onClick={() => onSort(sortBy === k ? 'due' : k)} aria-pressed={sortBy === k}
      className={cx('truncate text-left hover:text-ink', sortBy === k ? 'font-semibold text-accent-600' : '', className)}>{children}{sortBy === k ? ' ↓' : ''}</button>
  );
  return (
    <div className={cx('hidden items-center gap-3 px-3 sm:flex', compact ? 'pb-0.5 text-[11px] text-ink-3/80' : 'sticky top-14 z-20 -mx-1 border-b border-line bg-canvas px-4 py-1.5 text-xs text-ink-3')}
      data-testid={compact ? 'group-col-header' : 'list-header'} aria-hidden={compact || undefined}>
      <span className="w-4" /><span className="w-[22px]" />
      <H k="title" className="flex-1">업무 이름</H>
      <H k="requester" className="hidden w-[104px] md:block">지시자</H>
      <H k="priority" className="w-[60px] text-right">우선순위</H>
      <H k="status" className="w-[84px] pl-2">상태</H>
      <H k="due" className="w-[92px] text-right">마감일</H>
      <H k="assignee" className="w-12 text-right">담당자</H>
    </div>
  );
}
/** 마감 묶음 끝 "업무 추가" 줄의 기본 마감일 */
const DUE_DEFAULT: Record<string, () => string | null> = {
  over: () => todayStr(), today: () => todayStr(), tomorrow: () => quickDues()[1][1], week: () => quickDues()[2][1], next: () => quickDues()[3][1], later: () => null, none: () => null, new: () => null,
};
function ViewChip({ on, onClick, children, label, grid }: { on: boolean; onClick: () => void; children: React.ReactNode; label?: string; grid?: boolean }) {
  return (
    <button onClick={onClick} aria-pressed={on} aria-label={label}
      className={cx('inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 font-medium transition-colors', grid && 'relative min-w-0 justify-center gap-1 px-1.5 text-[13px] sm:justify-start sm:gap-1.5 sm:px-3 sm:text-sm', on ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-white text-ink-2 hover:border-slate-300')}>{children}</button>
  );
}

/**
 * 업무 화면 목록 (Asana "팀 작업"): 담당자별(기본)·지시자별·마감일·프로젝트로 묶고, 묶음마다 끝에 "업무 추가" 줄 — 그 묶음 값이 자동으로 들어간다.
 * 담당자별은 본사 사람 전원을 업무 0건이어도 묶음으로 보여 준다(바로 그 사람에게 배정).
 * 직접 순서일 때는 손잡이로 끌어 순서를 바꾸고, 다른 묶음으로 끌면 그 묶음 값(담당자·지시자·마감·프로젝트)으로 바뀐다.
 */
function GroupedTasks({ tasks, group, view, assigneeFilter, onPatch, onAcked, top, people, sortBy, onSort, onReorder, keepIds }: {
  tasks: Task[]; group: GroupBy | 'month'; view: string; keepIds?: Set<string>; assigneeFilter: string | null; onPatch: (t: Task, b: any) => any; onAcked: () => void; top: React.ReactNode;
  people: { id: string; name: string }[]; sortBy: SortKey; onSort: (k: SortKey) => void; onReorder: (ids: string[]) => void;
}) {
  const { user, dir } = useSession();
  const [folded, setFolded] = useState<Record<string, boolean>>({});
  // "오늘 완료 n건" 접힘 줄 펼침 상태(이 기기에 기억)
  const [doneOpen, setDoneOpen] = useState(false);
  useEffect(() => { try { setDoneOpen(localStorage.getItem('wos_done_fold') === '1'); } catch {} }, []);
  const toggleDone = () => setDoneOpen((v) => { try { localStorage.setItem('wos_done_fold', v ? '0' : '1'); } catch {} return !v; });
  // PC: 손잡이를 마우스로 끌기 · 휴대폰: 행을 0.4초 꾹 누르면 들어 올려 위아래로
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 400, tolerance: 8 } }));
  const selOnCtx = !!useContext(SelectCtx)?.on; // V14 40번: 선택 모드·순서를 바꿀 수 없는 정렬에서는 끌기 꺼짐 — 꾹 누르면 행이 들려 옆 행이 눌리던 문제
  if (group === 'due' && view === 'my') return <MyGroupedList tasks={tasks} onPatch={onPatch} onAcked={onAcked} top={top} />;
  const today = todayStr();
  const nameOf = (id: string) => dir.users.find((u) => u.id === id)?.name ?? null;
  type G = { key: string; label: string; head?: React.ReactNode; items: Task[]; add: { defaultAssignee?: string | null; defaultRequester?: string | null; defaultDue?: string | null; projectId?: string | null }; tone?: string };
  let groups: G[] = [];
  if (group === 'assignee' || group === 'requester') {
    const isReq = group === 'requester';
    const m = new Map<string, G>();
    const ensure = (id: string | null, name: string | null) => {
      const k = id ?? 'none';
      if (!m.has(k)) {
        const nm = id ? (name ?? nameOf(id) ?? '알 수 없음') : isReq ? '지시자 없음' : '담당자 없음';
        m.set(k, { key: k, label: nm, head: <Avatar id={id} name={id ? nm : null} size={24} />, items: [], add: isReq ? { defaultRequester: id } : { defaultAssignee: id } });
      }
      return m.get(k)!;
    };
    // 본사 사람 전원(업무 0건이어도) → 나 먼저. 사람 필터가 있으면 그 사람만
    if (!isReq && assigneeFilter) ensure(assigneeFilter, null);
    else { ensure(user.id, user.name); for (const p of people) ensure(p.id, p.name); }
    for (const t of tasks) (isReq ? ensure(t.requested_by ?? null, t.requested_by_name ?? null) : ensure(t.assignee_id, t.assignee_name)).items.push(t);
    groups = [...m.values()].sort((a, b) => (a.key === user.id ? -1 : b.key === user.id ? 1 : a.key === 'none' ? 1 : b.key === 'none' ? -1 : a.label.localeCompare(b.label, 'ko')));
  } else if (group === 'due') {
    const d = new Date(today + 'T00:00:00Z');
    const weekEnd = new Date(d.getTime() + (6 - ((d.getUTCDay() + 6) % 7)) * 86400000).toISOString().slice(0, 10);
    const nextEnd = new Date(new Date(weekEnd + 'T00:00:00Z').getTime() + 7 * 86400000).toISOString().slice(0, 10);
    const tomorrow = new Date(d.getTime() + 86400000).toISOString().slice(0, 10);
    // V14 34번: 마감이 가까운 순 — 기한 지남·오늘·내일·이번 주·다음 주·이후·마감 없음 (묶음 안은 날짜·시각순)
    const defs: [string, string, string?][] = [['over', '기한 지남', 'text-red-600'], ['today', '오늘'], ['tomorrow', '내일'], ['week', '이번 주'], ['next', '다음 주'], ['later', '이후'], ['none', '마감 없음']];
    groups = defs.map(([k, l, tone]) => ({ key: k, label: l, tone, items: [], add: { defaultDue: DUE_DEFAULT[k]() } }));
    const g = (k: string) => groups.find((x) => x.key === k)!.items;
    for (const t of tasks) g(!t.due_date ? 'none' : t.due_date < today ? 'over' : t.due_date === today ? 'today' : t.due_date === tomorrow ? 'tomorrow' : t.due_date <= weekEnd ? 'week' : t.due_date <= nextEnd ? 'next' : 'later').push(t);
    if (sortBy === 'due') for (const x of groups) x.items.sort((a, b) => `${a.due_date ?? '9'}${a.due_time ?? '99'}`.localeCompare(`${b.due_date ?? '9'}${b.due_time ?? '99'}`));
    groups = groups.filter((x) => x.items.length || x.key === 'today');
  } else if (group === 'project') {
    const m = new Map<string, G>();
    for (const t of tasks) {
      const k = t.project_id ?? 'none';
      if (!m.has(k)) m.set(k, { key: k, label: t.project_name ?? '프로젝트 없음', head: <span className="size-2.5 rounded-[3px]" style={{ background: t.project_color ?? '#cbd5e1' }} />, items: [], add: { projectId: t.project_id } });
      m.get(k)!.items.push(t);
    }
    groups = [...m.values()].sort((a, b) => (a.key === 'none' ? 1 : b.key === 'none' ? -1 : a.label.localeCompare(b.label, 'ko')));
    if (!groups.length) groups = [{ key: 'none', label: '프로젝트 없음', items: [], add: {} }];
  } else if (group === 'team') { // V14 8번 팀별 묶기
    const m = new Map<string, G>();
    for (const t of tasks) {
      const k = t.team_id ?? 'none';
      if (!m.has(k)) m.set(k, { key: k, label: t.team_name ?? '팀 없음', head: <span className="size-2.5 rounded-full" style={{ background: t.team_color ?? '#cbd5e1' }} />, items: [], add: {} });
      m.get(k)!.items.push(t);
    }
    groups = [...m.values()].sort((a, b) => (a.key === 'none' ? 1 : b.key === 'none' ? -1 : a.label.localeCompare(b.label, 'ko')));
    if (!groups.length) groups = [{ key: 'none', label: '팀 없음', items: [], add: {} }];
  } else if (group === 'status') {
    // V11 1번: 진행 전 → 진행 중 → 검토 요청 → 보류 (완료는 각 묶음 끝 "오늘 완료" 줄)
    const order: TaskStatus[] = ['todo', 'in_progress', 'review', 'on_hold'];
    groups = order.map((st) => ({ key: st, label: STATUS_LABEL[st], head: <span className={cx('size-2.5 rounded-full', STATUS_TONE[st].dot)} />, items: [], add: {} }));
    if (tasks.some((t) => t.status === 'done')) groups.push({ key: 'done', label: STATUS_LABEL.done, head: <span className={cx('size-2.5 rounded-full', STATUS_TONE.done.dot)} />, items: [], add: {} });
    for (const t of tasks) groups.find((g) => g.key === t.status)?.items.push(t);
  } else if (group === 'month') {
    // V6 5번 완료 보관: 완료일 기준 월별 (최신 달 먼저)
    const m = new Map<string, G>();
    for (const t of tasks) {
      const k = (t.completed_at ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(t.completed_at)) : '0000-00').slice(0, 7);
      if (!m.has(k)) m.set(k, { key: k, label: k === '0000-00' ? '완료일 없음' : `${k.slice(0, 4)}년 ${Number(k.slice(5))}월`, items: [], add: {} });
      m.get(k)!.items.push(t);
    }
    groups = [...m.values()].sort((a, b) => b.key.localeCompare(a.key));
    if (!groups.length) groups = [{ key: 'none', label: '완료한 업무 없음', items: [], add: {} }];
  } else groups = [{ key: 'all', label: '', items: tasks, add: {} }];

  const draggable = sortBy === 'manual' && group !== 'month';
  // 다른 묶음으로 옮길 때 바뀌는 값
  const moveBody = (g: G): Record<string, unknown> | null => {
    if (group === 'assignee') return { assigneeId: g.add.defaultAssignee ?? null };
    if (group === 'requester') return g.add.defaultRequester ? { requestedById: g.add.defaultRequester } : null;
    if (group === 'due') return { dueDate: g.add.defaultDue ?? null };
    if (group === 'project') return { projectId: g.add.projectId ?? null };
    if (group === 'status') return { status: g.key }; // 권한 없으면 아래 end 에서 막음
    return null;
  };
  const end = (e: DragEndEvent) => {
    const a = String(e.active.id), o = e.over ? String(e.over.id) : null;
    if (!o || a === o) return;
    const src = groups.find((g) => g.items.some((t) => t.id === a));
    const dst = o.startsWith('group:') ? groups.find((g) => `group:${g.key}` === o) : groups.find((g) => g.items.some((t) => t.id === o));
    if (!src || !dst) return;
    let order: string[];
    if (src === dst) {
      const ids = src.items.map((t) => t.id);
      order = arrayMove(ids, ids.indexOf(a), o.startsWith('group:') ? ids.length - 1 : ids.indexOf(o));
    } else {
      order = dst.items.map((t) => t.id);
      const at = o.startsWith('group:') ? order.length : order.indexOf(o);
      order.splice(at < 0 ? order.length : at, 0, a);
      const body = moveBody(dst);
      const t = src.items.find((x) => x.id === a)!;
      if (body && 'status' in body && !canSetStatus(t, user.id, body.status as TaskStatus)) { toast.info(NOT_MINE); return; }
      if (body) onPatch(t, body);
    }
    onReorder(order);
  };

  return (
    <DndContext sensors={selOnCtx || !draggable ? NO_SENSORS : sensors} onDragEnd={draggable ? end : undefined} onDragStart={(_e: DragStartEvent) => { try { navigator.vibrate?.(15); } catch {} }}>
      <div className="space-y-4" data-testid="task-groups" data-group-by={group}>
        {top && <div className="overflow-hidden rounded-card border border-accent-500/40 bg-white shadow-card ring-2 ring-accent-500/10">{top}</div>}
        {group === 'month' ? (() => {
          // V11 2번: 완료 보기 머리 요약
          const ym = today.slice(0, 7), d = new Date(today.slice(0, 7) + '-01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() - 1);
          const prev = d.toISOString().slice(0, 7);
          const n = (k: string) => groups.find((g) => g.key === k)?.items.length ?? 0;
          return <p className="px-1 text-sm text-ink-2" data-testid="done-summary">이번 달 <b className="text-ink">{n(ym)}건</b> · 지난달 <b className="text-ink">{n(prev)}건</b> 완료</p>;
        })() : <ListHeader sortBy={sortBy} onSort={onSort} />}
        {groups.map((x, gi) => {
          const open = x.items.filter((t) => t.status !== 'done').length;
          // 완료 업무: 이 화면에서 방금 끝낸 건 제자리(취소선), 그 밖의 오늘 완료는 묶음 끝 "오늘 완료 n건" 접힘 줄
          const archive = group === 'month';
          const shown = archive ? x.items : x.items.filter((t) => t.status !== 'done' || keepIds?.has(t.id));
          const doneFold = archive ? [] : x.items.filter((t) => t.status === 'done' && !keepIds?.has(t.id));
          const late = x.items.filter((t) => t.status !== 'done' && t.due_date && t.due_date < today).length;
          const isFolded = folded[x.key];
          const who = x.label === '담당자 없음' ? '담당자 없이' : `${x.label}님에게`;
          const addRow = <InlineAddTask key={x.key} muted defaultAssignee={x.add.defaultAssignee} defaultRequester={x.add.defaultRequester} defaultDue={x.add.defaultDue} projectId={x.add.projectId}
            placeholder={group === 'assignee' ? `${who} 업무 추가` : group === 'requester' ? `${x.label} 지시로 업무 추가` : x.label ? `${x.label}에 업무 추가` : '업무 추가'} />;
          return (
            <GroupDrop key={x.key} id={`group:${x.key}`} groupKey={x.key}>
              {x.label && (
                <button onClick={() => setFolded((f) => ({ ...f, [x.key]: !f[x.key] }))} aria-expanded={!isFolded}
                  className={cx('mb-1.5 flex w-full items-center gap-2 px-1 text-left text-sm font-semibold', x.tone ?? 'text-ink')}>
                  <ChevronDown className={cx('size-4 text-ink-3 transition-transform', isFolded && '-rotate-90')} />
                  {x.head}{x.label}
                  <span className="rounded-full bg-slate-100 px-1.5 text-xs font-medium text-ink-2 tabular-nums" title="진행 중">{open}</span>
                  {late > 0 && <span className="rounded-full bg-red-50 px-1.5 text-xs font-medium text-red-600 tabular-nums">지연 {late}</span>}
                  {!x.items.length && <span className="text-xs font-normal text-ink-3">업무 없음</span>}
                </button>
              )}
              {!isFolded && gi > 0 && !archive && shown.length > 0 && <ListHeader sortBy={sortBy} onSort={onSort} compact />}
              {!isFolded && <ListView tasks={shown} onPatch={onPatch} hint={gi === 0} tail={archive ? undefined : addRow} sortable={draggable} dragHint={!draggable && !archive} onMove={draggable ? (t, to) => {
                const ids = shown.map((i) => i.id); const from = ids.indexOf(t.id);
                const at = to === 'top' ? 0 : to === 'bottom' ? ids.length - 1 : Math.max(0, Math.min(ids.length - 1, from + (to === 'up' ? -1 : 1)));
                if (at !== from) onReorder(arrayMove(ids, from, at));
              } : undefined} />}
              {!isFolded && doneFold.length > 0 && (
                <div className="mt-1" data-testid="done-fold">
                  <button type="button" onClick={toggleDone} aria-expanded={doneOpen} className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-ink-2 hover:text-ink">
                    <ChevronDown className={cx('size-3.5 transition-transform', !doneOpen && '-rotate-90')} /><CircleCheck className="size-3.5 text-green-600" />오늘 완료 {doneFold.length}건
                  </button>
                  {doneOpen && <ListView tasks={doneFold} onPatch={onPatch} hint={false} />}
                </div>
              )}
            </GroupDrop>
          );
        })}
      </div>
    </DndContext>
  );
}
function GroupDrop({ id, groupKey, children }: { id: string; groupKey: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return <section ref={setNodeRef} data-group={groupKey} className={cx('rounded-card', isOver && 'ring-2 ring-accent-500/30')}>{children}</section>;
}
/**
 * V20 완료 보관: 완료일(서울) 달별 — 이번 달만 펼치고 지난달들은 접힘(개수 표시). 펼칠 때 그 달만 불러온다(doneMonth).
 * 맨 위 ◀ 2026년 10월 ▶ 로 달 이동. 달 안에서는 담당자별 → 완료일 최신순.
 */
function DoneArchive({ thisMonth, filterQs, onPatch }: { thisMonth: Task[]; filterQs: string; onPatch: (t: Task, b: any) => any }) {
  const { user } = useSession();
  const ym = todayStr().slice(0, 7);
  const months = useApi<{ months: { month: string; n: number }[] }>(`/api/tasks/done-months${filterQs ? `?${filterQs}` : ''}`);
  const list = useMemo(() => {
    const m = [...(months.data?.months ?? [])];
    if (!m.some((x) => x.month === ym)) m.unshift({ month: ym, n: thisMonth.length });
    return m.map((x) => (x.month === ym ? { ...x, n: thisMonth.filter((t) => t.status === 'done').length } : x)).sort((a, b) => b.month.localeCompare(a.month));
  }, [months.data, thisMonth, ym]);
  const [open, setOpen] = useState<Record<string, boolean>>({ [ym]: true });
  const [cache, setCache] = useState<Record<string, Task[] | 'loading'>>({});
  useEffect(() => { setCache({}); }, [filterQs]);
  async function load(m: string) {
    if (m === ym || cache[m]) return;
    setCache((c) => ({ ...c, [m]: 'loading' }));
    try { const r = await api<{ tasks: Task[] }>(`/api/tasks?view=done&doneMonth=${m}&limit=1000${filterQs ? `&${filterQs}` : ''}`); setCache((c) => ({ ...c, [m]: r.tasks })); }
    catch (e: any) { toast.error(e.message); setCache((c) => { const n = { ...c }; delete n[m]; return n; }); }
  }
  const toggle = (m: string) => { const next = !open[m]; setOpen((o) => ({ ...o, [m]: next })); if (next) void load(m); };
  const [focus, setFocus] = useState(ym);
  const jump = (dir: -1 | 1) => {
    const i = list.findIndex((x) => x.month === focus);
    const nx = list[i - dir]; // 목록은 최신 달이 앞
    if (!nx) return;
    setFocus(nx.month); setOpen((o) => ({ ...o, [nx.month]: true })); void load(nx.month);
    setTimeout(() => document.querySelector(`[data-done-month="${nx.month}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 50);
  };
  const label = (m: string) => `${m.slice(0, 4)}년 ${Number(m.slice(5))}월`;
  const prevYm = (() => { const d = new Date(ym + '-01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); })();
  const cnt = (m: string) => list.find((x) => x.month === m)?.n ?? 0;
  return (
    <div className="space-y-3" data-testid="task-groups" data-group-by="month">
      <div className="flex flex-wrap items-center gap-2 px-1">
        <p className="text-sm text-ink-2" data-testid="done-summary">이번 달 <b className="text-ink">{cnt(ym)}건</b> · 지난달 <b className="text-ink">{cnt(prevYm)}건</b> 완료</p>
        <span className="ml-auto inline-flex items-center gap-1 text-sm" data-testid="done-month-nav">
          <button type="button" onClick={() => jump(-1)} className="rounded p-1 text-ink-2 hover:bg-slate-100 disabled:opacity-30" disabled={list.findIndex((x) => x.month === focus) >= list.length - 1} aria-label="이전 달"><ChevronLeft className="size-4" /></button>
          <span className="min-w-[6.5rem] text-center font-semibold tabular-nums">{label(focus)}</span>
          <button type="button" onClick={() => jump(1)} className="rounded p-1 text-ink-2 hover:bg-slate-100 disabled:opacity-30" disabled={list.findIndex((x) => x.month === focus) <= 0} aria-label="다음 달"><ChevronRight className="size-4" /></button>
        </span>
      </div>
      {list.map(({ month: m, n }) => {
        const isOpen = !!open[m];
        const rows = m === ym ? thisMonth.filter((t) => t.status === 'done') : cache[m];
        const byWho = new Map<string, { name: string; items: Task[] }>();
        if (Array.isArray(rows)) for (const t of [...rows].sort((a, b) => String(b.completed_at ?? '').localeCompare(String(a.completed_at ?? '')))) {
          const k = t.assignee_id ?? 'none';
          if (!byWho.has(k)) byWho.set(k, { name: t.assignee_name ?? '담당자 없음', items: [] });
          byWho.get(k)!.items.push(t);
        }
        const groups = [...byWho.entries()].sort(([a, x], [b, y]) => (a === user.id ? -1 : b === user.id ? 1 : a === 'none' ? 1 : b === 'none' ? -1 : x.name.localeCompare(y.name, 'ko')));
        return (
          <section key={m} data-done-month={m} data-open={isOpen ? '1' : undefined}>
            <button type="button" onClick={() => toggle(m)} aria-expanded={isOpen} className="mb-1.5 flex w-full items-center gap-2 px-1 text-left text-sm font-semibold text-ink">
              <ChevronDown className={cx('size-4 text-ink-3 transition-transform', !isOpen && '-rotate-90')} />{label(m)}
              <span className="rounded-full bg-slate-100 px-1.5 text-xs font-medium text-ink-2 tabular-nums">{n}건</span>
            </button>
            {isOpen && (rows === 'loading' || rows === undefined ? <p className="px-3 py-2 text-sm text-ink-3">불러오는 중…</p>
              : !groups.length ? <p className="px-3 py-2 text-sm text-ink-3">이 달에 완료한 업무가 없습니다</p>
              : <div className="space-y-2">{groups.map(([k, g]) => (
                  <div key={k} data-done-who={k}>
                    <p className="flex items-center gap-1.5 px-2 pb-1 text-xs font-semibold text-ink-2"><Avatar id={k === 'none' ? null : k} name={k === 'none' ? null : g.name} size={18} />{g.name}<span className="font-normal text-ink-3">{g.items.length}</span></p>
                    <ListView tasks={g.items} onPatch={onPatch} hint={false} />
                  </div>
                ))}</div>)}
          </section>
        );
      })}
    </div>
  );
}

/** 끌어서 순서 바꾸는 행 (손잡이는 PC 에서만 — 휴대폰은 밀기 동작과 겹치지 않게) */
function SortableRow({ t, onPatch, onAck, onMove }: { t: Task; onPatch: (t: Task, b: any) => any; onAck?: (t: Task) => void; onMove?: (t: Task, to: 'top' | 'up' | 'down' | 'bottom') => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: t.id });
  const { onMouseDown, onTouchStart } = (listeners ?? {}) as Record<string, any>;
  // V14 40번: 끌던 행이 사라지면(완료·삭제로 목록에서 빠짐) 끌기 상태를 정리 — 남으면 다음 터치(클릭)를 먹는다
  const dragging = useRef(false); dragging.current = isDragging;
  useEffect(() => () => { if (dragging.current) cancelDrag(); }, []);
  return (
    // 삼성 WebView: 꾹 누르는 동안 글자 선택·길게 누르기 메뉴가 먼저 잡혀 끌기가 취소되던 문제 → 선택·메뉴 막기,
    // 끌기가 시작된 뒤에만 touch-action:none (그 전에는 세로 스크롤 그대로)
    <div ref={setNodeRef} onTouchStart={onTouchStart} onContextMenu={(e) => e.preventDefault()}
      style={{ transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined, transition, touchAction: isDragging ? 'none' : 'pan-y', WebkitTouchCallout: 'none' }}
      className={cx('select-none', isDragging && 'relative z-50 scale-[1.02] opacity-95 shadow-pop ring-2 ring-accent-500/40')} data-sortable-row={t.id} data-dragging={isDragging ? '1' : undefined}>
      <ListRow t={t} onPatch={onPatch} onAck={onAck} onMove={onMove} handle={
        <button type="button" {...attributes} onMouseDown={onMouseDown} className="hidden w-4 shrink-0 cursor-grab touch-none text-slate-300 hover:text-slate-500 sm:inline-flex" aria-label={`${t.title} 끌어서 순서 바꾸기`} data-testid="drag-handle"><GripVertical className="size-4" /></button>
      } />
    </div>
  );
}

/** 내 업무: 최근 배정 → 기한 지남 → 오늘 → 이번 주 → 나중 → 날짜 없음 (Asana '내 작업' 참고) */
function MyGroupedList({ tasks, onPatch, onAcked, top }: { tasks: Task[]; onPatch: (t: Task, b: any) => void; onAcked: () => void; top?: React.ReactNode }) {
  const { user } = useSession();
  const add = top ? <div className="overflow-hidden rounded-card border border-line bg-white shadow-card">{top}</div> : null;
  if (!tasks.length) return <div className="space-y-3" data-testid="my-groups">{add}<Empty title="내 업무가 없습니다" icon={CircleCheck}>맡은 업무가 모두 끝났습니다. 아래 줄이나 <b>+ 업무 추가</b>로 바로 추가하세요.</Empty>
    <div className="overflow-hidden rounded-card border border-line bg-white shadow-card"><InlineAddTask muted /></div></div>;
  const today = todayStr();
  const d = new Date(today + 'T00:00:00Z');
  const weekEnd = new Date(d.getTime() + ((7 - ((d.getUTCDay() + 6) % 7)) - 1) * 86400000).toISOString().slice(0, 10); // 이번 주 일요일
  const groups: { key: string; label: string; items: Task[] }[] = [
    { key: 'new', label: '새로 배정됨 (확인 전)', items: [] }, { key: 'over', label: '기한 지남', items: [] }, { key: 'today', label: '오늘', items: [] },
    { key: 'week', label: '이번 주', items: [] }, { key: 'later', label: '나중', items: [] }, { key: 'none', label: '마감일 없음', items: [] },
  ];
  const g = (k: string) => groups.find((x) => x.key === k)!.items;
  for (const t of tasks) {
    const anyT = t as any;
    if (t.status !== 'done' && t.assignee_id === user.id && !anyT.assignee_ack_at) g('new').push(t);
    else if (!t.due_date) g('none').push(t);
    else if (t.due_date < today) g('over').push(t);
    else if (t.due_date === today) g('today').push(t);
    else if (t.due_date <= weekEnd) g('week').push(t);
    else g('later').push(t);
  }
  return (
    <div className="space-y-3" data-testid="my-groups">
      {add}
      {groups.filter((x) => x.items.length).map((x, gi) => (
        <section key={x.key} data-group={x.key}>
          <h2 className={cx('mb-1.5 flex items-center gap-2 px-1 text-sm font-semibold', x.key === 'over' ? 'text-red-600' : 'text-ink')}>
            {x.label}<span className="rounded-full bg-slate-100 px-1.5 text-xs font-medium text-ink-2 tabular-nums">{x.items.length}</span>
          </h2>
          <ListView tasks={x.items} onPatch={onPatch} hint={gi === 0} tail={<InlineAddTask muted defaultDue={DUE_DEFAULT[x.key]?.() ?? null} placeholder="업무 추가" />} onAck={x.key === 'new' ? async (t) => { try { await api(`/api/tasks/${t.id}/ack`, { body: {} }); onAcked(); } catch (e: any) { toast.error(e.message); } } : undefined} />
        </section>
      ))}
    </div>
  );
}

function ListView({ tasks, onPatch, onAck, empty, hint = true, add, tail, sortable, onMove, dragHint }: { tasks: Task[]; onPatch: (t: Task, b: any) => any; onAck?: (t: Task) => void; empty?: React.ReactNode; hint?: boolean; add?: React.ReactNode; tail?: React.ReactNode; sortable?: boolean; onMove?: (t: Task, to: 'top' | 'up' | 'down' | 'bottom') => void; dragHint?: boolean }) {
  const openTask = useContext(OpenTaskCtx);
  if (!tasks.length && tail) return <div className="overflow-hidden rounded-card border border-line bg-white shadow-card" data-testid="task-list">{add}{tail}</div>;
  if (!tasks.length && add) return <div className="overflow-hidden rounded-card border border-line bg-white shadow-card" data-testid="task-list">{add}<p className="px-4 py-6 text-center text-sm text-ink-3">조건에 맞는 업무가 없습니다</p></div>;
  if (!tasks.length) return <>{empty ?? <Empty title="조건에 맞는 업무가 없습니다" icon={Search}>필터를 바꾸거나 <b>만들기</b>(단축키 N)로 업무를 등록하세요.</Empty>}</>;
  // ↑↓ 로 행 이동, Enter 로 열기
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key) || (e.target as HTMLElement).tagName === 'SELECT' || (e.target as HTMLElement).tagName === 'INPUT') return;
    const rows = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-row]'));
    const i = rows.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Enter' && i >= 0) { e.preventDefault(); openTask(rows[i].dataset.row!); return; }
    if (e.key === 'Enter') return;
    e.preventDefault();
    rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus();
  };
  return (
    <div className="overflow-hidden rounded-card border border-line bg-white shadow-card" data-testid="task-list" onKeyDown={onKey}>
      {add}
      {hint && <SwipeHint sortable={!!sortable} />}
      {sortable ? (
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((t) => <SortableRow key={t.id} t={t} onPatch={onPatch} onAck={onAck} onMove={onMove} />)}
        </SortableContext>
      ) : tasks.map((t) => <ListRow key={t.id} t={t} onPatch={onPatch} onAck={onAck} dragHint={dragHint} handle={<span className="hidden w-4 shrink-0 sm:inline-flex" />} />)}
      {tail}
    </div>
  );
}

/** 목록 행. 모바일에서는 오른쪽으로 밀면 완료(또는 검토 요청), 왼쪽으로 밀면 보류 */
function ListRow({ t, onPatch, onAck, handle, onMove, dragHint }: { t: Task; onPatch: (t: Task, b: any) => any; onAck?: (t: Task) => void; handle?: React.ReactNode; onMove?: (t: Task, to: 'top' | 'up' | 'down' | 'bottom') => void; dragHint?: boolean }) {
  // 방금 추가한 업무는 2초 강조
  const [fresh, setFresh] = useState(() => isFresh(t.id));
  useEffect(() => { if (!fresh) return; const h = setTimeout(() => setFresh(false), 2000); return () => clearTimeout(h); }, [fresh]);
  const { user } = useSession();
  const start = useRef<{ x: number; y: number; lock: 'x' | 'y' | null; w: number } | null>(null);
  const [dx, setDx] = useState(0);
  // 밀어서 완료: 기본 꺼짐(설정에서 켬). 켜도 오른쪽으로 행 너비 45% 이상 밀고 손을 뗄 때만, 세로 스크롤 중엔 무시. 보류 밀기는 없앰(실수로 업무가 사라지던 원인)
  // V12 11번: 상태를 바꿀 수 없는 업무는 밀어서 완료도 끔
  const swipeOn = useSwipeSetting() && canSetStatus(t, user.id, nextStatusOnCheck(t, user.role));
  const rowOpen0 = useRowOpen(t.id, useContext(OpenTaskCtx));
  const selc = useContext(SelectCtx);
  const picked = !!selc?.sel.has(t.id);
  // 선택 모드에서는 행을 누르면 선택/해제 (Shift = 범위)
  const rowOpen = selc?.on ? { onClick: (e: React.MouseEvent) => { e.preventDefault(); selc.toggle(t.id, e.shiftKey); } } : rowOpen0;
  const lp = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 정렬이 "직접 순서"가 아니면 끌 수 없음 → 꾹 누르면 안내
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hintStart = (e: React.PointerEvent) => {
    // V14 12번: 휴대폰에서 길게 누르면 선택 모드
    // V14 34번: 길게 누르기 = 선택 모드만(진동, 화면 이동 없음). 손을 뗄 때 오는 클릭은 버린다
    lpFired.current = false; // 지난 꾹 누르기 뒤 클릭이 안 와도(안드로이드) 다음 터치를 먹지 않게
    if (e.pointerType === 'touch' && selc && !selc.on) lp.current = setTimeout(() => { selc.enter(t.id); lpFired.current = true; swallowNextClick(); try { navigator.vibrate?.(20); } catch {} }, 550);
  };
  const lpFired = useRef(false);
  const hintStop = () => { if (hintTimer.current) { clearTimeout(hintTimer.current); hintTimer.current = null; } if (lp.current) { clearTimeout(lp.current); lp.current = null; } };
  const right = nextStatusOnCheck(t, user.role);
  const swipe = async (to: TaskStatus) => {
    const before = t.status;
    if (await onPatch(t, { status: to }) !== false) toast.ok(to === 'on_hold' ? '보류로 바꿨습니다' : to === 'review' ? '검토를 요청했습니다' : to === 'done' ? '완료했습니다' : '다시 진행 중으로 바꿨습니다', { label: '되돌리기', run: () => onPatch({ ...t, status: to, version: t.version + 1 }, { status: before }) });
  };
  return (
    <div className="relative overflow-hidden border-b border-line last:border-b-0">
      {dx !== 0 && (
        <div className={cx('absolute inset-0 flex items-center px-5 text-sm font-semibold text-white', dx > 0 ? 'justify-start bg-green-500' : 'justify-end bg-zinc-500')} aria-hidden>
          {right === 'review' ? '검토 요청' : right === 'done' ? '완료' : '다시 진행'}
        </div>
      )}
      <div tabIndex={0} data-row={t.id} data-task-id={t.id} {...rowOpen}
        onPointerDown={hintStart} onPointerUp={hintStop} onPointerCancel={hintStop} onPointerLeave={hintStop}
        onClickCapture={(e) => { if (lpFired.current) { lpFired.current = false; e.preventDefault(); e.stopPropagation(); } }}
        onContextMenu={(e) => { if (lpFired.current || selc?.on) e.preventDefault(); }}
        style={dx ? { transform: `translateX(${dx}px)` } : undefined}
        onTouchStart={(e) => { if (!swipeOn) return; start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, lock: null, w: (e.currentTarget as HTMLElement).offsetWidth }; }}
        onTouchMove={(e) => {
          const st = start.current; if (!st) return;
          const mx = e.touches[0].clientX - st.x, my = e.touches[0].clientY - st.y;
          if (!st.lock && (Math.abs(mx) > 12 || Math.abs(my) > 12)) st.lock = Math.abs(mx) > Math.abs(my) * 2 ? 'x' : 'y';
          if (st.lock === 'x') setDx(Math.max(0, Math.min(st.w * 0.6, mx)));
        }}
        onTouchEnd={() => {
          const st = start.current; const d = dx; start.current = null; setDx(0);
          if (st?.lock === 'x' && d >= st.w * 0.45) swipe(right);
        }}
        onTouchCancel={() => { start.current = null; setDx(0); }}
        data-fresh={fresh ? '1' : undefined}
        className={cx('group relative flex min-h-[44px] cursor-pointer items-center gap-3 px-3 py-2 hover:bg-slate-50 focus:bg-accent-50 focus:outline-none', picked ? 'bg-brand-50' : fresh ? 'bg-amber-50 ring-2 ring-inset ring-amber-300' : 'bg-white', !dx && 'transition-[transform,background-color]')}>
        {handle}
        {/* V14 44번: 선택 체크박스 홈 — PC 는 줄 왼쪽에 고정 폭(24px) 자리를 늘 비워 두고(제목이 안 움직이게) 그 안 세로 가운데에 16px 체크박스,
            마우스 올림·선택 모드에서만 보임. 휴대폰은 길게 눌러 선택 모드일 때만 자리. (V14 43번: 왼쪽 완료 동그라미 없음) */}
        {selc && (
          <span className={cx('-mr-1 w-6 shrink-0 items-center justify-center', selc.on ? 'flex' : 'hidden md:flex')} data-testid="row-select-slot">
            {selc.on
              ? <input type="checkbox" className="size-5 shrink-0 accent-brand-600 md:size-4" checked={picked} readOnly onClick={(e) => { e.stopPropagation(); selc.toggle(t.id, e.shiftKey); }} aria-label={`${t.title} 선택`} data-testid="row-select" />
              : <input type="checkbox" checked={false} readOnly onClick={(e) => { e.stopPropagation(); selc.enter(t.id); }} aria-label={`${t.title} 선택 시작`} data-testid="row-hover-select"
                  className="size-4 accent-brand-600 opacity-0 group-hover:opacity-100 focus:opacity-100" />}
          </span>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-3">
          <span className="flex min-w-0 items-center gap-1.5 sm:max-w-[55%] sm:shrink-0">
            <TypeIcon t={t} />
            {/* 대표 피드백(10/15): 휴대폰은 제목이 너무 짧게 잘림 → 두 줄까지 보이고, PC 는 한 줄 */}
            <TaskLink id={t.id} className={cx('min-w-0 text-sm font-medium text-ink hover:text-accent-600 hover:underline max-sm:line-clamp-2 max-sm:break-words max-sm:leading-snug sm:truncate', t.status === 'done' && 'text-ink-3 line-through')}>{t.title}</TaskLink>
            <CarriedBadge t={t} />
          </span>
          <Meta t={t} onPatch={onPatch} />
        </div>
        {onAck && <Button size="sm" variant="secondary" onClick={() => onAck(t)} aria-label={`${t.title} 확인`}>확인</Button>}
        <span className="hidden w-[104px] min-w-0 md:flex"><AssigneePicker role="지시자" value={t.requested_by} name={t.requested_by_name} size={18} withName onChange={(v) => v && onPatch(t, { requestedById: v })} /></span>
        <span className="hidden w-[60px] justify-end sm:flex"><PriorityPicker value={t.priority} label={`${t.title} 우선순위`} onChange={(v) => onPatch(t, { priority: v })} /></span>
        <span className="hidden w-[112px] sm:inline-flex"><StatusChip t={t} onPatch={onPatch} /></span>
        <DueEdit t={t} onPatch={onPatch} />
        <AssigneePicker value={t.assignee_id} name={t.assignee_name} onChange={(v) => onPatch(t, { assigneeId: v })} />
        {onMove && <OrderMenu title={t.title} onMove={(to) => onMove(t, to)} />}
      </div>
    </div>
  );
}

function BoardCard({ t }: { t: Task }) {
  const selc = useContext(SelectCtx);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: t.id, data: t, disabled: !!selc?.on });
  const cardOpen0 = useRowOpen(t.id, useContext(OpenTaskCtx));
  // V14 20번: 보드에서도 선택 모드 — 카드를 누르면 선택/해제
  const cardOpen = selc?.on ? { onClick: (e: React.MouseEvent) => { e.preventDefault(); selc.toggle(t.id, e.shiftKey); } } : cardOpen0;
  const picked = !!selc?.sel.has(t.id);
  const stripe = t.priority === 'urgent' ? 'before:bg-red-500' : t.priority === 'high' ? 'before:bg-orange-400' : 'before:bg-transparent';
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} {...cardOpen} data-task-id={t.id}
      style={transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined}
      className={cx('relative cursor-grab touch-none overflow-hidden rounded-input border border-line bg-white p-3 shadow-card transition-shadow before:absolute before:inset-y-0 before:left-0 before:w-[3px] hover:border-slate-300 hover:shadow-pop',
        stripe, isDragging && 'z-50 rotate-1 cursor-grabbing opacity-90 shadow-pop ring-2 ring-accent-500/40', picked && 'ring-2 ring-brand-600')}>
      <div className="flex items-start gap-1.5">
        {selc?.on && <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-brand-600" checked={picked} readOnly aria-label={`${t.title} 선택`} data-testid="card-select" />}
        <TypeIcon t={t} />
        <TaskLink id={t.id} className={cx('line-clamp-2 text-sm font-medium leading-snug text-ink hover:text-accent-600 hover:underline', t.status === 'done' && 'text-ink-3 line-through')}>{t.title}</TaskLink>
        <CarriedBadge t={t} />
      </div>
      <div className="mt-1.5"><Meta t={t} compact /></div>
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5">
          {t.due_date ? <DueChip due={t.due_date} status={t.status} /> : <span className="text-xs text-ink-3">마감 없음</span>}
          <PriorityTag p={t.priority} label={false} />
        </span>
        <Avatar id={t.assignee_id} name={t.assignee_name} size={24} />
      </div>
      <span className="sr-only">{t.due_date ? fmtDate(t.due_date) : ''}</span>
    </div>
  );
}
function Column({ status, tasks }: { status: TaskStatus; tasks: Task[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div ref={setNodeRef} className={cx('flex w-72 shrink-0 flex-col rounded-card border-t-[3px] bg-slate-100/70 p-2 transition-colors sm:w-auto', isOver && 'bg-accent-50 ring-2 ring-accent-500/30')}
      style={{ borderTopColor: STATUS_TONE[status].bar }} data-column={status}>
      <div className="mb-2 flex items-center justify-between px-1 pt-0.5">
        <span className="text-sm font-semibold text-ink">{STATUS_LABEL[status]}</span>
        <span className="rounded-full bg-white px-2 text-xs font-medium text-ink-2 tabular-nums shadow-card">{tasks.length}</span>
      </div>
      <div className="flex min-h-[96px] flex-col gap-2">
        {tasks.map((t) => <BoardCard key={t.id} t={t} />)}
        {!tasks.length && <div className={cx('flex flex-1 items-center justify-center rounded-input border-2 border-dashed text-xs', isOver ? 'border-accent-500 text-accent-600' : 'border-slate-200 text-ink-3')}>여기로 끌어 놓기</div>}
      </div>
    </div>
  );
}
function BoardView({ tasks, onPatch }: { tasks: Task[]; onPatch: (t: Task, b: any) => void }) {
  const { user } = useSession();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }));
  const end = (e: DragEndEvent) => {
    const t = e.active.data.current as Task;
    const to = e.over?.id as TaskStatus | undefined;
    if (!t || !to || to === t.status) return;
    if (!canSetStatus(t, user.id, to)) { toast.info(NOT_MINE); return; } // V12 11번
    onPatch(t, { status: to });
  };
  return (
    <DndContext sensors={sensors} onDragEnd={end}>
      <div className="flex gap-3 overflow-x-auto pb-2 sm:grid sm:grid-cols-5" data-testid="board">
        {STATUSES.map((s) => <Column key={s} status={s} tasks={tasks.filter((t) => t.status === s)} />)}
      </div>
    </DndContext>
  );
}

function addDays(d: string, n: number) {
  const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10);
}
function diffDays(a: string, b: string) { return Math.round((Date.parse(b) - Date.parse(a)) / 86400000); }

function CalendarView({ tasks, onPatch }: { tasks: Task[]; onPatch: (t: Task, b: any) => void }) {
  const openTask = useContext(OpenTaskCtx);
  const events = tasks.filter((t) => t.due_date).map((t) => ({
    id: t.id, title: `${t.status === 'done' ? '✓ ' : ''}${t.title}`, allDay: true,
    start: t.start_date && t.start_date < t.due_date! ? t.start_date : t.due_date!,
    end: addDays(t.due_date!, 1), extendedProps: { task: t },
    backgroundColor: t.status === 'done' ? '#94a3b8' : t.due_date! < todayStr() ? '#dc2626' : t.project_color ?? '#0F766E',
    borderColor: 'transparent',
  }));
  return (
    <div className="rounded-card border border-line bg-white p-3 shadow-card" data-testid="task-calendar">
      <FullCalendar
        plugins={[dayGridPlugin, interactionPlugin, listPlugin]}
        initialView="dayGridMonth" locale="ko" height="auto" firstDay={1} editable eventDurationEditable
        headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,listMonth' }}
        buttonText={{ today: '오늘', month: '월', list: '목록' }} events={events} dayMaxEvents={4}
        eventClick={(i) => { i.jsEvent.preventDefault(); openTask(i.event.id); }}
        eventDrop={(i) => {
          const t = i.event.extendedProps.task as Task;
          const delta = i.delta.days + i.delta.months * 30; // 월 단위 이동은 날짜로 다시 계산
          const newStart = i.event.startStr.slice(0, 10);
          const oldStart = t.start_date && t.start_date < t.due_date! ? t.start_date : t.due_date!;
          const shift = diffDays(oldStart, newStart) || delta;
          onPatch(t, { dueDate: addDays(t.due_date!, shift), ...(t.start_date ? { startDate: addDays(t.start_date, shift) } : {}) });
        }}
        eventResize={(i) => {
          const t = i.event.extendedProps.task as Task;
          const end = addDays(i.event.endStr.slice(0, 10), -1);
          const start = i.event.startStr.slice(0, 10);
          onPatch(t, { dueDate: end, startDate: start < end ? start : null });
        }}
      />
    </div>
  );
}

/**
 * 타임라인 (V12 12번): 시작일이 없으면 배정일(없으면 만든 날)→마감을 옅은 기간으로, 진한 막대는 실제 시작~마감.
 * 막대가 좁으면 제목을 막대 오른쪽 바깥에 전체로, 마우스를 올리면 툴팁. 왼쪽 업무 열 280px·끌어서 폭 조절,
 * 2주(기본)·6주·3달 확대/축소, 오늘 세로선, 상태별 색·범례. 휴대폰은 기간 목록.
 */
const ZOOMS = { '2w': { days: 14, label: '2주' }, '6w': { days: 42, label: '6주' }, '3m': { days: 91, label: '3달' } } as const;
type Zoom = keyof typeof ZOOMS;
const TL_TONE: Record<TaskStatus, string> = { todo: '#94a3b8', in_progress: '#3b82f6', review: '#8b5cf6', on_hold: '#f97316', done: '#22c55e' };
function TimelineView({ tasks, onPatch }: { tasks: Task[]; onPatch: (t: Task, b: any) => void }) {
  const monday = () => { const d = new Date(todayStr() + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
  const [anchor, setAnchor] = useState(monday);
  const [zoom, setZoom] = useState<Zoom>(() => { try { const z = localStorage.getItem('wos_tl_zoom'); return z && z in ZOOMS ? (z as Zoom) : '2w'; } catch { return '2w'; } });
  const [leftW, setLeftW] = useState(() => { try { return Math.min(560, Math.max(180, Number(localStorage.getItem('wos_tl_left')) || 280)); } catch { return 280; } });
  const DAYS = ZOOMS[zoom].days;
  const step = zoom === '3m' ? 28 : 7;
  const days = Array.from({ length: DAYS }, (_, i) => addDays(anchor, i));
  const rows = tasks.filter((t) => t.due_date || t.start_date);
  const gridRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: string; kind: 'move' | 'end'; x0: number; dx: number } | null>(null);
  const [resize, setResize] = useState<{ x0: number; w0: number } | null>(null);
  const colW = () => (gridRef.current ? gridRef.current.clientWidth / DAYS : 30);
  const today = todayStr();
  const pickZoom = (z: Zoom) => { setZoom(z); try { localStorage.setItem('wos_tl_zoom', z); } catch {} };
  const dayOf = (iso?: string | null) => (iso ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(iso)) : null);
  function span(t: Task) {
    const s = t.start_date && (!t.due_date || t.start_date <= t.due_date) ? t.start_date : (t.due_date ?? t.start_date)!;
    const e = t.due_date ?? s;
    // 시작일이 없으면 배정일(없으면 만든 날)부터 옅은 기간
    const implied = !t.start_date ? dayOf((t as any).assigned_at ?? t.created_at) : null;
    return { s, e, implied: implied && implied < s ? implied : null };
  }
  function finish() {
    if (resize) { setResize(null); try { localStorage.setItem('wos_tl_left', String(leftW)); } catch {} }
    if (!drag) return;
    const t = rows.find((r) => r.id === drag.id)!;
    const n = Math.round(drag.dx / colW());
    setDrag(null);
    if (!n) return;
    const due = t.due_date ?? t.start_date!;
    if (drag.kind === 'move') onPatch(t, { dueDate: addDays(due, n), ...(t.start_date ? { startDate: addDays(t.start_date, n) } : {}) });
    else {
      const nd = addDays(due, n);
      if (t.start_date && nd < t.start_date) return toast.error('마감일은 시작일보다 빠를 수 없습니다');
      onPatch(t, { dueDate: nd });
    }
  }
  const pct = (i: number) => `${(i / DAYS) * 100}%`;
  const todayIdx = diffDays(anchor, today);
  const label = (d: string) => (zoom === '3m' ? (Number(d.slice(8)) === 1 || d === days[0] ? `${Number(d.slice(5, 7))}/${Number(d.slice(8))}` : new Date(d + 'T00:00:00Z').getUTCDay() === 1 ? String(Number(d.slice(8))) : '') : String(Number(d.slice(8))));
  return (
    <div className="overflow-hidden rounded-card border border-line bg-white shadow-card" data-testid="timeline"
      onPointerMove={(e) => { if (resize) setLeftW(Math.min(560, Math.max(180, resize.w0 + e.clientX - resize.x0))); else if (drag) setDrag({ ...drag, dx: e.clientX - drag.x0 }); }}
      onPointerUp={finish} onPointerLeave={finish}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2 text-sm">
        <div className="flex gap-1">
          <Button size="sm" variant="secondary" onClick={() => setAnchor(addDays(anchor, -step))}>‹ 이전</Button>
          <Button size="sm" variant="secondary" onClick={() => setAnchor(monday())}>오늘</Button>
          <Button size="sm" variant="secondary" onClick={() => setAnchor(addDays(anchor, step))}>다음 ›</Button>
        </div>
        <span className="font-medium text-ink-2 tabular-nums">{fmtDate(days[0])} ~ {fmtDate(days[DAYS - 1])}</span>
        <div className="flex rounded-input border border-line p-0.5 text-xs" role="tablist" aria-label="타임라인 범위">
          {(Object.keys(ZOOMS) as Zoom[]).map((z) => <button key={z} role="tab" aria-selected={zoom === z} onClick={() => pickZoom(z)} className={cx('rounded px-2 py-1', zoom === z ? 'bg-brand-600 font-semibold text-white' : 'text-ink-2 hover:bg-slate-100')}>{ZOOMS[z].label}</button>)}
        </div>
      </div>
      <div className="flex flex-wrap gap-3 border-b border-line px-3 py-1.5 text-[11px] text-ink-2" data-testid="timeline-legend">
        {STATUSES.map((st) => <span key={st} className="inline-flex items-center gap-1"><i className="inline-block size-2.5 rounded-sm" style={{ background: TL_TONE[st] }} />{STATUS_LABEL[st]}</span>)}
        <span className="inline-flex items-center gap-1"><i className="inline-block h-2.5 w-4 rounded-sm bg-slate-300/60" />배정~마감(시작일 없음)</span>
        <span className="inline-flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm ring-2 ring-red-500" />기한 지남</span>
      </div>
      {/* 휴대폰: 기간 목록 */}
      <ul className="divide-y divide-line sm:hidden" data-testid="timeline-list">
        {!rows.length && <li className="p-6 text-center text-sm text-ink-2">날짜가 있는 업무가 없습니다</li>}
        {rows.map((t) => { const { s, e, implied } = span(t); return (
          <li key={t.id} className="flex items-center gap-2 px-3 py-2 text-sm" data-task-id={t.id}>
            <span className="w-1 self-stretch rounded" style={{ background: TL_TONE[t.status] }} />
            <span className="min-w-0 flex-1"><TaskLink id={t.id} className="block truncate font-medium">{t.title}</TaskLink>
              <span className={cx('text-xs tabular-nums', t.status !== 'done' && e < today ? 'font-semibold text-red-600' : 'text-ink-2')}>{fmtDate(implied ?? s)}{(implied ?? s) !== e ? ` ~ ${fmtDate(e)}` : ''} · {STATUS_LABEL[t.status]}{t.assignee_name ? ` · ${t.assignee_name}` : ''}</span></span>
          </li>); })}
      </ul>
      <div className="hidden overflow-x-auto sm:block">
        <div style={{ minWidth: leftW + Math.max(560, DAYS * (zoom === '2w' ? 56 : zoom === '6w' ? 22 : 10)) }}>
          <div className="flex border-b border-line bg-slate-50 text-[11px] text-ink-2">
            <div className="relative shrink-0 px-3 py-1.5 font-medium" style={{ width: leftW }}>업무
              <span role="separator" aria-label="업무 열 폭 조절" className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-accent-500/40"
                onPointerDown={(e) => { e.preventDefault(); setResize({ x0: e.clientX, w0: leftW }); }} />
            </div>
            <div className="grid flex-1" style={{ gridTemplateColumns: `repeat(${DAYS}, 1fr)` }}>
              {days.map((d) => <div key={d} className={cx('border-l border-line py-1.5 text-center tabular-nums', [0, 6].includes(new Date(d + 'T00:00:00Z').getUTCDay()) && 'bg-slate-100/70 text-ink-3', d === today && '!bg-accent-600 font-bold !text-white')}>{label(d)}</div>)}
            </div>
          </div>
          {!rows.length && <div className="p-8 text-center text-sm text-ink-2">날짜가 있는 업무가 없습니다</div>}
          {rows.map((t) => {
            const { s, e, implied } = span(t);
            let from = diffDays(anchor, s), to = diffDays(anchor, e);
            const imFrom = implied ? Math.max(0, diffDays(anchor, implied)) : null;
            const dx = drag?.id === t.id ? drag.dx : 0;
            const visible = to >= 0 && from < DAYS;
            from = Math.max(0, from); to = Math.min(DAYS - 1, to);
            const narrow = (to - from + 1) * (zoom === '2w' ? 56 : zoom === '6w' ? 22 : 10) < 110; // 좁으면 제목을 막대 밖에
            const late = t.status !== 'done' && e < today;
            const tip = `${t.title}\n${implied ? `배정 ${implied} → ` : ''}${s === e ? `마감 ${e}` : `${s} ~ ${e}`} · ${STATUS_LABEL[t.status]}${t.assignee_name ? ` · ${t.assignee_name}` : ''}`;
            return (
              <div key={t.id} className="flex border-b border-line text-xs last:border-b-0 hover:bg-slate-50" data-task-id={t.id}>
                <span className="flex shrink-0 items-center gap-2 px-3 py-2" style={{ width: leftW }}>
                  <Avatar id={t.assignee_id} name={t.assignee_name} size={20} />
                  <TaskLink id={t.id} className="truncate font-medium text-ink hover:underline">{t.title}</TaskLink>
                </span>
                <div ref={gridRef} className="relative min-h-[36px] flex-1">
                  {todayIdx >= 0 && todayIdx < DAYS && <span className="pointer-events-none absolute inset-y-0 w-px bg-accent-500/70" style={{ left: pct(todayIdx + 0.5) }} aria-hidden data-today-line />}
                  {visible && imFrom !== null && imFrom < from && (
                    <div className="pointer-events-none absolute top-1/2 h-4 -translate-y-1/2 rounded-l-md" style={{ left: pct(imFrom), width: pct(from - imFrom), background: TL_TONE[t.status], opacity: 0.22 }} data-implied />
                  )}
                  {visible && t.task_type === 'milestone' && (
                    <div className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] bg-violet-500 shadow-card"
                      style={{ left: `calc(${((to + 0.5) / DAYS) * 100}% + ${drag?.id === t.id ? dx : 0}px)`, cursor: 'grab' }}
                      onPointerDown={(ev) => { (ev.target as HTMLElement).setPointerCapture?.(ev.pointerId); setDrag({ id: t.id, kind: 'move', x0: ev.clientX, dx: 0 }); }}
                      title={`${s} ~ ${e}`} aria-label={`마일스톤 ${t.title}`} />
                  )}
                  {visible && t.task_type !== 'milestone' && (
                    <div className={cx('absolute top-1/2 flex h-6 -translate-y-1/2 select-none items-center rounded-md px-1.5 text-[11px] font-medium text-white shadow-card touch-none', late && 'ring-2 ring-red-500')}
                      data-bar style={{ background: TL_TONE[t.status], left: `calc(${pct(from)} + ${drag?.id === t.id && drag.kind === 'move' ? dx : 0}px)`, width: `calc(${pct(to - from + 1)} + ${drag?.id === t.id && drag.kind === 'end' ? dx : 0}px)`, cursor: 'grab' }}
                      onPointerDown={(ev) => { (ev.target as HTMLElement).setPointerCapture?.(ev.pointerId); setDrag({ id: t.id, kind: 'move', x0: ev.clientX, dx: 0 }); }}
                      title={tip} data-range={`${s} ~ ${e}`} aria-label={tip}>
                      {!narrow && <span className="truncate">{t.title}</span>}
                      {narrow && <span className="pointer-events-none absolute left-full top-1/2 ml-1.5 -translate-y-1/2 whitespace-nowrap font-medium text-ink" data-outside-title>{t.title}</span>}
                      <span className="absolute right-0 top-0 h-full w-2 cursor-ew-resize rounded-r bg-black/20"
                        onPointerDown={(ev) => { ev.stopPropagation(); setDrag({ id: t.id, kind: 'end', x0: ev.clientX, dx: 0 }); }} aria-label="마감일 조정" />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** B-3 프로젝트 목록: 섹션별 묶음, 섹션 추가·이름 변경·순서·삭제, 업무를 끌어 다른 섹션으로 이동, 섹션마다 업무 추가 */
function SectionedList({ projectId, sections, tasks, onPatch, reloadSections, reloadTasks }: {
  projectId: string; sections: Section[]; tasks: Task[]; onPatch: (t: Task, b: any) => void; reloadSections: () => void; reloadTasks: () => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }));
  const [adding, setAdding] = useState<string | null | undefined>(undefined); // 업무 추가할 섹션 (null = 섹션 없음)
  const groups = [...sections.map((s) => ({ id: s.id as string | null, name: s.name })), { id: null, name: '섹션 없음' }];
  async function call(fn: () => Promise<unknown>) { try { await fn(); reloadSections(); reloadTasks(); } catch (e: any) { toast.error(e.message); } }
  const end = (e: DragEndEvent) => {
    const t = e.active.data.current as Task;
    const to = e.over?.id as string | undefined;
    if (!t || !to) return;
    const sec = to === 'section:none' ? null : to.slice(8);
    if ((t.section_id ?? null) !== sec) onPatch(t, { sectionId: sec });
  };
  return (
    <DndContext sensors={sensors} onDragEnd={end}>
      <div className="space-y-3" data-testid="sectioned-list">
        {groups.map((g, i) => {
          const items = tasks.filter((t) => (t.section_id ?? null) === g.id);
          if (g.id === null && !items.length && sections.length) return null;
          return (
            <SectionGroup key={g.id ?? 'none'} id={g.id} name={g.name} count={items.length}
              onRename={g.id ? (name) => call(() => api(`/api/sections/${g.id}`, { method: 'PATCH', body: { name } })) : undefined}
              onDelete={g.id ? () => confirm(`'${g.name}' 섹션을 삭제할까요? 업무는 '섹션 없음'으로 옮겨집니다.`) && call(() => api(`/api/sections/${g.id}`, { method: 'DELETE' })) : undefined}
              onMove={g.id ? (dir) => {
                const j = i + dir; if (j < 0 || j >= sections.length) return;
                const a = sections[i], b = sections[j];
                call(async () => { await api(`/api/sections/${a.id}`, { method: 'PATCH', body: { sort: b.sort } }); await api(`/api/sections/${b.id}`, { method: 'PATCH', body: { sort: a.sort } }); });
              } : undefined}
              onAdd={() => setAdding(g.id)}>
              {items.map((t) => <DraggableRow key={t.id} t={t} onPatch={onPatch} />)}
              {!items.length && <div className="px-4 py-3 text-center text-xs text-ink-3">업무를 여기로 끌어 오거나 아래에 바로 추가하세요</div>}
              <InlineAddTask projectId={projectId} sectionId={g.id} placeholder={`${g.name}에 업무 추가 — 제목 입력 후 Enter`} />
            </SectionGroup>
          );
        })}
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget; const name = (f.elements.namedItem('sec') as HTMLInputElement).value.trim(); if (name) call(() => api(`/api/projects/${projectId}/sections`, { body: { name } })).then(() => f.reset()); }}>
          <input name="sec" className={cx(inputCls, 'max-w-xs')} placeholder="새 섹션 이름 (예: 준비, 진행, 마감)" aria-label="새 섹션 이름" />
          <Button type="submit" variant="secondary" size="sm">+ 섹션 추가</Button>
        </form>
      </div>
      <QuickAddTask open={adding !== undefined} onClose={() => setAdding(undefined)} defaults={{ projectId, sectionId: adding ?? undefined }} onCreated={() => { setAdding(undefined); reloadTasks(); }} />
    </DndContext>
  );
}

function SectionGroup({ id, name, count, children, onRename, onDelete, onMove, onAdd }: {
  id: string | null; name: string; count: number; children: React.ReactNode;
  onRename?: (n: string) => void; onDelete?: () => void; onMove?: (d: -1 | 1) => void; onAdd: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: id ? `section:${id}` : 'section:none' });
  const [edit, setEdit] = useState(false);
  return (
    <section ref={setNodeRef} className={cx('overflow-hidden rounded-card border border-line bg-white shadow-card', isOver && 'ring-2 ring-accent-500/40')} data-section={id ?? 'none'}>
      <div className="flex items-center gap-1 border-b border-line bg-slate-50/60 px-3 py-1.5">
        {edit && onRename ? (
          <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); (e.currentTarget.elements.namedItem('n') as HTMLInputElement).blur(); }}>
            {/* 저장 버튼 없이: Enter 또는 칸을 벗어나면 저장, Esc 취소 */}
            <input name="n" defaultValue={name} autoFocus enterKeyHint="done" className="rounded border px-2 py-0.5 text-sm" aria-label="섹션 이름"
              onKeyDown={(e) => { if (e.key === 'Escape') { (e.currentTarget as HTMLInputElement).dataset.cancel = '1'; setEdit(false); } }}
              onBlur={(e) => { const v = e.currentTarget.value.trim(); if (e.currentTarget.dataset.cancel !== '1' && v && v !== name) onRename(v); setEdit(false); }} />
          </form>
        ) : <h2 className="flex items-center gap-2 text-sm font-semibold" onDoubleClick={() => onRename && setEdit(true)}>{name} <span className="rounded-full bg-white px-1.5 text-xs font-medium text-ink-2 shadow-card tabular-nums">{count}</span></h2>}
        <span className="flex-1" />
        <Button size="sm" variant="ghost" onClick={onAdd}>+ 업무 추가</Button>
        {onRename && !edit && <Button size="sm" variant="ghost" onClick={() => setEdit(true)}>이름 변경</Button>}
        {onMove && <><Button size="sm" variant="ghost" onClick={() => onMove(-1)} aria-label={`${name} 위로`}>↑</Button><Button size="sm" variant="ghost" onClick={() => onMove(1)} aria-label={`${name} 아래로`}>↓</Button></>}
        {onDelete && <Button size="sm" variant="ghost" className="text-red-600" onClick={onDelete}>삭제</Button>}
      </div>
      <div className="divide-y divide-line">{children}</div>
    </section>
  );
}

function DraggableRow({ t, onPatch }: { t: Task; onPatch: (t: Task, b: any) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: t.id, data: t });
  return (
    <div ref={setNodeRef} style={transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined}
      className={cx('group flex min-h-[44px] items-center gap-2.5 bg-white px-2 py-2 hover:bg-slate-50', isDragging && 'relative z-50 opacity-90 shadow-pop')} data-task-id={t.id}>
      <span {...listeners} {...attributes} className="cursor-grab touch-none select-none px-0.5 text-slate-300 group-hover:text-slate-500" aria-label={`${t.title} 끌어서 이동`}><GripVertical className="size-4" /></span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-3">
        <span className="flex min-w-0 items-center gap-1.5 sm:max-w-[55%] sm:shrink-0">
          <TypeIcon t={t} />
          <TaskLink id={t.id} className={cx('truncate text-sm font-medium text-ink hover:text-accent-600 hover:underline', t.status === 'done' && 'text-ink-3 line-through')}>{t.title}</TaskLink>
        </span>
        <Meta t={t} compact />
      </div>
      <span className="hidden w-[60px] justify-end sm:flex"><PriorityTag p={t.priority} /></span>
      <StatusChip t={t} onPatch={onPatch} />
      <span className="hidden sm:inline-flex"><DueEdit t={t} onPatch={onPatch} /></span>
      <AssigneePicker value={t.assignee_id} name={t.assignee_name} onChange={(v) => onPatch(t, { assigneeId: v })} />
    </div>
  );
}

/** 보드 열 = 섹션 */
function SectionBoard({ sections, tasks, onPatch }: { sections: Section[]; tasks: Task[]; onPatch: (t: Task, b: any) => void }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }));
  const cols = [...sections.map((s) => ({ id: s.id as string | null, name: s.name })), { id: null, name: '섹션 없음' }];
  const end = (e: DragEndEvent) => {
    const t = e.active.data.current as Task;
    const to = e.over?.id as string | undefined;
    if (!t || !to) return;
    const sec = to === 'section:none' ? null : to.slice(8);
    if ((t.section_id ?? null) !== sec) onPatch(t, { sectionId: sec });
  };
  return (
    <DndContext sensors={sensors} onDragEnd={end}>
      <div className="flex gap-3 overflow-x-auto pb-2" data-testid="section-board">
        {cols.map((c) => <SectionColumn key={c.id ?? 'none'} id={c.id} name={c.name} tasks={tasks.filter((t) => (t.section_id ?? null) === c.id)} />)}
      </div>
    </DndContext>
  );
}
function SectionColumn({ id, name, tasks }: { id: string | null; name: string; tasks: Task[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: id ? `section:${id}` : 'section:none' });
  return (
    <div ref={setNodeRef} className={cx('flex w-72 shrink-0 flex-col rounded-lg p-2', isOver ? 'bg-brand-100' : 'bg-slate-100')} data-column={`section:${id ?? 'none'}`}>
      <div className="mb-2 flex items-center justify-between px-1 text-sm font-semibold">{name}<span className="text-xs font-normal text-slate-500">{tasks.length}</span></div>
      <div className="flex min-h-[80px] flex-col gap-2">{tasks.map((t) => <BoardCard key={t.id} t={t} />)}</div>
    </div>
  );
}

/** 밀어서 완료 설정(이 기기): 기본 꺼짐 */
export function useSwipeSetting() {
  const [on, setOn] = useState(false);
  useEffect(() => { try { setOn(localStorage.getItem('wos_swipe_done') === '1'); } catch {} }, []);
  return on;
}
function SwipeHint({ sortable }: { sortable: boolean }) {
  const on = useSwipeSetting();
  // V14 34번: 순서 바꾸기 안내는 "직접 순서"일 때만(⇅ 로 이동). 마감일순(기본)에서는 길게 누르면 선택
  const text = sortable ? (on ? '행을 오른쪽 끝까지 밀면 완료 · ⇅ 로 순서 바꾸기' : '⇅ 버튼으로 순서 바꾸기 · 꾹 누르면 선택') : on ? '행을 오른쪽 끝까지 밀면 완료 · 꾹 누르면 선택' : null;
  return text ? <p className="border-b border-line bg-slate-50 px-3 py-1 text-[11px] text-ink-3 sm:hidden">{text}</p> : null;
}

/** V6 6번 엑셀 내려받기: 화면 필터 그대로 + 기간(마감일·완료일·생성일 기준) */
function ExportTasks({ qs, onClose }: { qs: string; onClose: () => void }) {
  const today = todayStr();
  const ym = today.slice(0, 7);
  const lastM = (() => { const d = new Date(ym + '-01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); })();
  const endOf = (m: string) => { const d = new Date(m + '-01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0); return d.toISOString().slice(0, 10); };
  const [basis, setBasis] = useState<'due' | 'done' | 'created'>('due');
  const [range, setRange] = useState<'this' | 'last' | 'year' | 'all' | 'custom'>('this');
  const [start, setStart] = useState(ym + '-01'); const [end, setEnd] = useState(endOf(ym));
  const [split, setSplit] = useState(false);
  const period = range === 'this' ? [ym + '-01', endOf(ym)] : range === 'last' ? [lastM + '-01', endOf(lastM)] : range === 'year' ? [today.slice(0, 4) + '-01-01', today.slice(0, 4) + '-12-31'] : range === 'custom' ? [start, end] : [null, null];
  const p = new URLSearchParams(qs); p.delete('includeDone'); p.delete('limit');
  p.set('basis', basis); if (period[0]) p.set('start', period[0]); if (period[1]) p.set('end', period[1]); if (split) p.set('split', '1');
  const url = `/api/export/tasks?${p}`;
  return (
    <Modal open onClose={onClose} title="업무 엑셀로 내려받기">
      <div className="space-y-3 text-sm" data-testid="export-tasks">
        <p className="text-ink-2">지금 화면의 사람·상태·검색 조건이 그대로 적용됩니다. 삭제한 업무는 빠집니다.</p>
        <label className="flex items-center gap-2">기준<select className={inputCls} value={basis} onChange={(e) => setBasis(e.target.value as typeof basis)} aria-label="기간 기준"><option value="due">마감일</option><option value="done">완료일</option><option value="created">만든 날</option></select></label>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="기간">
          {([['this', '이번 달'], ['last', '지난달'], ['year', '올해'], ['all', '전체'], ['custom', '직접']] as const).map(([k, l]) => (
            <button key={k} type="button" aria-pressed={range === k} onClick={() => setRange(k)} className={cx('rounded-full border px-3 py-1 text-xs font-medium', range === k ? 'border-brand-600 bg-brand-600 text-white' : 'border-line')}>{l}</button>
          ))}
        </div>
        {range === 'custom' && <div className="flex items-center gap-2"><input type="date" className={inputCls} value={start} onChange={(e) => setStart(e.target.value)} aria-label="시작" />~<input type="date" className={inputCls} value={end} onChange={(e) => setEnd(e.target.value)} aria-label="끝" /></div>}
        <label className="flex items-center gap-2"><input type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} />완료 업무를 월별 시트로도 나누기</label>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>닫기</Button>
          <a href={url} onClick={() => setTimeout(onClose, 300)} className="inline-flex h-9 items-center gap-1.5 rounded-input bg-brand-600 px-4 font-semibold text-white" data-testid="export-download"><FileSpreadsheet className="size-4" />내려받기 (.xlsx)</a>
        </div>
      </div>
    </Modal>
  );
}

/** V14 12번 선택한 업무 작업 막대: 담당자·마감·프로젝트 변경, (본인 업무만) 완료, 휴지통. 권한 없는 건 건너뛰고 안내, 되돌리기 */
function BulkBar({ ids, tasks, onClear, onDone }: { ids: string[]; tasks: Task[]; onClear: () => void; onDone: (action: 'patch' | 'done' | 'delete' | 'undo', done: string[]) => void }) {
  const { dir } = useSession();
  const projects = useApi<{ projects: { id: string; name: string }[] }>('/api/projects');
  const [busy, setBusy] = useState(false);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  async function run(action: 'patch' | 'done' | 'delete', patch?: Record<string, unknown>, label?: string) {
    if (!ids.length) return;
    if (action === 'delete' && !confirm(`${ids.length}건을 휴지통으로 옮길까요?`)) return;
    setBusy(true);
    // 되돌리기용 이전 값
    const key = patch ? Object.keys(patch)[0] : 'status';
    const col: Record<string, keyof Task> = { assigneeId: 'assignee_id', dueDate: 'due_date', projectId: 'project_id', status: 'status' };
    const before = Object.fromEntries(ids.map((id) => [id, { [key]: (byId.get(id) as any)?.[col[key]] ?? null }]));
    try {
      const r = await api('/api/tasks/bulk', { body: { ids, action, ...(patch ? { patch } : {}) } });
      const msg = `${r.done.length}건 ${label ?? '바꿨습니다'}${r.skipped.length ? ` · ${r.skipped.length}건 건너뜀` : ''}`;
      const undo = r.done.length ? { label: '되돌리기', run: async () => {
        const back = action === 'delete' ? { ids: r.done, action: 'restore' } : { ids: r.done, action: 'patch', each: Object.fromEntries(r.done.map((id: string) => [id, before[id]])) };
        try { await api('/api/tasks/bulk', { body: back }); onDone('undo', []); toast.ok('되돌렸습니다'); } catch (e: any) { toast.error(e.message); }
      } } : undefined;
      toast.ok(msg, undo);
      if (r.skipped.length) toast.info(`건너뜀: ${r.skipped.slice(0, 3).map((s: any) => `${s.title}(${s.reason})`).join(', ')}${r.skipped.length > 3 ? ' 외' : ''}`);
      onDone(action, r.done);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  // V14 40번(휴대폰): "n건 완료 · 되돌리기" 안내가 이 막대의 삭제·완료 버튼을 덮어 터치를 가로채던 문제 → 막대가 떠 있는 동안 안내를 막대 위로
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = document.documentElement;
    const fit = () => { const el = bar.current; root.style.setProperty('--toast-lift', el && window.innerWidth < 640 ? `${el.offsetHeight}px` : '0px'); };
    fit();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
    if (bar.current) ro?.observe(bar.current);
    return () => { ro?.disconnect(); root.style.removeProperty('--toast-lift'); };
  }, []);
  return (
    <div ref={bar} className="fixed inset-x-2 bottom-[calc(4.5rem+var(--sab))] z-40 flex flex-wrap items-center gap-2 rounded-card border border-line bg-white p-2 shadow-pop sm:inset-x-auto sm:bottom-4 sm:left-1/2 sm:-translate-x-1/2" role="toolbar" aria-label="선택한 업무" data-testid="bulk-bar">
      <b className="px-1 text-sm" data-testid="bulk-count">{ids.length}건 선택</b>
      <select className="h-8 max-w-[9rem] rounded-input border border-line bg-white px-1.5 text-xs" value="" disabled={busy || !ids.length} onChange={(e) => e.target.value && run('patch', { assigneeId: e.target.value === '-' ? null : e.target.value }, '담당자 변경')} aria-label="담당자 바꾸기">
        <option value="">담당자…</option><option value="-">담당자 없음</option>{dir.users.map((u) => <option key={u.id} value={u.id}>{u.name}{u.title ? ` · ${u.title}` : ''}</option>)}
      </select>
      <input type="date" className="h-8 rounded-input border border-line bg-white px-1.5 text-xs" disabled={busy || !ids.length} onChange={(e) => e.target.value && run('patch', { dueDate: e.target.value }, '마감 변경')} aria-label="마감 바꾸기" />
      <select className="h-8 max-w-[9rem] rounded-input border border-line bg-white px-1.5 text-xs" value="" disabled={busy || !ids.length} onChange={(e) => e.target.value && run('patch', { projectId: e.target.value === '-' ? null : e.target.value }, '프로젝트 변경')} aria-label="프로젝트 바꾸기">
        <option value="">프로젝트…</option><option value="-">프로젝트 없음</option>{projects.data?.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <Button size="sm" variant="secondary" disabled={busy || !ids.length} onClick={() => run('done', undefined, '완료')} data-testid="bulk-done">완료</Button>
      <Button size="sm" variant="danger" disabled={busy || !ids.length} onClick={() => run('delete', undefined, '휴지통으로')} data-testid="bulk-delete">삭제</Button>
      <Button size="sm" variant="ghost" onClick={onClear}>취소</Button>
    </div>
  );
}
