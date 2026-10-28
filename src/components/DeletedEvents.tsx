'use client';
// 241차(로컬 10/28 19:20 '10/29 면접 일정이 사라짐 — 누가·언제 지웠는지 · 휴지통(되살리기)'): 캘린더 › 지운 일정 — 최근 30일 안에 지운 일정(내가 고칠 수 있는 것)·지운 사람·때 · [되살리기]
import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { api, broadcastRefresh, useApi } from '@/components/client';
import { Button, ErrorBox, Modal, Skeleton, fmtDateTime, fmtTimeRange, toast } from '@/components/ui';

type Item = { id: string; title: string; start: string; end: string; allDay: boolean; repeat: boolean; calendar: string; deletedAt: string; deletedBy: string | null; auto?: string };

export function DeletedEvents({ onClose }: { onClose: () => void }) {
  const { data, error, reload } = useApi<{ days: number; items: Item[] }>('/api/events/deleted?days=30');
  const [busy, setBusy] = useState<string | null>(null);
  async function restore(x: Item) {
    setBusy(x.id);
    try {
      await api(`/api/events/${x.id}/restore`, { method: 'POST' });
      toast.ok(`'${x.title}' 일정을 되살렸습니다`);
      broadcastRefresh(); // 캘린더와 이 목록을 함께 다시 불러옴
    } catch (e) { toast.error((e as Error).message || '되살리지 못했습니다'); reload(); } finally { setBusy(null); }
  }
  return (
    <Modal open onClose={onClose} title="지운 일정">
      <div className="space-y-2" data-testid="deleted-events">
        <p className="text-xs text-ink-2">최근 {data?.days ?? 30}일 안에 지운 일정입니다(내가 고칠 수 있는 일정만). 반복 일정은 통째로 지운 것만 보이고, 되살리면 같이 지운 회차 변경도 함께 돌아옵니다.</p>
        {error ? <ErrorBox error={error} retry={reload} /> : !data ? <Skeleton rows={3} /> : !data.items.length
          ? <p className="rounded-card border border-dashed border-line p-4 text-center text-sm text-ink-3" data-testid="deleted-events-empty">최근 지운 일정이 없습니다</p>
          : <ul className="divide-y divide-line rounded-card border border-line">{data.items.map((x) => (
            <li key={x.id} className="flex items-start gap-2 px-3 py-2" data-testid="deleted-event">
              <div className="min-w-0 flex-1 text-sm">
                <b className="block truncate">{x.title}</b>
                <span className="block text-xs text-ink-2">{fmtTimeRange(x.start, x.end, { allDay: x.allDay })}{x.repeat ? ' · 반복' : ''} · {x.calendar}</span>
                <span className="block text-xs text-ink-3" data-testid="deleted-event-by">{x.auto ? `${x.auto}${x.deletedBy ? `(${x.deletedBy})` : ''}` : `지운 사람 ${x.deletedBy ?? '기록 없음'}`} · {fmtDateTime(x.deletedAt)}</span>
              </div>
              <Button size="sm" variant="secondary" onClick={() => restore(x)} disabled={busy === x.id} data-testid="deleted-event-restore"><RotateCcw />되살리기</Button>
            </li>))}</ul>}
      </div>
    </Modal>
  );
}
