'use client';
import Link from 'next/link';
import { api, broadcastRefresh, useApi } from '@/components/client';
import { Button, Empty, ErrorBox, Loading, cx, fmtDateTime } from '@/components/ui';
import { NOTIFICATION_TYPES } from '@/lib/types';

export default function Notifications() {
  const { data, error, loading, reload } = useApi<any>('/api/notifications');
  async function read(ids?: string[]) { await api('/api/notifications/read', { body: ids ? { ids } : { all: true } }); reload(); broadcastRefresh(); }
  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">알림 {data?.unread ? <span className="text-sm text-red-600">{data.unread}</span> : null}</h1>
        <div className="flex gap-2"><Link href="/settings" className="text-sm text-brand-600 hover:underline">알림 설정</Link><Button size="sm" variant="secondary" onClick={() => read()}>모두 읽음</Button></div>
      </div>
      {error ? <ErrorBox error={error} retry={reload} /> : loading && !data ? <Loading /> : !data.items.length ? <Empty title="새 알림이 없습니다" /> : (
        <ul className="divide-y rounded-lg border bg-white" data-testid="notifications">
          {data.items.map((n: any) => (
            <li key={n.id} className={cx('flex gap-3 px-4 py-3', !n.read_at && 'bg-brand-50/50')}>
              <span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.read_at ? 'bg-transparent' : 'bg-brand-600')} />
              <Link href={n.link} onClick={() => !n.read_at && read([n.id])} className="min-w-0 flex-1">
                <div className="text-xs text-slate-500">{NOTIFICATION_TYPES[n.type as keyof typeof NOTIFICATION_TYPES] ?? n.type} · {fmtDateTime(n.created_at)}</div>
                <div className="text-sm font-medium">{n.title}</div>
                {n.body && <div className="truncate text-sm text-slate-600">{n.body}</div>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
