'use client';
import { useState } from 'react';
import Link from 'next/link';
import { api, broadcastRefresh, useApi } from '@/components/client';
import { Button, Empty, ErrorBox, Loading, cx, fmtDateTime, toast } from '@/components/ui';
import { NOTIFICATION_TYPES } from '@/lib/types';

export default function Notifications() {
  const { data, error, loading, reload, setData } = useApi<any>('/api/notifications');
  /** V32 0: 기본은 안 읽은 알림만 — 누르면 바로 읽음(목록에서 빠지고 배지 감소), 서버 실패 때만 되돌림. [읽은 알림도 보기]로 전체 */
  const [showAll, setShowAll] = useState(false);
  async function decide(n: any, approve: boolean) {
    const note = approve ? undefined : prompt('반려 사유 (담당자에게 전달)') ?? undefined;
    if (!approve && note === undefined) return;
    try {
      await api(`/api/tasks/${n.entity_id}`, { method: 'PATCH', body: { status: approve ? 'done' : 'in_progress', version: n.task_version, ...(note ? { reviewNote: note } : {}) } });
      if (!n.read_at) await api('/api/notifications/read', { body: { ids: [n.id] } });
      toast.ok(approve ? '승인했습니다 (완료)' : '반려했습니다 — 담당자에게 알렸습니다'); reload(); broadcastRefresh();
    } catch (e: any) { toast.error(e.message); }
  }
  async function read(ids?: string[]) {
    if (!data) return;
    const now = new Date().toISOString();
    const target = ids ? new Set(ids) : null;
    const changed = data.items.filter((n: any) => !n.read_at && (!target || target.has(n.id))).length;
    const prev = data;
    setData({ ...data, unread: ids ? Math.max(0, data.unread - changed) : 0, items: data.items.map((n: any) => (!n.read_at && (!target || target.has(n.id)) ? { ...n, read_at: now } : n)) });
    window.dispatchEvent(new CustomEvent('wos-unread', { detail: ids ? { delta: -changed } : { value: 0 } }));
    try {
      const r = await api<{ unread: number }>('/api/notifications/read', { body: ids ? { ids } : { all: true } });
      window.dispatchEvent(new CustomEvent('wos-unread', { detail: { value: r.unread } }));
    } catch (e: any) {
      setData(prev); window.dispatchEvent(new CustomEvent('wos-unread', { detail: { value: prev.unread } })); toast.error(e.message || '읽음 처리를 못 했습니다');
    }
  }
  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">알림 {data?.unread ? <span className="text-sm text-red-600">{data.unread}</span> : null}</h1>
        <div className="flex gap-2"><Link href="/settings" className="text-sm text-brand-600 hover:underline">알림 설정</Link><Button size="sm" variant="secondary" onClick={() => read()} disabled={!data?.unread} data-testid="read-all">모두 읽음</Button></div>
      </div>
      <div className="flex gap-1 text-sm" role="tablist" aria-label="알림 보기">
        {([[false, '안 읽음'], [true, '전체']] as const).map(([all, l]) => (
          <button key={l} role="tab" aria-selected={showAll === all} onClick={() => setShowAll(all)} data-testid={all ? 'notif-all' : 'notif-unread'}
            className={cx('rounded-full px-3 py-1', showAll === all ? 'bg-brand-600 text-white' : 'bg-white text-ink-2 ring-1 ring-line')}>{l}{!all && data?.unread ? ` ${data.unread}` : ''}</button>
        ))}
      </div>
      {error ? <ErrorBox error={error} retry={reload} /> : loading && !data ? <Loading /> : !(showAll ? data.items : data.items.filter((n: any) => !n.read_at)).length ? (
        <Empty title={showAll ? '알림이 없습니다' : '새 알림이 없습니다'}>{!showAll && data.items.length > 0 && <button className="text-sm text-brand-600 underline" onClick={() => setShowAll(true)}>읽은 알림 보기</button>}</Empty>
      ) : (
        <ul className="divide-y rounded-lg border bg-white" data-testid="notifications">
          {(showAll ? data.items : data.items.filter((n: any) => !n.read_at)).map((n: any) => (
            <li key={n.id} className={cx('flex gap-3 px-4 py-3', !n.read_at && 'bg-brand-50/50')}>
              <span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.read_at ? 'bg-transparent' : 'bg-brand-600')} />
              <Link href={n.link} onClick={() => !n.read_at && read([n.id])} className="min-w-0 flex-1">
                <div className="text-xs text-slate-500">{NOTIFICATION_TYPES[n.type as keyof typeof NOTIFICATION_TYPES] ?? n.type} · <span title={fmtDateTime(n.created_at)}>{relTime(n.created_at)}</span></div>
                <div className="text-sm font-medium">{n.title}</div>
                {n.body && <div className="truncate text-sm text-slate-600">{n.body}</div>}
              </Link>
              {n.type === 'review_requested' && n.task_status === 'review' && (
                <span className="flex shrink-0 flex-col gap-1 sm:flex-row" data-testid="review-actions">
                  <Button size="sm" onClick={() => decide(n, true)}>승인</Button>
                  <Button size="sm" variant="secondary" onClick={() => decide(n, false)}>반려</Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 검수(10/16): 알림 시각은 "방금·n분 전·n시간 전·어제" — 하루 넘으면 날짜·시각 */
function relTime(iso: string) {
  const ms = Date.now() - Date.parse(iso);
  if (ms < 60_000) return '방금';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}분 전`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}시간 전`;
  if (ms < 2 * 86_400_000) return '어제';
  return fmtDateTime(iso);
}
