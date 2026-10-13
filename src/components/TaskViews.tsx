'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { DndContext, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
import { api, broadcastRefresh, useApi } from './client';
import { useSession } from './session';
import {
  CalendarDays as CalIcon, Camera, CheckCheck, ChevronDown, CircleCheck, Diamond, GanttChart, KanbanSquare, LayoutList, ListChecks, MessageSquare, Paperclip,
  GripVertical, Plus, Repeat, Search, SlidersHorizontal, Stamp, X,
} from 'lucide-react';
import { Avatar, BrandDot, Button, DueChip, Empty, ErrorBox, PriorityTag, STATUS_TONE, Skeleton, StatusBadge, cx, fmtDate, inputCls, toast, todayStr } from './ui';
import { HIDDEN_BRANDS, STATUSES, STATUS_LABEL, type TaskStatus } from '@/lib/types';
import { UnitSelect } from './pickers';
import { TaskDetail } from './TaskDetail';
import { AssigneePicker, DuePicker, InlineAddTask, OrderMenu, PriorityPicker, isFresh, quickDues } from './TaskQuick';
import { QuickAddTask } from './QuickAddTask';

export type Task = {
  id: string; title: string; status: TaskStatus; priority: any; project_id: string | null; project_name: string | null; project_color: string | null;
  org_unit_id: string; org_unit_name: string; brand_id: string | null; assignee_id: string | null; assignee_name: string | null;
  start_date: string | null; due_date: string | null; due_time: string | null; version: number; subtask_count: number; subtask_done: number;
  checklist_total: number; checklist_done: number; comment_count: number; attachment_count: number; blocked_by_count: number;
  recurrence_rule: string | null; approval_required: boolean; tags: string[];
  section_id?: string | null; assignee_ack_at?: string | null; created_by?: string; sort_order?: number;
  task_type?: 'normal' | 'milestone' | 'approval' | 'inspection'; approval_line_id?: string | null; photo_required?: number; photo_count?: number;
  fields?: Record<string, unknown>;
  requested_by?: string | null; requested_by_name?: string | null; created_at?: string;
};

/** B-1 업무를 목록 옆 오른쪽 패널로 연다. URL 은 /tasks/:id 로 바꿔 새로고침·공유가 가능하다. 새 탭(Ctrl/⌘/가운데 클릭)은 그대로 전체 화면 */
const OpenTaskCtx = createContext<(id: string) => void>(() => {});
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
const LIST_VIEWS = ['all', 'my', 'today', 'overdue', 'week', 'review', 'risk'];
const cleanView = (v: string | null) => (v && LIST_VIEWS.includes(v) ? v : '');

export function TaskViews({ fixed, title, defaultMode = 'list' }: { fixed?: Record<string, string>; title?: string; defaultMode?: ViewMode }) {
  const sp = useSearchParams();
  const router = useRouter();
  const { dir } = useSession();
  const [mode, setMode] = useState<ViewMode>(() => {
    // U-0a ?view=board 처럼 보기 이름이 view 로 들어와도 화면 보기로 해석, 모르는 값은 기본 보기
    const m = sp.get('mode') ?? sp.get('view');
    return VIEW_MODES.includes(m as ViewMode) ? (m as ViewMode) : defaultMode;
  });
  const [q, setQ] = useState(sp.get('q') ?? '');
  const [filters, setFilters] = useState<Record<string, string>>(() => {
    const f: Record<string, string> = {};
    for (const k of ['brandId', 'orgUnitId', 'assigneeId', 'status', 'from', 'to']) { const v = sp.get(k); if (v) f[k] = v; }
    const v = cleanView(sp.get('view')); if (v) f.view = v;
    return f;
  });
  const [showDone, setShowDone] = useState(sp.get('done') === '1');
  // 묶기: 담당자별(기본) · 마감일 · 프로젝트 · 묶지 않음. "내 업무"는 마감일 묶음(새로 배정됨 확인 포함)이 기본
  const [groupPick, setGroupPick] = useState<GroupBy | ''>(() => {
    const g = sp.get('group'); if (GROUPS.includes(g as GroupBy)) return g as GroupBy;
    try { const v = localStorage.getItem('wos_task_group'); return GROUPS.includes(v as GroupBy) ? (v as GroupBy) : ''; } catch { return ''; }
  });
  const [adding, setAdding] = useState(false);
  // 정렬: 직접 순서(기본)·마감일·우선순위·최근 생성 … 사용자별(이 기기) 기억
  const [sortBy, setSortBy] = useState<SortKey>(() => { try { const v = localStorage.getItem('wos_task_sort'); return SORTS.includes(v as SortKey) ? (v as SortKey) : 'manual'; } catch { return 'manual'; } });
  const pickSort = (k: SortKey) => { setSortBy(k); try { localStorage.setItem('wos_task_sort', k); } catch {} };
  const [quickOpen, setQuickOpen] = useState(false);
  useEffect(() => { // URL 변경(메뉴 이동) 반영 — 패널로 /tasks/:id 가 된 동안에는 목록 필터를 그대로 둔다
    if (/^\/tasks\/[0-9a-f-]{36}$/.test(location.pathname)) return;
    const v = cleanView(sp.get('view'));
    setFilters((f) => ((f.view ?? '') === v ? f : { ...f, view: v }));
  }, [sp]);

  const qs = useMemo(() => {
    const p = new URLSearchParams({ ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)), ...(fixed ?? {}) });
    if (q) p.set('q', q);
    if (!showDone && mode !== 'board' && !filters.status) p.set('includeDone', '0');
    return p.toString();
  }, [filters, fixed, q, showDone, mode]);
  const { data, error, loading, reload, setData } = useApi<{ tasks: Task[] }>(`/api/tasks?${qs}`);
  const tasks = useMemo(() => sortTasks(data?.tasks ?? [], sortBy), [data, sortBy]);

  useEffect(() => {
    const p = new URLSearchParams(sp.toString());
    p.set('mode', mode);
    router.replace(`?${p}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  /** 모든 보기에서 같은 경로로 원본 업무를 수정 → 다른 보기에도 즉시 반영 */
  async function patch(t: Task, body: Record<string, unknown>) {
    const before = data;
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
    window.history.pushState({ wosPanel: id }, '', `/tasks/${id}`);
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
    window.addEventListener('popstate', onPop);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('popstate', onPop); window.removeEventListener('keydown', onKey); };
  }, [panelId, closePanel]);

  // B-3 프로젝트 섹션
  const projectId = fixed?.projectId;
  const sectionsApi = useApi<{ sections: Section[] }>(projectId ? `/api/projects/${projectId}/sections` : null);
  const sections = sectionsApi.data?.sections ?? [];
  const [boardBy, setBoardBy] = useState<'status' | 'section'>('status');

  const curView = fixed?.view ?? filters.view ?? '';
  const group: GroupBy = groupPick || (curView === 'my' ? 'due' : 'assignee');
  const pickGroup = (g: GroupBy) => { setGroupPick(g); try { localStorage.setItem('wos_task_group', g); } catch {} };
  // 상단 칩: 전체 · 내 업무 · 사람별 · 지연 · 이번 주 · 검토 대기. 사람 칩은 본사 사람(없으면 앞쪽 5명)
  const hqIds = new Set(dir.orgUnits.filter((o) => o.type === 'hq').map((o) => o.id));
  const people = (() => {
    const hq = dir.users.filter((u) => u.org_unit_ids?.some((id) => hqIds.has(id)));
    return (hq.length ? hq : dir.users).slice(0, 5);
  })();
  const views: [string, string][] = [['', '전체'], ['my', '내 업무'], ['requested', '내가 지시한 업무'], ['overdue', '지연'], ['week', '이번 주'], ['review', '검토 대기']];
  const setView = (v: string) => setFilters((f) => ({ ...f, view: v, assigneeId: '' }));
  const [filterOpen, setFilterOpen] = useState(false);
  const unitName = (id: string) => dir.orgUnits.find((o) => o.id === id)?.name ?? '';
  const chips: [string, string][] = [
    ...(filters.brandId ? [['brandId', `브랜드: ${dir.brands.find((b) => b.id === filters.brandId)?.name ?? filters.brandId}`]] : []),
    ...(filters.orgUnitId ? [['orgUnitId', `소속: ${unitName(filters.orgUnitId)}`]] : []),
    ...(filters.assigneeId ? [['assigneeId', `담당: ${dir.users.find((u) => u.id === filters.assigneeId)?.name ?? ''}`]] : []),
    ...(filters.status ? [['status', `상태: ${filters.status.split(',').map((x) => STATUS_LABEL[x as TaskStatus] ?? x).join('·')}`]] : []),
    ...(filters.from || filters.to ? [['period', `기간: ${filters.from ? fmtDate(filters.from) : '처음'} ~ ${filters.to ? fmtDate(filters.to) : '끝'}`]] : []),
  ] as [string, string][];
  const clearChip = (k: string) => setFilters((f) => (k === 'period' ? { ...f, from: '', to: '' } : { ...f, [k]: '' }));
  const MODES: [ViewMode, string, typeof LayoutList][] = [['list', '목록', LayoutList], ['board', '보드', KanbanSquare], ['calendar', '캘린더', CalIcon], ['timeline', '타임라인', GanttChart]];

  return (
    <OpenTaskCtx.Provider value={openTask}>
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold tracking-tight">{title ?? '업무'}</h1>
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
        <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 pb-0.5 text-sm sm:mx-0 sm:px-0">
          {views.slice(0, 3).map(([v, l]) => <ViewChip key={v} on={(filters.view ?? '') === v && !filters.assigneeId} onClick={() => setView(v)}>{l}</ViewChip>)}
          {people.map((u) => (
            <ViewChip key={u.id} on={filters.assigneeId === u.id} onClick={() => setFilters((f) => ({ ...f, view: '', assigneeId: f.assigneeId === u.id ? '' : u.id }))} label={`${u.name} 업무`}>
              <Avatar id={u.id} name={u.name} size={18} />{u.name}
            </ViewChip>
          ))}
          {views.slice(3).map(([v, l]) => <ViewChip key={v} on={(filters.view ?? '') === v && !filters.assigneeId} onClick={() => setView(v)}>{l}</ViewChip>)}
          {!views.some(([v]) => v === (filters.view ?? '')) && <ViewChip on onClick={() => setView('')}>{({ today: '오늘 할 일', risk: '마감 위험' } as Record<string, string>)[filters.view ?? ''] ?? filters.view}</ViewChip>}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => (mode === 'list' ? setAdding(true) : setQuickOpen(true))} data-testid="add-task-top"><Plus />업무 추가</Button>
        <div className="relative min-w-[160px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
          <input className={cx(inputCls, 'h-9 pl-8')} placeholder="제목·설명·태그 검색" value={q} onChange={(e) => setQ(e.target.value)} aria-label="업무 검색" />
        </div>
        <Button variant="secondary" onClick={() => setFilterOpen(!filterOpen)} aria-expanded={filterOpen} data-testid="filter-toggle">
          <SlidersHorizontal />필터{chips.length > 0 && <span className="rounded-full bg-brand-600 px-1.5 text-[11px] leading-4 text-white">{chips.length}</span>}
          <ChevronDown className={cx('!size-3.5 transition-transform', filterOpen && 'rotate-180')} />
        </Button>
        {mode === 'list' && !projectId && (
          <label className="inline-flex h-9 items-center gap-1.5 text-sm text-ink-2">묶기
            <select className="h-9 rounded-input border border-line bg-white px-2 text-sm" value={group} onChange={(e) => pickGroup(e.target.value as GroupBy)} aria-label="묶기 기준" data-testid="group-by">
              <option value="assignee">담당자별</option><option value="requester">지시자별</option><option value="due">마감일</option><option value="project">프로젝트</option><option value="none">묶지 않음</option>
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
        {mode !== 'board' && (
          <label className="inline-flex h-9 cursor-pointer select-none items-center gap-2 rounded-input px-2 text-sm text-ink-2 hover:bg-slate-100">
            <input type="checkbox" className="size-4 rounded accent-brand-600" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />완료된 업무도 보기
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
            <option value="">모든 담당자</option>{dir.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <select className={inputCls} value={filters.status ?? ''} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} aria-label="상태">
            <option value="">모든 상태</option>{STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
          <input type="date" className={inputCls} value={filters.from ?? ''} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} aria-label="기간 시작" />
          <input type="date" className={inputCls} value={filters.to ?? ''} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} aria-label="기간 끝" />
        </div>
      )}
      {error ? <ErrorBox error={error} retry={reload} /> : loading && !data ? <Skeleton /> : (
        <>
          {mode === 'list' && projectId && adding && <div className="overflow-hidden rounded-card border border-line bg-white shadow-card"><InlineAddTask autoFocus projectId={projectId} onEscape={() => setAdding(false)} /></div>}
          {mode === 'list' && (projectId ? <SectionedList projectId={projectId} sections={sections} tasks={tasks} onPatch={patch} reloadSections={sectionsApi.reload} reloadTasks={reload} />
            : <GroupedTasks tasks={tasks} group={group} view={curView} assigneeFilter={filters.assigneeId || null} onPatch={patch} onAcked={reload}
                people={people} sortBy={sortBy} onSort={pickSort} onReorder={reorder}
                top={adding ? <InlineAddTask autoFocus defaultAssignee={filters.assigneeId || undefined} onEscape={() => setAdding(false)} placeholder="업무 이름 입력 후 Enter — 저장하고 다음 줄, Esc 로 끝내기" /> : null} />)}
          {mode === 'board' && projectId && (
            <div className="flex items-center gap-2 text-sm text-ink-2">열 기준
              <select className="h-8 rounded-input border border-line bg-white px-2 text-sm" value={boardBy} onChange={(e) => setBoardBy(e.target.value as any)} aria-label="보드 열 기준">
                <option value="status">상태</option><option value="section">섹션</option>
              </select>
            </div>
          )}
          {mode === 'board' && (boardBy === 'section' && projectId ? <SectionBoard sections={sections} tasks={tasks} onPatch={patch} /> : <BoardView tasks={tasks} onPatch={patch} />)}
          {mode === 'calendar' && <CalendarView tasks={tasks} onPatch={patch} />}
          {mode === 'timeline' && <TimelineView tasks={tasks} onPatch={patch} />}
        </>
      )}
    </div>
    <QuickAddTask open={quickOpen} onClose={() => setQuickOpen(false)} defaults={{ projectId, assigneeId: filters.assigneeId || undefined }} onCreated={() => { setQuickOpen(false); reload(); }} />
    {panelId && (
      <aside className="fixed inset-0 z-40 animate-slide-in overflow-y-auto bg-white shadow-pop sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[min(680px,100vw-240px)] sm:border-l sm:border-line" data-testid="task-panel" aria-label="업무 상세 패널">
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

function Meta({ t, compact }: { t: Task; compact?: boolean }) {
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-ink-2">
      {t.project_name && <span className="inline-flex min-w-0 items-center gap-1"><span className="size-2 shrink-0 rounded-[3px]" style={{ background: t.project_color ?? '#999' }} /><span className="truncate">{t.project_name}</span></span>}
      {t.requested_by && t.requested_by !== t.assignee_id && t.requested_by_name && <span className="truncate md:hidden" title="지시자 → 담당자">{t.requested_by_name} → {t.assignee_name ?? '미배정'}</span>}
      {!compact && <span className="truncate">{t.org_unit_name}</span>}
      {!compact && <BrandDot brand={t.brand_id} />}
      {t.subtask_count > 0 && <span className="inline-flex items-center gap-0.5 tabular-nums" title="하위 업무"><ListChecks className="size-3.5" />{t.subtask_done}/{t.subtask_count}</span>}
      {t.checklist_total > 0 && <span className="inline-flex items-center gap-0.5 tabular-nums" title="체크리스트"><CheckCheck className="size-3.5" />{t.checklist_done}/{t.checklist_total}</span>}
      {t.comment_count > 0 && <span className="inline-flex items-center gap-0.5 tabular-nums" title="댓글"><MessageSquare className="size-3.5" />{t.comment_count}</span>}
      {t.attachment_count > 0 && <span className="inline-flex items-center gap-0.5 tabular-nums" title="첨부"><Paperclip className="size-3.5" />{t.attachment_count}</span>}
      {!!t.photo_required && <span className={cx('inline-flex items-center gap-0.5 tabular-nums', (t.photo_count ?? 0) >= t.photo_required ? 'text-emerald-600' : 'text-amber-700')} title="완료 증빙 사진"><Camera className="size-3.5" />{t.photo_count ?? 0}/{t.photo_required}</span>}
      {t.recurrence_rule && <span title="반복 업무"><Repeat className="size-3.5" /></span>}
      {t.blocked_by_count > 0 && <span className="font-medium text-amber-700">선행 대기 {t.blocked_by_count}</span>}
    </span>
  );
}

/** 원형 완료 체크: 결재선·관리자 확인 업무는 "검토 요청", 아니면 완료. 완료 상태에서 누르면 다시 진행 중 */
function nextStatusOnCheck(t: Task, role: string): TaskStatus {
  if (t.status === 'done') return 'in_progress';
  if (t.status === 'review') return 'done';
  if (t.approval_line_id) return 'review';
  if (t.approval_required && role === 'staff') return 'review';
  return 'done';
}
function CheckCircle({ t, onPatch }: { t: Task; onPatch: (t: Task, b: any) => Promise<boolean> | void }) {
  const { user } = useSession();
  const to = nextStatusOnCheck(t, user.role);
  const label = t.status === 'done' ? `${t.title} 완료 취소` : to === 'review' ? `${t.title} 검토 요청` : `${t.title} 완료`;
  return (
    <button onClick={async () => {
      const before = t.status;
      const ok = await onPatch(t, { status: to });
      if (ok !== false) toast.ok(to === 'done' ? '완료했습니다' : to === 'review' ? '검토를 요청했습니다' : '다시 진행 중으로 바꿨습니다', { label: '되돌리기', run: () => onPatch({ ...t, status: to, version: t.version + 1 }, { status: before }) });
    }} aria-label={label} title={label} data-testid="check-circle"
      className={cx('group flex size-[22px] shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors',
        t.status === 'done' ? 'border-emerald-500 bg-emerald-500 text-white' : t.status === 'review' ? 'border-amber-400 bg-amber-50 text-amber-500' : 'border-slate-300 text-transparent hover:border-emerald-500 hover:text-emerald-500')}>
      {t.status === 'review' ? <Stamp className="size-3" /> : <CircleCheck className="size-[22px] stroke-[1.8]" style={{ margin: -1.5 }} />}
    </button>
  );
}
function TypeIcon({ t }: { t: Task }) {
  if (t.task_type === 'milestone') return <span title="마일스톤"><Diamond className="size-3.5 shrink-0 fill-violet-500 text-violet-500" /></span>;
  if (t.task_type === 'approval') return <span title="결재 업무"><Stamp className="size-3.5 shrink-0 text-amber-600" /></span>;
  if (t.task_type === 'inspection') return <span title="점검 업무"><Camera className="size-3.5 shrink-0 text-sky-600" /></span>;
  return null;
}
/** 상태 선택: 배지처럼 보이는 select */
function StatusSelect({ t, onPatch }: { t: Task; onPatch: (t: Task, b: any) => void }) {
  return (
    <select value={t.status} onChange={(e) => onPatch(t, { status: e.target.value })} aria-label={`${t.title} 상태`}
      className={cx('h-6 cursor-pointer appearance-none rounded-full border-0 bg-none py-0 pl-2.5 pr-2.5 text-xs font-medium focus:ring-2 focus:ring-accent-500', STATUS_TONE[t.status].badge)}>
      {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
    </select>
  );
}
/** 마감일 칩 + 그 위의 투명 날짜 입력 (눌러서 바로 변경) */
function DueEdit({ t, onPatch }: { t: Task; onPatch: (t: Task, b: any) => void }) {
  return <span className="inline-flex w-[92px] justify-end"><DuePicker value={t.due_date} status={t.status} onChange={(v) => onPatch(t, { dueDate: v })} label={`${t.title} 마감일`} /></span>;
}

type GroupBy = 'assignee' | 'requester' | 'due' | 'project' | 'none';
const GROUPS: GroupBy[] = ['assignee', 'requester', 'due', 'project', 'none'];
type SortKey = 'manual' | 'due' | 'priority' | 'created' | 'title' | 'assignee' | 'requester' | 'status';
const SORTS: SortKey[] = ['manual', 'due', 'priority', 'created', 'title', 'assignee', 'requester', 'status'];
const SORT_LABEL: Record<SortKey, string> = { manual: '직접 순서', due: '마감일순', priority: '우선순위순', created: '최근 생성순', title: '이름순', assignee: '담당자순', requester: '지시자순', status: '상태순' };
const PRI_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
const ko = (a?: string | null, b?: string | null) => (a ?? '\uffff').localeCompare(b ?? '\uffff', 'ko');
const byDue = (x: Task, y: Task) => (x.due_date ?? '9999-12-31').localeCompare(y.due_date ?? '9999-12-31');
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
function ListHeader({ sortBy, onSort }: { sortBy: SortKey; onSort: (k: SortKey) => void }) {
  const H = ({ k, children, className }: { k: SortKey; children: React.ReactNode; className?: string }) => (
    <button type="button" onClick={() => onSort(sortBy === k ? 'manual' : k)} aria-pressed={sortBy === k}
      className={cx('truncate text-left hover:text-ink', sortBy === k ? 'font-semibold text-accent-600' : '', className)}>{children}{sortBy === k ? ' ↓' : ''}</button>
  );
  return (
    <div className="hidden items-center gap-3 px-3 pb-1 text-xs text-ink-3 sm:flex" data-testid="list-header">
      <span className="w-4" /><span className="w-[22px]" />
      <H k="title" className="flex-1">업무 이름</H>
      <H k="requester" className="hidden w-[104px] md:block">지시자</H>
      <H k="priority" className="w-[60px] text-right">우선순위</H>
      <H k="status" className="w-[84px]">상태</H>
      <H k="due" className="w-[92px] text-right">마감일</H>
      <H k="assignee" className="w-12 text-right">담당자</H>
    </div>
  );
}
/** 마감 묶음 끝 "업무 추가" 줄의 기본 마감일 */
const DUE_DEFAULT: Record<string, () => string | null> = {
  over: () => todayStr(), today: () => todayStr(), week: () => quickDues()[2][1], later: () => quickDues()[3][1], none: () => null, new: () => null,
};
function ViewChip({ on, onClick, children, label }: { on: boolean; onClick: () => void; children: React.ReactNode; label?: string }) {
  return (
    <button onClick={onClick} aria-pressed={on} aria-label={label}
      className={cx('inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 font-medium transition-colors', on ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-white text-ink-2 hover:border-slate-300')}>{children}</button>
  );
}

/**
 * 업무 화면 목록 (Asana "팀 작업"): 담당자별(기본)·지시자별·마감일·프로젝트로 묶고, 묶음마다 끝에 "업무 추가" 줄 — 그 묶음 값이 자동으로 들어간다.
 * 담당자별은 본사 사람 전원을 업무 0건이어도 묶음으로 보여 준다(바로 그 사람에게 배정).
 * 직접 순서일 때는 손잡이로 끌어 순서를 바꾸고, 다른 묶음으로 끌면 그 묶음 값(담당자·지시자·마감·프로젝트)으로 바뀐다.
 */
function GroupedTasks({ tasks, group, view, assigneeFilter, onPatch, onAcked, top, people, sortBy, onSort, onReorder }: {
  tasks: Task[]; group: GroupBy; view: string; assigneeFilter: string | null; onPatch: (t: Task, b: any) => any; onAcked: () => void; top: React.ReactNode;
  people: { id: string; name: string }[]; sortBy: SortKey; onSort: (k: SortKey) => void; onReorder: (ids: string[]) => void;
}) {
  const { user, dir } = useSession();
  const [folded, setFolded] = useState<Record<string, boolean>>({});
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
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
    const defs: [string, string, string?][] = [['over', '기한 지남', 'text-red-600'], ['today', '오늘'], ['week', '이번 주'], ['later', '나중'], ['none', '마감일 없음']];
    groups = defs.map(([k, l, tone]) => ({ key: k, label: l, tone, items: [], add: { defaultDue: DUE_DEFAULT[k]() } }));
    const g = (k: string) => groups.find((x) => x.key === k)!.items;
    for (const t of tasks) g(!t.due_date ? 'none' : t.due_date < today ? 'over' : t.due_date === today ? 'today' : t.due_date <= weekEnd ? 'week' : 'later').push(t);
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
  } else groups = [{ key: 'all', label: '', items: tasks, add: {} }];

  const draggable = sortBy === 'manual';
  // 다른 묶음으로 옮길 때 바뀌는 값
  const moveBody = (g: G): Record<string, unknown> | null => {
    if (group === 'assignee') return { assigneeId: g.add.defaultAssignee ?? null };
    if (group === 'requester') return g.add.defaultRequester ? { requestedById: g.add.defaultRequester } : null;
    if (group === 'due') return { dueDate: g.add.defaultDue ?? null };
    if (group === 'project') return { projectId: g.add.projectId ?? null };
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
      if (body) onPatch(t, body);
    }
    onReorder(order);
  };

  return (
    <DndContext sensors={sensors} onDragEnd={draggable ? end : undefined}>
      <div className="space-y-4" data-testid="task-groups" data-group-by={group}>
        {top && <div className="overflow-hidden rounded-card border border-accent-500/40 bg-white shadow-card ring-2 ring-accent-500/10">{top}</div>}
        <ListHeader sortBy={sortBy} onSort={onSort} />
        {groups.map((x, gi) => {
          const open = x.items.filter((t) => t.status !== 'done').length;
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
              {!isFolded && <ListView tasks={x.items} onPatch={onPatch} hint={gi === 0} tail={addRow} sortable={draggable} onMove={draggable ? (t, to) => {
                const ids = x.items.map((i) => i.id); const from = ids.indexOf(t.id);
                const at = to === 'top' ? 0 : to === 'bottom' ? ids.length - 1 : Math.max(0, Math.min(ids.length - 1, from + (to === 'up' ? -1 : 1)));
                if (at !== from) onReorder(arrayMove(ids, from, at));
              } : undefined} />}
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
/** 끌어서 순서 바꾸는 행 (손잡이는 PC 에서만 — 휴대폰은 밀기 동작과 겹치지 않게) */
function SortableRow({ t, onPatch, onAck, onMove }: { t: Task; onPatch: (t: Task, b: any) => any; onAck?: (t: Task) => void; onMove?: (t: Task, to: 'top' | 'up' | 'down' | 'bottom') => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: t.id });
  return (
    <div ref={setNodeRef} style={{ transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined, transition }} className={cx(isDragging && 'relative z-50 opacity-90 shadow-pop')}>
      <ListRow t={t} onPatch={onPatch} onAck={onAck} onMove={onMove} handle={
        <button type="button" {...attributes} {...listeners} className="hidden w-4 shrink-0 cursor-grab touch-none text-slate-300 hover:text-slate-500 sm:inline-flex" aria-label={`${t.title} 끌어서 순서 바꾸기`} data-testid="drag-handle"><GripVertical className="size-4" /></button>
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

function ListView({ tasks, onPatch, onAck, empty, hint = true, add, tail, sortable, onMove }: { tasks: Task[]; onPatch: (t: Task, b: any) => any; onAck?: (t: Task) => void; empty?: React.ReactNode; hint?: boolean; add?: React.ReactNode; tail?: React.ReactNode; sortable?: boolean; onMove?: (t: Task, to: 'top' | 'up' | 'down' | 'bottom') => void }) {
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
      {hint && <p className="border-b border-line bg-slate-50 px-3 py-1 text-[11px] text-ink-3 sm:hidden">행을 오른쪽으로 밀면 완료, 왼쪽으로 밀면 보류</p>}
      {sortable ? (
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((t) => <SortableRow key={t.id} t={t} onPatch={onPatch} onAck={onAck} onMove={onMove} />)}
        </SortableContext>
      ) : tasks.map((t) => <ListRow key={t.id} t={t} onPatch={onPatch} onAck={onAck} handle={<span className="hidden w-4 shrink-0 sm:inline-flex" />} />)}
      {tail}
    </div>
  );
}

/** 목록 행. 모바일에서는 오른쪽으로 밀면 완료(또는 검토 요청), 왼쪽으로 밀면 보류 */
function ListRow({ t, onPatch, onAck, handle, onMove }: { t: Task; onPatch: (t: Task, b: any) => any; onAck?: (t: Task) => void; handle?: React.ReactNode; onMove?: (t: Task, to: 'top' | 'up' | 'down' | 'bottom') => void }) {
  // 방금 추가한 업무는 2초 강조
  const [fresh, setFresh] = useState(() => isFresh(t.id));
  useEffect(() => { if (!fresh) return; const h = setTimeout(() => setFresh(false), 2000); return () => clearTimeout(h); }, [fresh]);
  const { user } = useSession();
  const start = useRef<{ x: number; y: number; lock: 'x' | 'y' | null } | null>(null);
  const [dx, setDx] = useState(0);
  const TH = 80;
  const right = nextStatusOnCheck(t, user.role);
  const swipe = async (to: TaskStatus) => {
    const before = t.status;
    if (await onPatch(t, { status: to }) !== false) toast.ok(to === 'on_hold' ? '보류로 바꿨습니다' : to === 'review' ? '검토를 요청했습니다' : to === 'done' ? '완료했습니다' : '다시 진행 중으로 바꿨습니다', { label: '되돌리기', run: () => onPatch({ ...t, status: to, version: t.version + 1 }, { status: before }) });
  };
  return (
    <div className="relative overflow-hidden border-b border-line last:border-b-0">
      {dx !== 0 && (
        <div className={cx('absolute inset-0 flex items-center px-5 text-sm font-semibold text-white', dx > 0 ? 'justify-start bg-emerald-500' : 'justify-end bg-zinc-500')} aria-hidden>
          {dx > 0 ? (right === 'review' ? '검토 요청' : right === 'done' ? '완료' : '다시 진행') : '보류'}
        </div>
      )}
      <div tabIndex={0} data-row={t.id} data-task-id={t.id}
        style={dx ? { transform: `translateX(${dx}px)` } : undefined}
        onTouchStart={(e) => { start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, lock: null }; }}
        onTouchMove={(e) => {
          const st = start.current; if (!st) return;
          const mx = e.touches[0].clientX - st.x, my = e.touches[0].clientY - st.y;
          if (!st.lock && (Math.abs(mx) > 10 || Math.abs(my) > 10)) st.lock = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
          if (st.lock === 'x') setDx(Math.max(-140, Math.min(140, mx)));
        }}
        onTouchEnd={() => {
          const d = dx; start.current = null; setDx(0);
          if (d > TH) swipe(right); else if (d < -TH && t.status !== 'on_hold' && t.status !== 'done') swipe('on_hold');
        }}
        data-fresh={fresh ? '1' : undefined}
        className={cx('group relative flex min-h-[44px] items-center gap-3 px-3 py-2 hover:bg-slate-50 focus:bg-accent-50 focus:outline-none', fresh ? 'bg-amber-50 ring-2 ring-inset ring-amber-300' : 'bg-white', !dx && 'transition-[transform,background-color]')}>
        {handle}
        <CheckCircle t={t} onPatch={onPatch} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-3">
          <span className="flex min-w-0 items-center gap-1.5 sm:max-w-[55%] sm:shrink-0">
            <TypeIcon t={t} />
            <TaskLink id={t.id} className={cx('truncate text-sm font-medium text-ink hover:text-accent-600 hover:underline', t.status === 'done' && 'text-ink-3 line-through')}>{t.title}</TaskLink>
          </span>
          <Meta t={t} />
        </div>
        {onAck && <Button size="sm" variant="secondary" onClick={() => onAck(t)} aria-label={`${t.title} 확인`}>확인</Button>}
        <span className="hidden w-[104px] min-w-0 md:flex"><AssigneePicker role="지시자" value={t.requested_by} name={t.requested_by_name} size={18} withName onChange={(v) => v && onPatch(t, { requestedById: v })} /></span>
        <span className="hidden w-[60px] justify-end sm:flex"><PriorityPicker value={t.priority} label={`${t.title} 우선순위`} onChange={(v) => onPatch(t, { priority: v })} /></span>
        <span className="hidden w-[84px] sm:inline-flex"><StatusSelect t={t} onPatch={onPatch} /></span>
        <DueEdit t={t} onPatch={onPatch} />
        <AssigneePicker value={t.assignee_id} name={t.assignee_name} onChange={(v) => onPatch(t, { assigneeId: v })} />
        {onMove && <OrderMenu title={t.title} onMove={(to) => onMove(t, to)} />}
      </div>
    </div>
  );
}

function BoardCard({ t }: { t: Task }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: t.id, data: t });
  const stripe = t.priority === 'urgent' ? 'before:bg-red-500' : t.priority === 'high' ? 'before:bg-orange-400' : 'before:bg-transparent';
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} data-task-id={t.id}
      style={transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined}
      className={cx('relative cursor-grab touch-none overflow-hidden rounded-input border border-line bg-white p-3 shadow-card transition-shadow before:absolute before:inset-y-0 before:left-0 before:w-[3px] hover:border-slate-300 hover:shadow-pop',
        stripe, isDragging && 'z-50 rotate-1 cursor-grabbing opacity-90 shadow-pop ring-2 ring-accent-500/40')}>
      <div className="flex items-start gap-1.5">
        <TypeIcon t={t} />
        <TaskLink id={t.id} className={cx('line-clamp-2 text-sm font-medium leading-snug text-ink hover:text-accent-600 hover:underline', t.status === 'done' && 'text-ink-3 line-through')}>{t.title}</TaskLink>
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
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }));
  const end = (e: DragEndEvent) => {
    const t = e.active.data.current as Task;
    const to = e.over?.id as TaskStatus | undefined;
    if (t && to && to !== t.status) onPatch(t, { status: to });
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
    backgroundColor: t.status === 'done' ? '#94a3b8' : t.due_date! < todayStr() ? '#dc2626' : t.project_color ?? '#1f3a5f',
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

function TimelineView({ tasks, onPatch }: { tasks: Task[]; onPatch: (t: Task, b: any) => void }) {
  const [anchor, setAnchor] = useState(() => {
    const d = new Date(todayStr() + 'T00:00:00Z'); const dow = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - dow - 7); return d.toISOString().slice(0, 10);
  });
  const DAYS = 35;
  const days = Array.from({ length: DAYS }, (_, i) => addDays(anchor, i));
  const rows = tasks.filter((t) => t.due_date || t.start_date);
  const gridRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: string; kind: 'move' | 'end'; x0: number; dx: number } | null>(null);
  const colW = () => (gridRef.current ? gridRef.current.clientWidth / DAYS : 30);
  const today = todayStr();
  function finish() {
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
  return (
    <div className="overflow-hidden rounded-card border border-line bg-white shadow-card" data-testid="timeline" onPointerMove={(e) => drag && setDrag({ ...drag, dx: e.clientX - drag.x0 })} onPointerUp={finish} onPointerLeave={finish}>
      <div className="flex items-center justify-between border-b border-line px-3 py-2 text-sm">
        <div className="flex gap-1">
          <Button size="sm" variant="secondary" onClick={() => setAnchor(addDays(anchor, -7))}>‹ 이전</Button>
          <Button size="sm" variant="secondary" onClick={() => setAnchor(addDays(anchor, 7))}>다음 ›</Button>
        </div>
        <span className="font-medium text-ink-2 tabular-nums">{fmtDate(days[0])} ~ {fmtDate(days[DAYS - 1])}</span>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[900px]">
          <div className="flex border-b border-line bg-slate-50 text-[11px] text-ink-2">
            <div className="w-56 shrink-0 px-3 py-1.5 font-medium">업무</div>
            <div className="grid flex-1" style={{ gridTemplateColumns: `repeat(${DAYS}, 1fr)` }}>
              {days.map((d) => <div key={d} className={cx('border-l border-line py-1.5 text-center tabular-nums', [0, 6].includes(new Date(d + 'T00:00:00Z').getUTCDay()) && 'bg-slate-100/70 text-ink-3', d === today && '!bg-accent-600 font-bold !text-white')}>{Number(d.slice(8))}</div>)}
            </div>
          </div>
          {!rows.length && <div className="p-8 text-center text-sm text-ink-2">날짜가 있는 업무가 없습니다</div>}
          {rows.map((t) => {
            const s = t.start_date && (!t.due_date || t.start_date <= t.due_date) ? t.start_date : (t.due_date ?? t.start_date)!;
            const e = t.due_date ?? s;
            let from = diffDays(anchor, s), to = diffDays(anchor, e);
            const dx = drag?.id === t.id ? drag.dx : 0;
            const visible = to >= 0 && from < DAYS;
            from = Math.max(0, from); to = Math.min(DAYS - 1, to);
            return (
              <div key={t.id} className="flex border-b border-line text-xs last:border-b-0 hover:bg-slate-50" data-task-id={t.id}>
                <span className="flex w-56 shrink-0 items-center gap-2 px-3 py-2">
                  <Avatar id={t.assignee_id} name={t.assignee_name} size={20} />
                  <TaskLink id={t.id} className="truncate font-medium text-ink hover:underline">{t.title}</TaskLink>
                </span>
                <div ref={gridRef} className="relative flex-1">
                  {visible && t.task_type === 'milestone' && (
                    <div className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] bg-violet-500 shadow-card"
                      style={{ left: `calc(${((to + 0.5) / DAYS) * 100}% + ${drag?.id === t.id ? dx : 0}px)`, cursor: 'grab' }}
                      onPointerDown={(ev) => { (ev.target as HTMLElement).setPointerCapture?.(ev.pointerId); setDrag({ id: t.id, kind: 'move', x0: ev.clientX, dx: 0 }); }}
                      title={`${s} ~ ${e}`} aria-label={`마일스톤 ${t.title}`} />
                  )}
                  {visible && t.task_type !== 'milestone' && (
                    <div className="absolute top-1/2 flex h-6 -translate-y-1/2 select-none items-center rounded-md px-1.5 text-[11px] font-medium text-white shadow-card touch-none"
                      data-bar style={{ background: t.status === 'done' ? '#94a3b8' : e < today ? '#dc2626' : t.project_color ?? STATUS_TONE[t.status].bar, left: `calc(${(from / DAYS) * 100}% + ${drag?.id === t.id && drag.kind === 'move' ? dx : 0}px)`, width: `calc(${((to - from + 1) / DAYS) * 100}% + ${drag?.id === t.id && drag.kind === 'end' ? dx : 0}px)`, cursor: 'grab' }}
                      onPointerDown={(ev) => { (ev.target as HTMLElement).setPointerCapture?.(ev.pointerId); setDrag({ id: t.id, kind: 'move', x0: ev.clientX, dx: 0 }); }}
                      title={`${s} ~ ${e}`}>
                      <span className="truncate">{t.title}</span>
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
          <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); const v = (e.currentTarget.elements.namedItem('n') as HTMLInputElement).value.trim(); if (v) onRename(v); setEdit(false); }}>
            <input name="n" defaultValue={name} autoFocus className="rounded border px-2 py-0.5 text-sm" aria-label="섹션 이름" />
            <Button size="sm" type="submit">저장</Button>
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
      <CheckCircle t={t} onPatch={onPatch} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-3">
        <span className="flex min-w-0 items-center gap-1.5 sm:max-w-[55%] sm:shrink-0">
          <TypeIcon t={t} />
          <TaskLink id={t.id} className={cx('truncate text-sm font-medium text-ink hover:text-accent-600 hover:underline', t.status === 'done' && 'text-ink-3 line-through')}>{t.title}</TaskLink>
        </span>
        <Meta t={t} compact />
      </div>
      <span className="hidden w-[60px] justify-end sm:flex"><PriorityTag p={t.priority} /></span>
      <StatusSelect t={t} onPatch={onPatch} />
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
