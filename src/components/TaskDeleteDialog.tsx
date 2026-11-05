'use client';
import { useEffect, useMemo, useState } from 'react';
import { CalendarX2 } from 'lucide-react';
import { api, broadcastRefresh, useApi } from '@/components/client';
import { Button, Modal, Skeleton, cx, fmtTimeRange, toast } from '@/components/ui';

type PlanEvent = { key: string; id: string; title: string; start: string; end: string; allDay: boolean; occurrenceStart: string | null; attendees: number; checked: boolean; disabled: boolean; kind: string; note: string | null };
type Plan = { taskIds: string[]; subtasks: number; events: PlanEvent[] };

/**
 * 361차(대표 #977): 업무 삭제 창 하나 — 휴대폰에서 기본 확인창이 두 번 뜨던 것('취소'가 '업무만 지우기'라 헷갈림) 대신.
 * 하위 업무 수 · 같이 만든 묶음(이 업무만 / 모두) · '연결된 일정 n개도 함께 지우기'(기본 체크 = 이 업무가 주인인 일정, 남김 이유, 참석자 취소 알림) ·
 * 되살리면(되돌리기·휴지통) 함께 지운 일정도 돌아옴.
 */
export function TaskDeleteDialog({ open, onClose, taskId, title, batch, onDeleted }: {
  open: boolean; onClose: () => void; taskId: string; title: string;
  batch: { id: string; total: number; canAll: boolean } | null; onDeleted: () => void;
}) {
  const [all, setAll] = useState(false);
  const plan = useApi<Plan>(open ? `/api/tasks/${taskId}/delete-plan${all ? '?batch=1' : ''}` : null, [open, all]);
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (plan.data) setPick(new Set(plan.data.events.filter((e) => e.checked).map((e) => e.key))); }, [plan.data]);
  useEffect(() => { if (!open) setAll(false); }, [open]);
  const events = plan.data?.events ?? [];
  const chosen = useMemo(() => events.filter((e) => pick.has(e.key) && !e.disabled), [events, pick]);
  const attendees = chosen.reduce((n, e) => n + e.attendees, 0);
  const toggle = (k: string) => setPick((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  async function go() {
    if (busy || !plan.data) return;
    setBusy(true);
    const q = `?events=${chosen.length ? encodeURIComponent(chosen.map((e) => e.key).join(',')) : 'none'}`;
    try {
      const r = await api<{ eventsDeleted?: number }>(all && batch ? `/api/tasks/batch/${batch.id}${q}` : `/api/tasks/${taskId}${q}`, { method: 'DELETE' });
      const ids = plan.data.taskIds;
      const ev = r.eventsDeleted ? ` · 연결 일정 ${r.eventsDeleted}개도 지웠습니다` : '';
      toast.ok(`${all && batch ? `${ids.length}건을` : ''} 삭제했습니다${ev}. 30일 안에 휴지통에서 되살릴 수 있습니다`.trim(), {
        label: '되돌리기', run: async () => {
          try {
            const back = ids.length > 1 ? await api<{ eventsRestored?: number }>('/api/tasks/bulk', { body: { ids, action: 'restore' } }) : await api<{ eventsRestored?: number }>(`/api/tasks/${taskId}/restore`, { body: {} });
            toast.ok(`되살렸습니다${back.eventsRestored ? ` · 일정 ${back.eventsRestored}개도 돌아왔습니다` : ''}`); broadcastRefresh();
          } catch (e: any) { toast.error(e.message); }
        },
      });
      broadcastRefresh(); onClose(); onDeleted();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="업무 삭제">
      <div className="space-y-3 text-sm" data-testid="task-delete-dialog">
        <p><b className="break-all">{title}</b> 업무를 휴지통으로 옮깁니다. 30일 안에 되살릴 수 있어요.</p>
        {batch && batch.total > 1 && batch.canAll && (
          <div className="space-y-1 rounded-input border border-line p-2" role="radiogroup" aria-label="지울 범위">
            <label className="flex items-center gap-2"><input type="radio" name="del-scope" checked={!all} onChange={() => setAll(false)} /> 이 업무만</label>
            <label className="flex items-center gap-2"><input type="radio" name="del-scope" checked={all} onChange={() => setAll(true)} data-testid="task-delete-batch-all" /> 같이 만든 {batch.total}건(담당자별) 모두</label>
          </div>
        )}
        {(plan.data?.subtasks ?? 0) > 0 && <p className="text-ink-2" data-testid="task-delete-subs">하위 업무 {plan.data!.subtasks}개도 함께 삭제됩니다.</p>}
        {plan.error ? <p className="text-red-700">연결 일정을 불러오지 못했습니다 — 업무만 지울 수 있어요.</p> : !plan.data ? <Skeleton rows={2} /> : events.length > 0 && (
          <div className="rounded-input border border-line" data-testid="task-delete-events">
            <p className="flex items-center gap-1.5 border-b border-line px-3 py-2 font-medium"><CalendarX2 className="size-4 text-ink-3" aria-hidden />연결된 일정 {events.length}개 — 함께 지울 일정을 고르세요</p>
            <ul className="divide-y divide-line">{events.map((e) => (
              <li key={e.key} className={cx('flex gap-2 px-3 py-2', e.disabled && 'opacity-60')} data-testid="task-delete-event" data-key={e.key} data-kind={e.kind}>
                <input type="checkbox" className="mt-1" checked={pick.has(e.key) && !e.disabled} disabled={e.disabled} onChange={() => toggle(e.key)} aria-label={`${e.title} 함께 지우기`} />
                <span className="min-w-0 flex-1">
                  <span className="block break-words font-medium">{e.title}</span>
                  <span className="block text-xs text-ink-2">{fmtTimeRange(e.start, e.end, { allDay: e.allDay })}{e.occurrenceStart ? ' · 반복 일정의 이 회차' : ''}</span>
                  {e.note && <span className="block text-xs text-ink-3">{e.note}</span>}
                  {pick.has(e.key) && !e.disabled && e.attendees > 0 && <span className="block text-xs text-amber-800" data-testid="task-delete-attendees">참석자 {e.attendees}명에게 일정 취소 알림이 갑니다</span>}
                </span>
              </li>))}</ul>
          </div>
        )}
        {chosen.length > 0 && <p className="text-xs text-ink-2">업무를 되살리면(되돌리기·휴지통) 함께 지운 일정도 다시 돌아옵니다{attendees ? ' — 참석자에게 다시 잡혔다고 알려요' : ''}.</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>취소</Button>
          <Button variant="danger" onClick={go} disabled={busy || (!plan.data && !plan.error)} data-testid="task-delete-confirm">
            {chosen.length ? `업무와 일정 ${chosen.length}개 삭제` : '업무 삭제'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
