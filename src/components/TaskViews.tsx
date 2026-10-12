'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { DndContext, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
import { api, broadcastRefresh, useApi } from './client';
import { useSession } from './session';
import { BrandDot, Button, Empty, ErrorBox, Loading, PriorityTag, StatusBadge, cx, dueClass, fmtDate, inputCls, toast, todayStr } from './ui';
import { STATUSES, STATUS_LABEL, type TaskStatus } from '@/lib/types';
import { UnitSelect } from './pickers';
import { TaskDetail } from './TaskDetail';
import { QuickAddTask } from './QuickAddTask';

export type Task = {
  id: string; title: string; status: TaskStatus; priority: any; project_id: string | null; project_name: string | null; project_color: string | null;
  org_unit_id: string; org_unit_name: string; brand_id: string | null; assignee_id: string | null; assignee_name: string | null;
  start_date: string | null; due_date: string | null; due_time: string | null; version: number; subtask_count: number; subtask_done: number;
  checklist_total: number; checklist_done: number; comment_count: number; attachment_count: number; blocked_by_count: number;
  recurrence_rule: string | null; approval_required: boolean; tags: string[];
  section_id?: string | null; assignee_ack_at?: string | null; created_by?: string; sort_order?: number;
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

export function TaskViews({ fixed, title, defaultMode = 'list' }: { fixed?: Record<string, string>; title?: string; defaultMode?: ViewMode }) {
  const sp = useSearchParams();
  const router = useRouter();
  const { dir } = useSession();
  const [mode, setMode] = useState<ViewMode>((sp.get('mode') as ViewMode) || defaultMode);
  const [q, setQ] = useState(sp.get('q') ?? '');
  const [filters, setFilters] = useState<Record<string, string>>(() => {
    const f: Record<string, string> = {};
    for (const k of ['view', 'brandId', 'orgUnitId', 'assigneeId', 'status', 'from', 'to']) { const v = sp.get(k); if (v) f[k] = v; }
    return f;
  });
  const [showDone, setShowDone] = useState(sp.get('done') === '1');
  useEffect(() => { // URL 변경(메뉴 이동) 반영 — 패널로 /tasks/:id 가 된 동안에는 목록 필터를 그대로 둔다
    if (/^\/tasks\/[0-9a-f-]{36}$/.test(location.pathname)) return;
    const v = sp.get('view');
    setFilters((f) => (f.view === (v ?? undefined) ? f : { ...f, view: v ?? '' }));
  }, [sp]);

  const qs = useMemo(() => {
    const p = new URLSearchParams({ ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)), ...(fixed ?? {}) });
    if (q) p.set('q', q);
    if (!showDone && mode !== 'board' && !filters.status) p.set('includeDone', '0');
    return p.toString();
  }, [filters, fixed, q, showDone, mode]);
  const { data, error, loading, reload, setData } = useApi<{ tasks: Task[] }>(`/api/tasks?${qs}`);
  const tasks = data?.tasks ?? [];

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
    } catch (e: any) {
      setData(before);
      toast.error(e.message);
      if (e.status === 409) reload();
    }
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

  const views: [string, string][] = [['', '전체'], ['my', '내 업무'], ['today', '오늘 할 일'], ['overdue', '지연'], ['week', '이번 주'], ['review', '검토 대기']];

  return (
    <OpenTaskCtx.Provider value={openTask}>
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-bold">{title ?? '업무'}</h1>
        <div className="flex rounded-md border bg-white p-0.5 text-sm" role="tablist" aria-label="보기 방식">
          {([['list', '목록'], ['board', '보드'], ['calendar', '캘린더'], ['timeline', '타임라인']] as [ViewMode, string][]).map(([m, l]) => (
            <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={cx('rounded px-3 py-1', mode === m ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100')}>{l}</button>
          ))}
        </div>
      </div>
      {!fixed?.view && (
        <div className="flex gap-1 overflow-x-auto pb-1 text-sm">
          {views.map(([v, l]) => (
            <button key={v} onClick={() => setFilters((f) => ({ ...f, view: v }))}
              className={cx('whitespace-nowrap rounded-full border px-3 py-1', (filters.view ?? '') === v ? 'border-brand-600 bg-brand-50 text-brand-700' : 'bg-white text-slate-600')}>{l}</button>
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 rounded-lg border bg-white p-2 sm:grid-cols-4 xl:grid-cols-8">
        <input className={cx(inputCls, 'col-span-2')} placeholder="검색 (제목·설명·태그)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="업무 검색" />
        <select className={inputCls} value={filters.brandId ?? ''} onChange={(e) => setFilters((f) => ({ ...f, brandId: e.target.value }))} aria-label="브랜드">
          <option value="">모든 브랜드</option>{dir.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <UnitSelect value={filters.orgUnitId ?? ''} onChange={(v) => setFilters((f) => ({ ...f, orgUnitId: v }))} allowEmpty="모든 현장·부서" />
        <select className={inputCls} value={filters.assigneeId ?? ''} onChange={(e) => setFilters((f) => ({ ...f, assigneeId: e.target.value }))} aria-label="담당자">
          <option value="">모든 담당자</option>{dir.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select className={inputCls} value={filters.status ?? ''} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} aria-label="상태">
          <option value="">모든 상태</option>{STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <div className="col-span-2 flex min-w-0 items-center gap-1">
          <input type="date" className={cx(inputCls, 'px-1 text-xs')} value={filters.from ?? ''} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} aria-label="기간 시작" />
          <input type="date" className={cx(inputCls, 'px-1 text-xs')} value={filters.to ?? ''} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} aria-label="기간 끝" />
        </div>
      </div>
      {mode !== 'board' && (
        <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />완료된 업무도 보기</label>
      )}
      {error ? <ErrorBox error={error} retry={reload} /> : loading && !data ? <Loading /> : (
        <>
          {mode === 'list' && ((fixed?.view ?? filters.view) === 'my' ? <MyGroupedList tasks={tasks} onPatch={patch} onAcked={reload} />
            : projectId ? <SectionedList projectId={projectId} sections={sections} tasks={tasks} onPatch={patch} reloadSections={sectionsApi.reload} reloadTasks={reload} />
            : <ListView tasks={tasks} onPatch={patch} />)}
          {mode === 'board' && projectId && (
            <div className="flex items-center gap-2 text-xs text-slate-600">열 기준
              <select className="rounded border px-2 py-0.5" value={boardBy} onChange={(e) => setBoardBy(e.target.value as any)} aria-label="보드 열 기준">
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
    {panelId && (
      <aside className="fixed inset-0 z-40 overflow-y-auto bg-white p-3 shadow-2xl sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[640px] sm:border-l" data-testid="task-panel" aria-label="업무 상세 패널">
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

function Meta({ t }: { t: Task }) {
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
      {t.project_name && <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: t.project_color ?? '#999' }} />{t.project_name}</span>}
      <span>{t.org_unit_name}</span>
      <BrandDot brand={t.brand_id} />
      {t.subtask_count > 0 && <span>하위 {t.subtask_done}/{t.subtask_count}</span>}
      {t.checklist_total > 0 && <span>☑ {t.checklist_done}/{t.checklist_total}</span>}
      {t.comment_count > 0 && <span>💬 {t.comment_count}</span>}
      {t.attachment_count > 0 && <span>📎 {t.attachment_count}</span>}
      {t.recurrence_rule && <span title="반복 업무">↻</span>}
      {t.blocked_by_count > 0 && <span className="text-amber-700">선행 대기 {t.blocked_by_count}</span>}
    </span>
  );
}

/** 내 업무: 최근 배정 → 기한 지남 → 오늘 → 이번 주 → 나중 → 날짜 없음 (Asana '내 작업' 참고) */
function MyGroupedList({ tasks, onPatch, onAcked }: { tasks: Task[]; onPatch: (t: Task, b: any) => void; onAcked: () => void }) {
  const { user } = useSession();
  if (!tasks.length) return <Empty title="내 업무가 없습니다">오른쪽 아래 + 버튼으로 업무를 등록하세요.</Empty>;
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
      {groups.filter((x) => x.items.length).map((x) => (
        <section key={x.key} data-group={x.key}>
          <h2 className={cx('mb-1 px-1 text-xs font-semibold', x.key === 'over' ? 'text-red-600' : 'text-slate-500')}>{x.label} <span className="font-normal">{x.items.length}</span></h2>
          <ListView tasks={x.items} onPatch={onPatch} onAck={x.key === 'new' ? async (t) => { try { await api(`/api/tasks/${t.id}/ack`, { body: {} }); onAcked(); } catch (e: any) { toast.error(e.message); } } : undefined} />
        </section>
      ))}
    </div>
  );
}

function ListView({ tasks, onPatch, onAck, empty }: { tasks: Task[]; onPatch: (t: Task, b: any) => void; onAck?: (t: Task) => void; empty?: React.ReactNode }) {
  if (!tasks.length) return <>{empty ?? <Empty title="조건에 맞는 업무가 없습니다">오른쪽 아래 + 버튼으로 업무를 등록하세요.</Empty>}</>;
  return (
    <div className="divide-y rounded-lg border bg-white" data-testid="task-list">
      {tasks.map((t) => (
        <div key={t.id} className="flex flex-col gap-1 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3" data-task-id={t.id}>
          <div className="min-w-0 flex-1">
            <TaskLink id={t.id} className={cx('block truncate text-sm font-medium hover:underline', t.status === 'done' && 'text-slate-400 line-through')}>{t.title}</TaskLink>
            <Meta t={t} />
          </div>
          <div className="flex items-center gap-2 text-xs sm:w-[420px] sm:justify-end">
            {onAck && <Button size="sm" variant="secondary" onClick={() => onAck(t)} aria-label={`${t.title} 확인`}>확인</Button>}
            <PriorityTag p={t.priority} />
            <span className="w-16 truncate text-slate-600">{t.assignee_name ?? '미배정'}</span>
            <input type="date" value={t.due_date ?? ''} onChange={(e) => onPatch(t, { dueDate: e.target.value || null })}
              className={cx('w-[118px] rounded border border-transparent px-1 py-0.5 hover:border-slate-300', dueClass(t.due_date, t.status))} aria-label={`${t.title} 마감일`} data-testid="due-input" />
            <select value={t.status} onChange={(e) => onPatch(t, { status: e.target.value })} className="rounded border border-slate-200 px-1 py-0.5" aria-label={`${t.title} 상태`}>
              {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </div>
        </div>
      ))}
    </div>
  );
}

function BoardCard({ t }: { t: Task }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: t.id, data: t });
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} data-task-id={t.id}
      style={transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined}
      className={cx('cursor-grab touch-none rounded-md border bg-white p-2.5 shadow-sm', isDragging && 'z-50 opacity-80 shadow-lg')}>
      <TaskLink id={t.id} className="text-sm font-medium hover:underline">{t.title}</TaskLink>
      <div className="mt-1 flex items-center justify-between text-xs">
        <span className={dueClass(t.due_date, t.status)}>{t.due_date ? fmtDate(t.due_date) : '마감 없음'}</span>
        <span className="text-slate-600">{t.assignee_name ?? '미배정'}</span>
      </div>
      <div className="mt-1"><Meta t={t} /></div>
    </div>
  );
}
function Column({ status, tasks }: { status: TaskStatus; tasks: Task[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div ref={setNodeRef} className={cx('flex w-72 shrink-0 flex-col rounded-lg p-2 sm:w-auto', isOver ? 'bg-brand-100' : 'bg-slate-100')} data-column={status}>
      <div className="mb-2 flex items-center justify-between px-1"><StatusBadge status={status} /><span className="text-xs text-slate-500">{tasks.length}</span></div>
      <div className="flex min-h-[80px] flex-col gap-2">{tasks.map((t) => <BoardCard key={t.id} t={t} />)}</div>
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
    <div className="rounded-lg border bg-white p-2" data-testid="task-calendar">
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
    <div className="rounded-lg border bg-white" data-testid="timeline" onPointerMove={(e) => drag && setDrag({ ...drag, dx: e.clientX - drag.x0 })} onPointerUp={finish} onPointerLeave={finish}>
      <div className="flex items-center justify-between border-b px-3 py-2 text-sm">
        <div className="flex gap-1">
          <Button size="sm" variant="secondary" onClick={() => setAnchor(addDays(anchor, -7))}>‹ 이전</Button>
          <Button size="sm" variant="secondary" onClick={() => setAnchor(addDays(anchor, 7))}>다음 ›</Button>
        </div>
        <span className="text-slate-600">{fmtDate(days[0])} ~ {fmtDate(days[DAYS - 1])}</span>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[900px]">
          <div className="flex border-b text-[10px] text-slate-500">
            <div className="w-48 shrink-0 px-2 py-1">업무</div>
            <div className="grid flex-1" style={{ gridTemplateColumns: `repeat(${DAYS}, 1fr)` }}>
              {days.map((d) => <div key={d} className={cx('border-l py-1 text-center', d === today && 'bg-amber-50 font-bold text-amber-700', [0, 6].includes(new Date(d + 'T00:00:00Z').getUTCDay()) && 'bg-slate-50')}>{Number(d.slice(8))}</div>)}
            </div>
          </div>
          {!rows.length && <div className="p-6 text-center text-sm text-slate-500">날짜가 있는 업무가 없습니다</div>}
          {rows.map((t) => {
            const s = t.start_date && (!t.due_date || t.start_date <= t.due_date) ? t.start_date : (t.due_date ?? t.start_date)!;
            const e = t.due_date ?? s;
            let from = diffDays(anchor, s), to = diffDays(anchor, e);
            const dx = drag?.id === t.id ? drag.dx : 0;
            const visible = to >= 0 && from < DAYS;
            from = Math.max(0, from); to = Math.min(DAYS - 1, to);
            return (
              <div key={t.id} className="flex border-b text-xs hover:bg-slate-50" data-task-id={t.id}>
                <TaskLink id={t.id} className="w-48 shrink-0 truncate px-2 py-2 hover:underline">{t.title}</TaskLink>
                <div ref={gridRef} className="relative flex-1">
                  {visible && (
                    <div className={cx('absolute top-1.5 flex h-5 select-none items-center rounded px-1 text-[10px] text-white touch-none', t.status === 'done' ? 'bg-slate-400' : e < today ? 'bg-red-600' : 'bg-brand-600')}
                      style={{ left: `calc(${(from / DAYS) * 100}% + ${drag?.id === t.id && drag.kind === 'move' ? dx : 0}px)`, width: `calc(${((to - from + 1) / DAYS) * 100}% + ${drag?.id === t.id && drag.kind === 'end' ? dx : 0}px)`, cursor: 'grab' }}
                      onPointerDown={(ev) => { (ev.target as HTMLElement).setPointerCapture?.(ev.pointerId); setDrag({ id: t.id, kind: 'move', x0: ev.clientX, dx: 0 }); }}
                      title={`${s} ~ ${e}`}>
                      <span className="truncate">{t.assignee_name ?? ''}</span>
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
              {!items.length && <div className="px-3 py-3 text-xs text-slate-400">업무를 여기로 끌어 오거나 + 업무 추가</div>}
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
    <section ref={setNodeRef} className={cx('rounded-lg border bg-white', isOver && 'ring-2 ring-brand-500')} data-section={id ?? 'none'}>
      <div className="flex items-center gap-2 border-b px-3 py-2">
        {edit && onRename ? (
          <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); const v = (e.currentTarget.elements.namedItem('n') as HTMLInputElement).value.trim(); if (v) onRename(v); setEdit(false); }}>
            <input name="n" defaultValue={name} autoFocus className="rounded border px-2 py-0.5 text-sm" aria-label="섹션 이름" />
            <Button size="sm" type="submit">저장</Button>
          </form>
        ) : <h2 className="text-sm font-semibold" onDoubleClick={() => onRename && setEdit(true)}>{name} <span className="font-normal text-slate-400">{count}</span></h2>}
        <span className="flex-1" />
        <Button size="sm" variant="ghost" onClick={onAdd}>+ 업무 추가</Button>
        {onRename && !edit && <Button size="sm" variant="ghost" onClick={() => setEdit(true)}>이름 변경</Button>}
        {onMove && <><Button size="sm" variant="ghost" onClick={() => onMove(-1)} aria-label={`${name} 위로`}>↑</Button><Button size="sm" variant="ghost" onClick={() => onMove(1)} aria-label={`${name} 아래로`}>↓</Button></>}
        {onDelete && <Button size="sm" variant="ghost" className="text-red-600" onClick={onDelete}>삭제</Button>}
      </div>
      <div className="divide-y">{children}</div>
    </section>
  );
}

function DraggableRow({ t, onPatch }: { t: Task; onPatch: (t: Task, b: any) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: t.id, data: t });
  return (
    <div ref={setNodeRef} style={transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined}
      className={cx('flex items-center gap-2 bg-white px-3 py-2', isDragging && 'relative z-50 opacity-80 shadow-lg')} data-task-id={t.id}>
      <span {...listeners} {...attributes} className="cursor-grab touch-none select-none px-1 text-slate-400" aria-label={`${t.title} 끌어서 이동`}>⋮⋮</span>
      <div className="min-w-0 flex-1">
        <TaskLink id={t.id} className={cx('block truncate text-sm font-medium hover:underline', t.status === 'done' && 'text-slate-400 line-through')}>{t.title}</TaskLink>
        <Meta t={t} />
      </div>
      <span className="hidden w-16 truncate text-xs text-slate-600 sm:block">{t.assignee_name ?? '미배정'}</span>
      <span className={cx('hidden text-xs sm:block', dueClass(t.due_date, t.status))}>{t.due_date ? fmtDate(t.due_date) : ''}</span>
      <select value={t.status} onChange={(e) => onPatch(t, { status: e.target.value })} className="rounded border border-slate-200 px-1 py-0.5 text-xs" aria-label={`${t.title} 상태`}>
        {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
      </select>
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
