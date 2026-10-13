'use client';
import Link from 'next/link';
import { RotateCcw, Trash2 } from 'lucide-react';
import { api, broadcastRefresh, useApi } from '@/components/client';
import { Button, Empty, ErrorBox, Skeleton, fmtDateTime, toast } from '@/components/ui';

/** V6 11번 휴지통: 삭제한 업무를 30일 동안 되살릴 수 있다 */
export default function TrashPage() {
  const { data, error, loading, reload } = useApi<{ tasks: any[] }>('/api/tasks/trash');
  async function restore(id: string) {
    try { await api(`/api/tasks/${id}/restore`, { body: {} }); toast.ok('되살렸습니다'); reload(); broadcastRefresh(); } catch (e: any) { toast.error(e.message); }
  }
  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <div className="flex items-center gap-2">
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight"><Trash2 className="size-5 text-ink-2" />휴지통</h1>
        <Link href="/tasks" className="ml-auto text-sm text-ink-2 hover:underline">업무로 돌아가기</Link>
      </div>
      <p className="text-sm text-ink-2">삭제한 업무는 30일 동안 여기서 되살릴 수 있습니다. 30일이 지나면 목록에서 사라집니다.</p>
      <ErrorBox error={error} retry={reload} />
      {loading && !data ? <Skeleton rows={4} /> : !data?.tasks.length ? <Empty title="휴지통이 비어 있습니다" icon={Trash2}>삭제한 업무가 없습니다.</Empty> : (
        <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-white shadow-card" data-testid="trash-list">
          {data.tasks.map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{t.title}</p>
                <p className="text-xs text-ink-3">{fmtDateTime(t.deleted_at)} 삭제{t.assignee_name ? ` · 담당 ${t.assignee_name}` : ''}</p>
              </div>
              <Button size="sm" variant="secondary" onClick={() => restore(t.id)} aria-label={`${t.title} 되살리기`}><RotateCcw />되살리기</Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
