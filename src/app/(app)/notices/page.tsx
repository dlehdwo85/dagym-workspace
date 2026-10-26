'use client';
// V30 ② 공지(게시판): 목록(고정·중요·안 읽음 점), 쓰기(대상 전체/팀/사람·고정·중요·예약 게시·자료실 첨부) — 올리면 대상에게 알림·푸시
import { useState } from 'react';
import Link from 'next/link';
import { Megaphone, Pin, Plus } from 'lucide-react';
import { useApi } from '@/components/client';
import { Button, ErrorBox, PageHeader, Skeleton, cx, fmtDateTime } from '@/components/ui';
import { AUD, NoticeEditor, type Notice } from '@/components/NoticeEditor';


export default function NoticesPage() {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const list = useApi<{ notices: Notice[]; unread: number; canWrite: boolean }>(`/api/notices${unreadOnly ? '?unread=1' : ''}`);
  const [open, setOpen] = useState(false);
  return (
    <div className="mx-auto max-w-4xl space-y-3" data-testid="notices-page">
      <PageHeader title="공지" icon={Megaphone} sub={list.data ? `안 읽은 공지 ${list.data.unread}건` : undefined}
        actions={list.data?.canWrite && <Button onClick={() => setOpen(true)} data-testid="notice-new"><Plus />공지 쓰기</Button>} />
      <div className="flex gap-1.5" role="tablist">
        {[['전체', false], ['안 읽음', true]].map(([l, v]) => <button key={String(l)} role="tab" aria-selected={unreadOnly === v} onClick={() => setUnreadOnly(v as boolean)} className={cx('rounded-full border px-3 py-1 text-xs font-medium', unreadOnly === v ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-white text-ink-2')}>{l as string}</button>)}
      </div>
      {list.error && <ErrorBox error={list.error} retry={list.reload} />}
      {!list.data && !list.error && <Skeleton rows={5} />}
      {list.data && (
        <ul className="divide-y divide-line rounded-card border border-line bg-white shadow-card" data-testid="notice-list">
          {!list.data.notices.length && <li className="p-6 text-center text-sm text-ink-3">{unreadOnly ? '안 읽은 공지가 없습니다' : '아직 공지가 없습니다'}</li>}
          {list.data.notices.map((n) => (
            <li key={n.id}>
              <Link href={`/notices/${n.id}`} className={cx('flex items-start gap-3 px-3 py-2.5 hover:bg-slate-50', !n.read && n.published && 'bg-amber-50/40')} data-testid="notice-row" data-read={n.read ? '1' : '0'}>
                <span className={cx('mt-2 size-2 shrink-0 rounded-full', n.read || !n.published ? 'bg-transparent' : 'bg-red-500')} aria-label={n.read ? '읽음' : '안 읽음'} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                    {n.pinned && <Pin className="size-3.5 text-brand-600" aria-label="상단 고정" />}
                    {n.important && <span className="rounded bg-red-100 px-1.5 text-[11px] font-semibold text-red-700">중요</span>}
                    <span className="truncate">{n.title}</span>
                    {!n.published && <span className="rounded bg-slate-100 px-1.5 text-[11px] text-ink-2">예약 {fmtDateTime(n.publish_at)}</span>}
                  </div>
                  <div className="line-clamp-2 text-xs text-ink-2">{n.body}</div>
                  <div className="mt-0.5 text-[11px] text-ink-3">{n.created_by_name} · {fmtDateTime(n.publish_at)} · 대상 {AUD[n.audience.type]}{n.file_ids.length ? ` · 📎 ${n.file_ids.length}` : ''}</div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {open && <NoticeEditor onClose={() => setOpen(false)} onSaved={() => { setOpen(false); list.reload(); }} />}
    </div>
  );
}

