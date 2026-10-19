'use client';
// V30 ② 공지 쓰기/고치기 창 — 대상 전체/팀/사람, 상단 고정, 중요, 예약 게시, 자료실 첨부
import { useEffect, useState } from 'react';
import { Pin, Search, Star, X } from 'lucide-react';
import { api, useApi } from './client';
import { Button, Field, Modal, cx, fmtDateTime, inputCls, toast } from './ui';

export type Notice = { id: string; title: string; body: string; bodyMore?: boolean; pinned: boolean; important: boolean; audience: { type: 'all' | 'teams' | 'users'; ids: string[] }; file_ids: string[]; publish_at: string; published: boolean; created_by: string; created_by_name: string; read: boolean; read_at: string | null; reminded_at: string | null; remind_count: number };
export const AUD: Record<string, string> = { all: '전체', teams: '팀', users: '지정' };

export function NoticeEditor({ initial, onClose, onSaved }: { initial?: Notice; onClose: () => void; onSaved: (id: string) => void }) {
  const teams = useApi<{ teams: { id: string; name: string }[] }>('/api/teams');
  const org = useApi<{ users: { id: string; name: string; title: string | null }[] }>('/api/org');
  const [f, setF] = useState({ title: initial?.title ?? '', body: initial?.body ?? '', pinned: initial?.pinned ?? false, important: initial?.important ?? false, type: initial?.audience.type ?? 'all', ids: initial?.audience.ids ?? [], publishAt: '', fileIds: initial?.file_ids ?? [] });
  const [files, setFiles] = useState<{ id: string; title: string }[]>([]);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<{ id: string; title: string }[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!q.trim()) { setFound([]); return; } const t = setTimeout(() => api(`/api/library?q=${encodeURIComponent(q.trim())}&limit=8`).then((r) => setFound(r.files.map((x: any) => ({ id: x.id, title: x.title })))).catch(() => setFound([])), 300); return () => clearTimeout(t); }, [q]);
  const toggle = (id: string) => setF((x) => ({ ...x, ids: x.ids.includes(id) ? x.ids.filter((y) => y !== id) : [...x.ids, id] }));
  const save = async () => {
    setBusy(true);
    try {
      const body = { title: f.title, body: f.body, pinned: f.pinned, important: f.important, audience: { type: f.type, ids: f.type === 'all' ? [] : f.ids }, fileIds: f.fileIds, publishAt: f.publishAt ? new Date(f.publishAt).toISOString() : null };
      const r = initial ? await api(`/api/notices/${initial.id}`, { method: 'PATCH', body }) : await api('/api/notices', { body });
      toast.ok(initial ? '공지를 고쳤습니다' : r.scheduled ? `${fmtDateTime(r.publishAt)}에 게시되도록 예약했습니다` : '공지를 올렸습니다 — 대상에게 알림을 보냈습니다');
      onSaved(initial ? initial.id : r.id);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={initial ? '공지 고치기' : '공지 쓰기'} wide>
      <div className="space-y-2" data-testid="notice-editor">
        <Field label="제목"><input className={inputCls} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} aria-label="공지 제목" data-testid="notice-title" autoFocus /></Field>
        <Field label="내용"><textarea className={cx(inputCls, 'min-h-32')} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} aria-label="공지 내용" data-testid="notice-body" /></Field>
        <div className="flex flex-wrap gap-3 text-sm">
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={f.pinned} onChange={(e) => setF({ ...f, pinned: e.target.checked })} data-testid="notice-pinned" /><Pin className="size-3.5" />상단 고정</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={f.important} onChange={(e) => setF({ ...f, important: e.target.checked })} data-testid="notice-important" /><Star className="size-3.5" />중요</label>
        </div>
        <Field label="대상">
          <div className="flex gap-1.5" role="radiogroup">{(['all', 'teams', 'users'] as const).map((t) => <button key={t} type="button" role="radio" aria-checked={f.type === t} onClick={() => setF({ ...f, type: t, ids: [] })} className={cx('rounded-full border px-3 py-1 text-xs font-medium', f.type === t ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-white text-ink-2')} data-testid={`notice-aud-${t}`}>{AUD[t]}</button>)}</div>
          {f.type === 'teams' && <div className="mt-1.5 flex flex-wrap gap-1.5">{(teams.data?.teams ?? []).map((t) => <label key={t.id} className={cx('cursor-pointer rounded-full border px-2.5 py-0.5 text-xs', f.ids.includes(t.id) ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-line')}><input type="checkbox" className="sr-only" checked={f.ids.includes(t.id)} onChange={() => toggle(t.id)} />{t.name}</label>)}{!teams.data?.teams.length && <span className="text-xs text-ink-3">팀이 없습니다</span>}</div>}
          {f.type === 'users' && <div className="mt-1.5 flex max-h-40 flex-wrap gap-1.5 overflow-auto">{(org.data?.users ?? []).map((u) => <label key={u.id} className={cx('cursor-pointer rounded-full border px-2.5 py-0.5 text-xs', f.ids.includes(u.id) ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-line')}><input type="checkbox" className="sr-only" checked={f.ids.includes(u.id)} onChange={() => toggle(u.id)} data-testid={`notice-user-${u.id}`} />{u.name}</label>)}</div>}
        </Field>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="예약 게시(선택)" hint="비우면 바로 올립니다"><input type="datetime-local" className={inputCls} value={f.publishAt} onChange={(e) => setF({ ...f, publishAt: e.target.value })} aria-label="예약 게시 시각" data-testid="notice-publish-at" /></Field>
          <Field label="자료실 첨부(선택)">
            <div className="relative"><Search className="pointer-events-none absolute left-2 top-2.5 size-4 text-ink-3" /><input className={cx(inputCls, 'pl-8')} value={q} onChange={(e) => setQ(e.target.value)} placeholder="자료 이름으로 찾기" aria-label="자료 찾기" /></div>
            {!!found.length && <ul className="mt-1 max-h-32 overflow-auto rounded-input border border-line bg-white text-sm">{found.map((x) => <li key={x.id}><button type="button" className="w-full px-2 py-1 text-left hover:bg-slate-50" onClick={() => { if (!f.fileIds.includes(x.id)) { setF({ ...f, fileIds: [...f.fileIds, x.id] }); setFiles((s) => [...s, x]); } setQ(''); }}>{x.title}</button></li>)}</ul>}
            {!!f.fileIds.length && <div className="mt-1 flex flex-wrap gap-1">{f.fileIds.map((id) => <span key={id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs">📎 {files.find((x) => x.id === id)?.title ?? '첨부'}<button type="button" onClick={() => setF({ ...f, fileIds: f.fileIds.filter((y) => y !== id) })} aria-label="첨부 빼기"><X className="size-3" /></button></span>)}</div>}
          </Field>
        </div>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>취소</Button><Button onClick={save} disabled={busy || !f.title.trim() || (f.type !== 'all' && !f.ids.length)} data-testid="notice-save">{initial ? '저장' : '올리기'}</Button></div>
      </div>
    </Modal>
  );
}
