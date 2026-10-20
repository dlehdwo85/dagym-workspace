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
  // 로컬 10/19(대표) 홈 개편: 홈 '최근 활동' 카드가 여기 '활동' 탭으로
  const [tab, setTab] = useState<'list' | 'activity'>('list');
  const [doneIds, setDoneIds] = useState<string[]>([]); // 이 화면에서 방금 처리한 알림 — 다시 불러와도 안 읽음 탭에 "…함 ✓"로 남김
  const act = useApi<{ items: any[] }>(tab === 'activity' ? '/api/notifications/activity' : null);
  /** 로컬 10/20 알림에서 바로 처리: 서버가 준 버튼(승인/수정 요청·연장 승인/거절·답글/확인·배정 확인/오늘 할 일·10분 뒤) → 처리되면 그 자리에 "승인함 ✓" */
  async function runAction(n: any, a: { id: string; label: string; input?: 'text' }) {
    let text: string | undefined;
    if (a.input === 'text') { const t = prompt(`${a.label} 내용`); if (t === null) return; text = t.trim(); if (!text) { toast.error(`${a.label} 내용을 적어 주세요`); return; } }
    try {
      const r = await api<{ label: string; unread: number }>(`/api/notifications/${n.id}/action`, { body: { action: a.id, text } });
      setData((d: any) => d && { ...d, unread: r.unread, items: d.items.map((x: any) => (x.id === n.id ? { ...x, action_done: r.label, read_at: x.read_at ?? new Date().toISOString(), actions: [] } : x)) });
      setDoneIds((d) => [...d, n.id]);
      window.dispatchEvent(new CustomEvent('wos-unread', { detail: { value: r.unread } }));
      toast.ok(`${r.label} ✓`); broadcastRefresh();
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
          <button key={l} role="tab" aria-selected={tab === 'list' && showAll === all} onClick={() => { setTab('list'); setShowAll(all); }} data-testid={all ? 'notif-all' : 'notif-unread'}
            className={cx('rounded-full px-3 py-1', tab === 'list' && showAll === all ? 'bg-brand-600 text-white' : 'bg-white text-ink-2 ring-1 ring-line')}>{l}{!all && data?.unread ? ` ${data.unread}` : ''}</button>
        ))}
        <button role="tab" aria-selected={tab === 'activity'} onClick={() => setTab('activity')} data-testid="notif-activity"
          className={cx('rounded-full px-3 py-1', tab === 'activity' ? 'bg-brand-600 text-white' : 'bg-white text-ink-2 ring-1 ring-line')}>활동</button>
      </div>
      {tab === 'activity' ? (
        act.error ? <ErrorBox error={act.error} retry={act.reload} /> : !act.data ? <Loading /> : !act.data.items.length ? <Empty title="최근 활동이 없습니다">최근 30일 동안 내가 볼 수 있는 업무의 등록·완료·댓글이 여기에 보입니다.</Empty> : (
          <ul className="divide-y rounded-lg border bg-white" data-testid="activity-list">
            {act.data.items.map((a: any, i: number) => (
              <li key={i} className="flex min-w-0 items-start gap-3 px-4 py-2.5 text-sm">
                <span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', a.kind === 'done' ? 'bg-green-500' : a.kind === 'comment' ? 'bg-accent-500' : 'bg-slate-300')} />
                <div className="min-w-0 flex-1">
                  <p className="truncate"><b className="font-semibold">{a.actor_name ?? '시스템'}</b> {a.kind === 'done' ? '완료' : a.kind === 'comment' ? '댓글' : a.kind === 'alarm_dismissed' ? '알람 해제' : a.kind === 'alarm_snoozed' ? '알람 미룸' : '등록'} ·<Link href={`/tasks/${a.task_id}`} className="hover:underline">{a.title}</Link></p>
                  {a.body && <p className="truncate text-xs text-ink-2">{a.body}</p>}
                  <p className="text-[11px] text-ink-3">{fmtDateTime(a.at)}</p>
                </div>
              </li>))}
          </ul>)
      ) : error ? <ErrorBox error={error} retry={reload} /> : loading && !data ? <Loading /> : !(showAll ? data.items : data.items.filter((n: any) => !n.read_at || doneIds.includes(n.id))).length ? (
        <Empty title={showAll ? '알림이 없습니다' : '새 알림이 없습니다'}>{!showAll && data.items.length > 0 && <button className="text-sm text-brand-600 underline" onClick={() => setShowAll(true)}>읽은 알림 보기</button>}</Empty>
      ) : (
        <ul className="divide-y rounded-lg border bg-white" data-testid="notifications">
          {(showAll ? data.items : data.items.filter((n: any) => !n.read_at || doneIds.includes(n.id))).map((n: any) => (
            <li key={n.id} className={cx('flex gap-3 px-4 py-3', !n.read_at && 'bg-brand-50/50')}>
              <span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.read_at ? 'bg-transparent' : 'bg-brand-600')} />
              <Link href={n.link} onClick={() => !n.read_at && read([n.id])} className="min-w-0 flex-1">
                <div className="text-xs text-slate-500">{NOTIFICATION_TYPES[n.type as keyof typeof NOTIFICATION_TYPES] ?? n.type} · <span title={fmtDateTime(n.created_at)}>{relTime(n.created_at)}</span></div>
                <div className="text-sm font-medium">{n.title}</div>
                {n.body && <div className="truncate text-sm text-slate-600">{n.body}</div>}
              </Link>
              {n.action_done ? <span className="shrink-0 self-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700" data-testid="notif-done">{n.action_done} ✓</span>
                : !!n.actions?.length && (
                <span className="flex shrink-0 flex-col gap-1 self-center sm:flex-row" data-testid={n.type === 'review_requested' ? 'review-actions' : 'notif-actions'}>
                  {n.actions.map((a: any, i: number) => <Button key={a.id} size="sm" variant={i === 0 ? 'primary' : 'secondary'} onClick={() => runAction(n, a)} data-testid={`na-${a.id}`}>{a.label}</Button>)}
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
