'use client';
// 대표 결정 10/19: 자료실 '워크인 문서' 공동 편집 1차 — Tiptap + Yjs, 워크인 API 짧은 폴링(외부 유료 서비스 없음),
// 다른 사람 커서·이름, 보는 사람, 보기/편집 공유, 변경 기록·되돌리기, .docx 내보내기. 휴대폰(앱)도 같은 화면.
import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import { TableKit } from '@tiptap/extension-table';
import * as Y from 'yjs';
import { yDocToProsemirrorJSON } from 'y-prosemirror';
import { ArrowLeft, Bold, Download, Heading1, Heading2, History, Italic, List, ListOrdered, Minus, Quote, Redo2, Share2, Table as TableIcon, Undo2, WifiOff } from 'lucide-react';
import { api } from '@/components/client';
import { useSession } from '@/components/session';
import { Avatar, Button, ErrorBox, Modal, Skeleton, cx, fmtDateTime, inputCls, toast } from '@/components/ui';
import { PollProvider, colorFor, type PollStatus } from '@/components/docs/pollProvider';

type Open = { file: { id: string; title: string; folder: string; security: string; created_by: string; created_by_name: string }; canEdit: boolean; canShare: boolean; shared: boolean; snapshot: string; updates: string[]; seq: number };
type Person = { id: string; name: string; color: string; clientId: number };

export default function DocPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useSession();
  const [open, setOpen] = useState<Open | null>(null);
  const [err, setErr] = useState<{ status?: number; message: string } | null>(null);
  const [provider, setProvider] = useState<PollProvider | null>(null);
  const [status, setStatus] = useState<PollStatus>('connecting');
  const [people, setPeople] = useState<Person[]>([]);
  const [title, setTitle] = useState('');
  const [panel, setPanel] = useState<null | 'share' | 'history'>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const me = useMemo(() => ({ id: user.id, name: user.name, color: colorFor(user.id) }), [user.id, user.name]);

  useEffect(() => {
    let p: PollProvider | null = null;
    api<Open>(`/api/library/docs/${id}`).then((o) => {
      setOpen(o); setTitle(o.file.title);
      p = new PollProvider(id, o, me);
      setProvider(p);
    }).catch((e) => setErr({ status: e.status, message: e.message }));
    return () => { p?.destroy(); };
  }, [id, me]);
  useEffect(() => {
    if (!provider) return;
    const off = provider.on(setStatus);
    const onAw = () => {
      const seen = new Map<string, Person>();
      provider.awareness.getStates().forEach((s: any, clientId) => { const u = s?.user; const uid = u?.id ?? u?.name; if (uid && uid !== me.id && !seen.has(uid)) seen.set(uid, { id: uid, name: u.name, color: u.color, clientId }); });
      setPeople([...seen.values()]);
    };
    provider.awareness.on('change', onAw); onAw();
    return () => { off(); provider.awareness.off('change', onAw); };
  }, [provider, me.id]);

  if (err) return <div className="p-4"><ErrorBox error={err} /><Button variant="secondary" className="mt-3" onClick={() => router.push('/library')}><ArrowLeft />자료실</Button></div>;
  if (!open || !provider) return <div className="p-4"><Skeleton rows={8} /></div>;
  const canEdit = status === 'readonly' ? false : open.canEdit;
  const saveTitle = async () => {
    const t = title.trim();
    if (!t || t === open.file.title) { setTitle(open.file.title); return; }
    try { await api(`/api/library/${id}`, { method: 'PATCH', body: { title: t } }); setOpen({ ...open, file: { ...open.file, title: t } }); } catch (e: any) { toast.error(e.message); setTitle(open.file.title); }
  };
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-2 p-3 sm:p-4" data-testid="doc-page">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => router.push(`/library?folder=${encodeURIComponent(open.file.folder)}`)} className="inline-flex size-9 items-center justify-center rounded-input text-ink-2 hover:bg-slate-100" aria-label="자료실로"><ArrowLeft className="size-5" /></button>
        <input className={cx(inputCls, 'min-w-0 flex-1 text-base font-semibold')} value={title} onChange={(e) => setTitle(e.target.value)} onBlur={saveTitle} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          readOnly={!canEdit} aria-label="문서 제목" data-testid="doc-title" />
        <StatusBadge status={status} canEdit={open.canEdit} />
        <span className="inline-flex items-center -space-x-1.5" data-testid="doc-presence" title={people.map((p) => p.name).join(', ')}>
          {people.slice(0, 5).map((p) => <span key={p.id} className="rounded-full ring-2 ring-white" style={{ boxShadow: `0 0 0 2px ${p.color}` }}><Avatar id={p.id} name={p.name} size={24} /></span>)}
          {people.length > 5 && <span className="ml-2 text-xs text-ink-3">+{people.length - 5}</span>}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {open.canShare && <Button size="sm" variant="secondary" onClick={() => setPanel('share')} data-testid="doc-share"><Share2 />공유</Button>}
          <Button size="sm" variant="secondary" onClick={() => setPanel('history')} data-testid="doc-history"><History />기록</Button>
          <a href={`/api/library/docs/${id}/export?format=docx`} className="inline-flex h-8 items-center gap-1 rounded-input border border-line bg-white px-2.5 text-sm text-ink-2 hover:bg-slate-50" data-testid="doc-export"><Download className="size-4" />Word</a>
        </div>
      </div>
      {!canEdit && <p className="rounded-input bg-slate-50 px-3 py-1.5 text-xs text-ink-2" data-testid="doc-readonly">보기만 할 수 있는 문서입니다{open.shared ? ' (공유 받음)' : ''}. 고치려면 올린 사람({open.file.created_by_name})에게 편집 공유를 요청하세요.</p>}
      <DocEditor provider={provider} canEdit={canEdit} me={me} onEditor={setEditor} />
      {panel === 'share' && <ShareModal id={id} onClose={() => setPanel(null)} />}
      {panel === 'history' && <HistoryModal id={id} canEdit={canEdit} editor={editor} onClose={() => setPanel(null)} />}
    </div>
  );
}

function StatusBadge({ status, canEdit }: { status: PollStatus; canEdit: boolean }) {
  const [label, cls] = status === 'offline' ? ['연결 끊김 — 고친 내용은 이 기기에 남고 다시 연결되면 합쳐집니다', 'bg-amber-100 text-amber-800']
    : status === 'connecting' ? ['연결 중', 'bg-slate-100 text-ink-2'] : !canEdit || status === 'readonly' ? ['보기 전용', 'bg-slate-100 text-ink-2'] : ['실시간 저장', 'bg-emerald-50 text-emerald-700'];
  return <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', cls)} data-testid="doc-status" data-status={status}>{status === 'offline' && <WifiOff className="size-3" />}{label}</span>;
}

function DocEditor({ provider, canEdit, me, onEditor }: { provider: PollProvider; canEdit: boolean; me: { id: string; name: string; color: string }; onEditor: (e: Editor | null) => void }) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ undoRedo: false }), // 되돌리기는 Collaboration(Yjs UndoManager — 내가 고친 것만)
      TableKit.configure({ table: { resizable: false } }),
      Collaboration.configure({ document: provider.doc }),
      CollaborationCaret.configure({ provider, user: { name: me.name, color: me.color, id: me.id } }), // user 필드를 통째로 덮어쓰므로 id 도 같이
    ],
    editable: canEdit,
    immediatelyRender: false,
    editorProps: { attributes: { class: 'wos-doc-body', 'data-testid': 'doc-editor' } },
  }, [provider]);
  useEffect(() => { editor?.setEditable(canEdit); }, [editor, canEdit]);
  useEffect(() => { onEditor(editor); return () => onEditor(null); }, [editor, onEditor]);
  return (
    <div className="wos-doc rounded-card border border-line bg-white shadow-card">
      {canEdit && editor && <Toolbar editor={editor} />}
      <EditorContent editor={editor} className="min-h-[60vh] px-4 py-3 sm:px-8 sm:py-6" />
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const [, force] = useState(0);
  useEffect(() => { const f = () => force((n) => n + 1); editor.on('transaction', f); return () => { editor.off('transaction', f); }; }, [editor]);
  const B = ({ on, active, label, children }: { on: () => void; active?: boolean; label: string; children: React.ReactNode }) => (
    <button type="button" onMouseDown={(e) => { e.preventDefault(); on(); }} aria-label={label} title={label} aria-pressed={active}
      className={cx('inline-flex size-8 items-center justify-center rounded-input text-ink-2 hover:bg-slate-100', active && 'bg-brand-50 text-brand-700')}>{children}</button>
  );
  const c = editor.chain().focus();
  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-line px-2 py-1" data-testid="doc-toolbar">
      <B on={() => c.undo().run()} label="되돌리기"><Undo2 className="size-4" /></B>
      <B on={() => c.redo().run()} label="다시 실행"><Redo2 className="size-4" /></B>
      <span className="mx-1 h-5 w-px bg-line" />
      <B on={() => c.toggleHeading({ level: 1 }).run()} active={editor.isActive('heading', { level: 1 })} label="큰 제목"><Heading1 className="size-4" /></B>
      <B on={() => c.toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })} label="작은 제목"><Heading2 className="size-4" /></B>
      <B on={() => c.toggleBold().run()} active={editor.isActive('bold')} label="굵게"><Bold className="size-4" /></B>
      <B on={() => c.toggleItalic().run()} active={editor.isActive('italic')} label="기울임"><Italic className="size-4" /></B>
      <span className="mx-1 h-5 w-px bg-line" />
      <B on={() => c.toggleBulletList().run()} active={editor.isActive('bulletList')} label="목록"><List className="size-4" /></B>
      <B on={() => c.toggleOrderedList().run()} active={editor.isActive('orderedList')} label="번호 목록"><ListOrdered className="size-4" /></B>
      <B on={() => c.toggleBlockquote().run()} active={editor.isActive('blockquote')} label="인용"><Quote className="size-4" /></B>
      <B on={() => c.setHorizontalRule().run()} label="구분선"><Minus className="size-4" /></B>
      <B on={() => (editor.isActive('table') ? c.deleteTable().run() : c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())} active={editor.isActive('table')} label={editor.isActive('table') ? '표 지우기' : '표 넣기'}><TableIcon className="size-4" /></B>
      {editor.isActive('table') && <span className="ml-1 flex flex-wrap gap-0.5 text-xs">
        <button type="button" className="rounded px-1.5 py-0.5 hover:bg-slate-100" onMouseDown={(e) => { e.preventDefault(); c.addRowAfter().run(); }}>+행</button>
        <button type="button" className="rounded px-1.5 py-0.5 hover:bg-slate-100" onMouseDown={(e) => { e.preventDefault(); c.addColumnAfter().run(); }}>+열</button>
        <button type="button" className="rounded px-1.5 py-0.5 hover:bg-slate-100" onMouseDown={(e) => { e.preventDefault(); c.deleteRow().run(); }}>−행</button>
        <button type="button" className="rounded px-1.5 py-0.5 hover:bg-slate-100" onMouseDown={(e) => { e.preventDefault(); c.deleteColumn().run(); }}>−열</button>
      </span>}
    </div>
  );
}

function ShareModal({ id, onClose }: { id: string; onClose: () => void }) {
  const [data, setData] = useState<{ canShare: boolean; people: { id: string; name: string; title: string | null; role: string | null }[] } | null>(null);
  const [roles, setRoles] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  useEffect(() => { api(`/api/library/docs/${id}/shares`).then((d) => { setData(d); setRoles(Object.fromEntries(d.people.filter((p: any) => p.role).map((p: any) => [p.id, p.role]))); }).catch((e) => toast.error(e.message)); }, [id]);
  const save = async () => {
    setBusy(true);
    try { await api(`/api/library/docs/${id}/shares`, { method: 'PUT', body: { shares: Object.entries(roles).filter(([, r]) => r).map(([userId, role]) => ({ userId, role })) } }); toast.ok('공유를 저장했습니다'); onClose(); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  const list = (data?.people ?? []).filter((p) => !q || p.name.includes(q) || (p.title ?? '').includes(q));
  return (
    <Modal open onClose={onClose} title="문서 공유 — 보기 / 편집">
      <p className="text-xs text-ink-2">자료실 폴더 권한과 별개로 이 문서만 사람에게 열어 줍니다. 편집을 주면 같은 문서를 동시에 고칠 수 있습니다. 기밀 등급 규칙은 그대로입니다.</p>
      <input className={cx(inputCls, 'mt-2')} placeholder="이름·직책 찾기" value={q} onChange={(e) => setQ(e.target.value)} aria-label="사람 찾기" />
      <ul className="mt-2 max-h-72 divide-y divide-line overflow-auto rounded-input border border-line" data-testid="doc-share-list">
        {!data && <li className="p-3 text-sm text-ink-3">읽는 중…</li>}
        {list.map((p) => (
          <li key={p.id} className="flex items-center gap-2 px-3 py-2 text-sm">
            <Avatar id={p.id} name={p.name} size={24} /><span className="min-w-0 flex-1 truncate">{p.name}{p.title && <span className="ml-1 text-xs text-ink-3">{p.title}</span>}</span>
            <select className="rounded-input border border-slate-300 px-2 py-1 text-xs" value={roles[p.id] ?? ''} onChange={(e) => setRoles({ ...roles, [p.id]: e.target.value })} aria-label={`${p.name} 권한`} data-testid={`doc-share-role-${p.id}`}>
              <option value="">없음</option><option value="view">보기</option><option value="edit">편집</option>
            </select>
          </li>
        ))}
        {data && !list.length && <li className="p-3 text-sm text-ink-3">사람이 없습니다</li>}
      </ul>
      <div className="mt-3 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>닫기</Button><Button onClick={save} disabled={busy || !data} data-testid="doc-share-save">저장</Button></div>
    </Modal>
  );
}

type Ver = { id: number; seq: number; reason: string | null; createdAt: string; preview: string; by: string[] };
const REASON: Record<string, string> = { auto: '10분 기록', idle: '편집 끝', restore: '되돌리기 전', manual: '직접 기록' };
function HistoryModal({ id, canEdit, editor, onClose }: { id: string; canEdit: boolean; editor: Editor | null; onClose: () => void }) {
  const [vers, setVers] = useState<Ver[] | null>(null);
  const [view, setView] = useState<{ id: number; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => api<{ versions: Ver[] }>(`/api/library/docs/${id}/versions`).then((d) => setVers(d.versions)).catch((e) => toast.error(e.message));
  useEffect(() => { void load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const mark = async () => { setBusy(true); try { await api(`/api/library/docs/${id}/versions`, { method: 'POST' }); await load(); toast.ok('지금 상태를 기록했습니다'); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); } };
  const restore = async (v: Ver) => {
    if (!confirm(`${fmtDateTime(v.createdAt)} 기록으로 되돌릴까요? 지금 상태도 기록에 남고, 다른 사람 화면에 바로 반영됩니다.`)) return;
    setBusy(true);
    try {
      await api(`/api/library/docs/${id}/versions?reason=restore`, { method: 'POST' });
      const d = await api<{ snapshot: string }>(`/api/library/docs/${id}/versions/${v.id}`);
      const tmp = new Y.Doc(); Y.applyUpdate(tmp, Uint8Array.from(atob(d.snapshot), (c) => c.charCodeAt(0)));
      const json = yDocToProsemirrorJSON(tmp, 'default');
      if (!editor) throw new Error('편집기를 찾지 못했습니다');
      editor.commands.setContent(json);
      toast.ok('되돌렸습니다'); onClose();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="변경 기록" wide>
      <div className="flex items-center justify-between gap-2 text-xs text-ink-2"><span>10분마다, 또는 고치던 사람이 모두 나가면 자동으로 남습니다.</span>{canEdit && <Button size="sm" variant="secondary" onClick={mark} disabled={busy} data-testid="doc-version-mark">지금 기록</Button>}</div>
      <ul className="mt-2 max-h-80 divide-y divide-line overflow-auto rounded-input border border-line" data-testid="doc-versions">
        {!vers && <li className="p-3 text-sm text-ink-3">읽는 중…</li>}
        {vers?.map((v) => (
          <li key={v.id} className="px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{fmtDateTime(v.createdAt)}</span>
              <span className="rounded bg-slate-100 px-1.5 text-[11px] text-ink-2">{REASON[v.reason ?? ''] ?? v.reason}</span>
              {v.by.length > 0 && <span className="text-xs text-ink-3">{v.by.join(', ')}</span>}
              <span className="ml-auto flex gap-1">
                <button className="text-xs underline" onClick={() => api<{ text: string }>(`/api/library/docs/${id}/versions/${v.id}`).then((d) => setView({ id: v.id, text: d.text })).catch((e) => toast.error(e.message))}>보기</button>
                {canEdit && <button className="text-xs font-semibold text-brand-700 underline" onClick={() => restore(v)} disabled={busy} data-testid={`doc-restore-${v.id}`}>되돌리기</button>}
              </span>
            </div>
            {view?.id === v.id ? <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2 text-xs" data-testid="doc-version-text">{view.text || '(비어 있음)'}</pre>
              : v.preview && <div className="mt-0.5 line-clamp-1 text-xs text-ink-3">{v.preview}</div>}
          </li>
        ))}
        {vers && !vers.length && <li className="p-3 text-sm text-ink-3">아직 기록이 없습니다</li>}
      </ul>
      <div className="mt-3 flex justify-end"><Button variant="secondary" onClick={onClose}>닫기</Button></div>
    </Modal>
  );
}
