'use client';
// V30 ② 공지 한 건: 열면 읽음 처리, 첨부, 작성자·관리자는 읽음 현황(읽은 사람/안 읽은 사람)과 [안 읽은 사람에게 다시 알림](하루 1번), 고치기·지우기
import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Bell, Download, Pencil, Pin, Trash2 } from 'lucide-react';
import { api, useApi } from '@/components/client';
import { Avatar, Button, ErrorBox, Skeleton, cx, fmtDateTime, toast } from '@/components/ui';
import { NoticeEditor, type Notice } from '@/components/NoticeEditor';

type D = { notice: Notice; files: { id: string; title: string; file_name: string; size_bytes: string }[]; canEdit: boolean; canSeeReads: boolean };
type Reads = { read: { id: string; name: string; title: string | null; read_at: string }[]; unread: { id: string; name: string; title: string | null }[]; total: number; remindedAt: string | null; remindCount: number };

export default function NoticePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const st = useApi<D>(`/api/notices/${id}`);
  const [edit, setEdit] = useState(false);
  if (st.error) return <div className="p-4"><ErrorBox error={st.error} /></div>;
  if (!st.data) return <div className="p-4"><Skeleton rows={6} /></div>;
  const { notice: n, files, canEdit, canSeeReads } = st.data;
  const remove = async () => { if (!confirm('이 공지를 지울까요?')) return; try { await api(`/api/notices/${id}`, { method: 'DELETE' }); toast.ok('지웠습니다'); router.push('/notices'); } catch (e: any) { toast.error(e.message); } };
  return (
    <div className="mx-auto max-w-3xl space-y-3" data-testid="notice-page">
      <div className="flex items-start gap-2">
        <button onClick={() => router.push('/notices')} className="inline-flex size-9 shrink-0 items-center justify-center rounded-input text-ink-2 hover:bg-slate-100" aria-label="공지 목록"><ArrowLeft className="size-5" /></button>
        <div className="min-w-0 flex-1">
          <h1 className="flex flex-wrap items-center gap-1.5 text-lg font-semibold" data-testid="notice-detail-title">{n.pinned && <Pin className="size-4 text-brand-600" />}{n.important && <span className="rounded bg-red-100 px-1.5 text-xs font-semibold text-red-700">중요</span>}{n.title}</h1>
          <p className="text-xs text-ink-3">{n.created_by_name} · {fmtDateTime(n.publish_at)}{!n.published && ' (예약 — 아직 게시 전)'}</p>
        </div>
        {canEdit && <div className="flex gap-1"><Button size="sm" variant="secondary" onClick={() => setEdit(true)} aria-label="고치기"><Pencil /></Button><Button size="sm" variant="secondary" onClick={remove} aria-label="지우기"><Trash2 /></Button></div>}
      </div>
      <article className="whitespace-pre-wrap rounded-card border border-line bg-white p-4 text-sm leading-relaxed shadow-card" data-testid="notice-detail-body">{n.body || '(내용 없음)'}</article>
      {!!files.length && <ul className="space-y-1 text-sm">{files.map((f) => <li key={f.id}><a href={`/api/library/${f.id}/download`} className="inline-flex items-center gap-1.5 rounded-input border border-line bg-white px-2.5 py-1 hover:bg-slate-50"><Download className="size-4 text-ink-3" />{f.title}</a></li>)}</ul>}
      {canSeeReads && <ReadStatus id={id} />}
      {edit && <NoticeEditor initial={n} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); st.reload(); }} />}
    </div>
  );
}

function ReadStatus({ id }: { id: string }) {
  const st = useApi<Reads>(`/api/notices/${id}/reads`);
  const [busy, setBusy] = useState(false);
  if (!st.data) return null;
  const d = st.data;
  const remind = async () => { setBusy(true); try { const r = await api(`/api/notices/${id}/remind`, { body: {} }); toast.ok(`${r.notified}명에게 다시 알렸습니다`); st.reload(); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); } };
  const again = d.remindedAt && Date.now() - new Date(d.remindedAt).getTime() < 24 * 3600_000;
  return (
    <section className="rounded-card border border-line bg-white p-3 shadow-card" data-testid="notice-reads">
      <div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-semibold">읽음 현황 <span className="text-ink-2">{d.read.length} / {d.total}</span></h2>
        {d.unread.length > 0 && <Button size="sm" variant="secondary" onClick={remind} disabled={busy || !!again} title={again ? '하루에 한 번만 보낼 수 있습니다' : undefined} data-testid="notice-remind"><Bell />안 읽은 사람에게 다시 알림{d.remindCount ? ` (${d.remindCount}회)` : ''}</Button>}
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <div><div className="text-xs font-medium text-ink-3">읽음 {d.read.length}</div><ul className="mt-1 space-y-1 text-sm" data-testid="notice-read-list">{d.read.map((p) => <li key={p.id} className="flex items-center gap-1.5"><Avatar id={p.id} name={p.name} size={20} />{p.name}<span className="text-[11px] text-ink-3">{fmtDateTime(p.read_at)}</span></li>)}</ul></div>
        <div><div className="text-xs font-medium text-ink-3">안 읽음 {d.unread.length}</div><ul className="mt-1 space-y-1 text-sm" data-testid="notice-unread-list">{d.unread.map((p) => <li key={p.id} className={cx('flex items-center gap-1.5')}><Avatar id={p.id} name={p.name} size={20} />{p.name}{p.title && <span className="text-[11px] text-ink-3">{p.title}</span>}</li>)}{!d.unread.length && <li className="text-xs text-ink-3">모두 읽었습니다 🎉</li>}</ul></div>
      </div>
      <p className="mt-2 text-[11px] text-ink-3"><Link href="/notices" className="underline">공지 목록</Link></p>
    </section>
  );
}
