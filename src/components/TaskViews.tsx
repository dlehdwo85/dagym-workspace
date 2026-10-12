'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
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

export type Task = {
  id: string; title: string; status: TaskStatus; priority: any; project_id: string | null; project_name: string | null; project_color: string | null;
  org_unit_id: string; org_unit_name: string; brand_id: string | null; assignee_id: string | null; assignee_name: string | null;
  start_date: string | null; due_date: string | null; due_time: string | null; version: number; subtask_count: number; subtask_done: number;
  checklist_total: number; checklist_done: number; comment_count: number; attachment_count: number; blocked_by_count: number;
  recurrence_rule: string | null; approval_required: boolean; tags: string[];
};

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
  useEffect(() => { // URL 변경(메뉴 이동) 반영
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

  const views: [string, string][] = [['', '전체'], ['my', '내 업무'], ['today', '오늘 할 일'], ['overdue', '지연'], ['week', '이번 주'], ['review', '검토 대기']];

  return (
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
      <div className="grid grid-cols-2 gap-2 rounded-lg border bg-white p-2 sm:grid-cols-7">
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
        <div className="col-span-2 flex items-center gap-1 sm:col-span-1">
          <input type="date" className={cx(inputCls, 'px-1 text-xs')} value={filters.from ?? ''} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} aria-label="기간 시작" />
          <input type="date" className={cx(inputCls, 'px-1 text-xs')} value={filters.to ?? ''} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} aria-label="기간 끝" />
        </div>
      </div>
      {mode !== 'board' && (
        <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />완료된 업무도 보기</label>
      )}
      {error ? <ErrorBox error={error} retry={reload} /> : loading && !data ? <Loading /> : (
        <>
          {mode === 'list' && <ListView tasks={tasks} onPatch={patch} />}
          {mode === 'board' && <BoardView tasks={tasks} onPatch={patch} />}
          {mode === 'calendar' && <CalendarView tasks={tasks} onPatch={patch} />}
          {mode === 'timeline' && <TimelineView tasks={tasks} onPatch={patch} />}
        </>
      )}
    </div>
  );
}

function snake(b: Record<string, unknown>) {
  const m: Record<string, string> = { dueDate: 'due_date', startDate: 'start_date', assigneeId: 'assignee_id' };
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

function ListView({ tasks, onPatch }: { tasks: Task[]; onPatch: (t: Task, b: any) => void }) {
  if (!tasks.length) return <Empty title="조건에 맞는 업무가 없습니다">오른쪽 아래 + 버튼으로 업무를 등록하세요.</Empty>;
  return (
    <div className="divide-y rounded-lg border bg-white" data-testid="task-list">
      {tasks.map((t) => (
        <div key={t.id} className="flex flex-col gap-1 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3" data-task-id={t.id}>
          <div className="min-w-0 flex-1">
            <Link href={`/tasks/${t.id}`} className={cx('block truncate text-sm font-medium hover:underline', t.status === 'done' && 'text-slate-400 line-through')}>{t.title}</Link>
            <Meta t={t} />
          </div>
          <div className="flex items-center gap-2 text-xs sm:w-[420px] sm:justify-end">
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
      <Link href={`/tasks/${t.id}`} className="text-sm font-medium hover:underline" onPointerDown={(e) => e.stopPropagation()}>{t.title}</Link>
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
        eventClick={(i) => { i.jsEvent.preventDefault(); location.href = `/tasks/${i.event.id}`; }}
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
                <Link href={`/tasks/${t.id}`} className="w-48 shrink-0 truncate px-2 py-2 hover:underline">{t.title}</Link>
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
