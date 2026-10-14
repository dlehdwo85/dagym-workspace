'use client';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Download, FileSpreadsheet, FileText, Folder, Image as ImageIcon, Library, Loader2, Lock, Pencil, Search, Sparkles, Trash2, Undo2, Upload } from 'lucide-react';
import { api, useApi } from '@/components/client';
import { useSession } from '@/components/session';
import { DropHint, DropZone, UploadProgress, fileHash, putFile } from '@/components/upload';
import { ROLE_LABEL } from '@/lib/types';
import { Button, Empty, ErrorBox, Field, Modal, PageHeader, Skeleton, cx, fmtDateTime, inputCls, toast } from '@/components/ui';

type F = { id: string; folder: string; title: string; file_name: string; mime_type: string; size_bytes: number; tags: string[]; description: string | null;
  created_at: string; created_by: string; created_by_name: string; has_text: boolean; snippet: string | null;
  organized_by: 'ai' | 'rule' | null; ai_confidence: number | null; needs_review: boolean; can_undo: boolean; level: string; organize_status: string | null; organize_error: string | null };
const RANK: Record<string, number> = { none: 0, view: 1, edit: 2, delete: 3 };
const fmtSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : n >= 1024 ? `${Math.round(n / 1024)}KB` : `${n}B`);
const isImg = (f: F) => /^image\/(png|jpe?g|gif|webp)$/.test(f.mime_type);

/** V9 회사 자료실: 로고·소개서·단가표·보고서. 업무 첨부와 같은 저장소, AI 비서가 찾아 쓸 수 있음 */
export default function LibraryPage() {
  const { user } = useSession();
  const admin = user.role === 'owner' || user.role === 'admin';
  const [review, setReview] = useState(false);
  const [permFolder, setPermFolder] = useState<string | null>(null);
  const sp = useSearchParams();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [folder, setFolder] = useState<string | null>(null);
  const url = `/api/library?${new URLSearchParams({ ...(query ? { q: query } : {}), ...(folder !== null ? { folder } : {}), ...(review ? { review: '1' } : {}) })}`;
  const { data, error, loading, reload } = useApi<{ files: F[]; folders: { folder: string; n: number }[]; review: number; level: string; aiOrganize: boolean }>(url);
  const canUpload = RANK[data?.level ?? 'edit'] >= RANK.edit;
  const [busy, setBusy] = useState('');
  const [upFolder, setUpFolder] = useState('');
  const [upTags, setUpTags] = useState('');
  const [edit, setEdit] = useState<F | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const hi = sp.get('file');
  useEffect(() => { const t = setTimeout(() => setQuery(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => { setUpFolder(folder ?? ''); }, [folder]);

  // V12 9번: 여러 개·진행률·알기 쉬운 실패 원인 (자료실은 원본 그대로 — 로고 화질 유지)
  const [prog, setProg] = useState<{ name: string; pct: number; error?: string }[]>([]);
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    const list = Array.from(files);
    const tags = upTags.split(/[,\s]+/).map((t) => t.replace(/^#/, '').trim()).filter(Boolean).slice(0, 20);
    setProg(list.map((f) => ({ name: f.name, pct: 0 })));
    const upd = (i: number, patch: Partial<{ pct: number; error: string }>) => setProg((x) => x.map((y, j) => (j === i ? { ...y, ...patch } : y)));
    let ok = 0;
    for (const [n, file] of list.entries()) {
      setBusy(`${list.length > 1 ? `${n + 1}/${list.length} ` : ''}${file.name} 올리는 중…`);
      try {
        const meta = { fileName: file.name, mimeType: file.type || 'application/octet-stream', size: file.size, folder: upFolder, tags, contentHash: await fileHash(file) };
        // V13 3번: 같은 파일이 이미 있으면 물어본다
        const r = await api('/api/library', { body: meta }).catch(async (e: any) => {
          if (e.code !== 'duplicate' || !confirm(`${e.message}\n그래도 한 번 더 올릴까요?`)) throw e;
          return api('/api/library', { body: { ...meta, allowDuplicate: true } });
        });
        await putFile(r.upload, file, (pct) => upd(n, { pct }));
        setBusy(`${file.name} 정리하는 중…`);
        const c = await api(`/api/library/${r.id}/complete`, { body: {} });
        if (c.organized?.by === 'ai') toast.ok(`AI 정리됨: ${c.organized.folder || '최상위'} · ${(c.organized.tags ?? []).slice(0, 3).map((t: string) => '#' + t).join(' ')}`);
        else if (c.organized) toast.error(`AI 정리 못 함 — ${c.organized.error ?? '이유 모름'} (파일명 규칙으로 정리)`);
        upd(n, { pct: 100 }); ok++;
      } catch (e: any) { upd(n, { error: e.message }); toast.error(`${file.name}: ${e.message}`); }
    }
    setBusy(''); if (fileRef.current) fileRef.current.value = '';
    if (ok) toast.ok(`${ok}개 올렸습니다`);
    if (ok === list.length) setTimeout(() => setProg([]), 1500);
    reload();
  }
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!edit) return;
    try {
      await api(`/api/library/${edit.id}`, { method: 'PATCH', body: { title: edit.title, folder: edit.folder, description: edit.description || null,
        tags: String(edit.tags).split(/[,\s]+/).map((t) => t.replace(/^#/, '')).filter(Boolean) } });
      setEdit(null); reload(); toast.ok('저장했습니다');
    } catch (e: any) { toast.error(e.message); }
  }
  async function remove(f: F) {
    if (!confirm(`"${f.title}" 을(를) 자료실에서 지울까요? (이미 업무에 첨부한 파일은 그대로 남습니다)`)) return;
    try { await api(`/api/library/${f.id}`, { method: 'DELETE' }); reload(); } catch (e: any) { toast.error(e.message); }
  }
  async function organize(f: F, action: 'undo' | 'redo') {
    try { await api(`/api/library/${f.id}/organize`, { body: { action } }); reload(); toast.ok(action === 'undo' ? '정리 전으로 되돌렸습니다' : '다시 정리했습니다'); } catch (e: any) { toast.error(e.message); }
  }
  const [allBusy, setAllBusy] = useState('');
  async function organizeAll() {
    if (!confirm('아직 정리하지 않았거나 정리에 실패한 파일을 AI 로 정리할까요? (파일마다 AI 요청 1회)')) return;
    let total = 0, ai = 0;
    try {
      for (let i = 0; i < 50; i++) {
        setAllBusy(`정리 중… ${total}개`);
        const r = await api('/api/library/organize-all', { body: {} });
        total += r.done; ai += r.ai;
        if (!r.done || !r.left) break;
      }
      toast.ok(`${total}개 정리 (AI ${ai}개)`);
    } catch (e: any) { toast.error(e.message); } finally { setAllBusy(''); reload(); }
  }
  const folders = data?.folders ?? [];
  const top = [...new Set(folders.map((f) => f.folder).filter(Boolean))];

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader title="자료실" icon={Library} sub="로고·회사 소개서·단가표·보고서를 한곳에. 업무에 바로 첨부하고, AI 비서가 찾아 씁니다."
        actions={canUpload && <>{admin && <Button variant="secondary" onClick={organizeAll} disabled={!!allBusy} data-testid="library-organize-all">{allBusy ? <><Loader2 className="animate-spin" />{allBusy}</> : <><Sparkles />전체 정리</>}</Button>}<Button onClick={() => fileRef.current?.click()} disabled={!!busy} data-testid="library-upload">{busy ? <Loader2 className="animate-spin" /> : <Upload />}올리기</Button></>} />
      <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => upload(e.target.files)} data-testid="library-file" />
      {busy && <p className="text-sm text-ink-2">{busy}</p>}
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
          <input className={cx(inputCls, 'pl-9')} placeholder="제목·태그·본문 검색 (예: 로고, 단가표)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="자료 검색" />
        </label>
        <div className="flex gap-2">
          <input className={cx(inputCls, 'sm:w-44')} placeholder="올릴 폴더 (예: 브랜드/다짐)" value={upFolder} onChange={(e) => setUpFolder(e.target.value)} aria-label="올릴 폴더" />
          <input className={cx(inputCls, 'sm:w-36')} placeholder="태그 (쉼표)" value={upTags} onChange={(e) => setUpTags(e.target.value)} aria-label="올릴 때 태그" />
        </div>
      </div>
      <div className="scrollbar-thin -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="tablist" aria-label="폴더">
        {!!data?.review && <button role="tab" aria-selected={review} onClick={() => setReview(!review)} data-testid="library-review"
          className={cx('inline-flex shrink-0 items-center gap-1 rounded-full border px-3 py-1 text-sm', review ? 'border-amber-500 bg-amber-50 font-semibold text-amber-800' : 'border-amber-200 bg-white text-amber-800')}>정리 필요 {data.review}</button>}
        <button role="tab" aria-selected={folder === null} onClick={() => setFolder(null)} className={cx('shrink-0 rounded-full border px-3 py-1 text-sm', folder === null ? 'border-brand-600 bg-brand-50 font-semibold text-brand-700' : 'border-line bg-white text-ink-2')}>전체</button>
        {top.map((f) => (
          <button key={f} role="tab" aria-selected={folder === f} onClick={() => setFolder(f)} className={cx('inline-flex shrink-0 items-center gap-1 rounded-full border px-3 py-1 text-sm', folder === f ? 'border-brand-600 bg-brand-50 font-semibold text-brand-700' : 'border-line bg-white text-ink-2')}>
            <Folder className="size-3.5" />{f}<span className="text-xs text-ink-3">{folders.find((x) => x.folder === f)?.n}</span>
          </button>
        ))}
      </div>
      {user.role === 'owner' && folder && <div className="-mt-1 text-right"><Button size="sm" variant="ghost" onClick={() => setPermFolder(folder)} data-testid="folder-perms-open"><Lock />&ldquo;{folder}&rdquo; 폴더 권한</Button></div>}
      {data && !data.aiOrganize && <p className="text-xs text-ink-3">올린 파일은 회사가 고친 정리 규칙(파일명)으로 자동 정리됩니다. 내장 AI 가 켜지면 내용까지 보고 정리합니다.</p>}
      <UploadProgress items={prog} />
      <DropZone onFiles={(f) => upload(f)} disabled={!!busy} label="놓으면 자료실에 올라갑니다" testid="library-drop" className="min-h-[120px]">
      {error ? <ErrorBox error={error} retry={reload} /> : loading && !data ? <Skeleton rows={5} /> : !data!.files.length ? (
        query ? <Empty title="찾는 자료가 없습니다" icon={Library}>다른 말로 찾아 보세요</Empty> : (
          <div className="space-y-2">
            <Empty title="아직 자료가 없습니다" icon={Library}>로고·소개서·단가표를 올려 두면 업무에 바로 첨부하고 AI 비서가 찾아 씁니다.</Empty>
            <DropHint onClick={() => fileRef.current?.click()} disabled={!!busy} what="로고·사진·PDF·엑셀·문서" testid="library-drop-hint" />
          </div>
        )
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-white shadow-card" data-testid="library-list">
          {data!.files.map((f) => (
            <li key={f.id} className={cx('flex items-center gap-3 px-3 py-2.5', hi === f.id && 'bg-amber-50')}>
              <a href={`/api/library/${f.id}/download${isImg(f) ? '?inline=1' : ''}`} target="_blank" rel="noreferrer" className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-input border border-line bg-slate-50">
                {isImg(f) ? <img src={`/api/library/${f.id}/download?inline=1`} alt="" className="size-full object-contain" loading="lazy" />
                  : /sheet|excel|csv/.test(f.mime_type + f.file_name) ? <FileSpreadsheet className="size-5 text-emerald-600" /> : /^image\//.test(f.mime_type) ? <ImageIcon className="size-5 text-ink-3" /> : <FileText className="size-5 text-ink-3" />}
              </a>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 truncate text-sm font-medium">{f.title}
                  {f.organized_by && <span className={cx('inline-flex shrink-0 items-center gap-0.5 rounded px-1.5 text-[11px] font-semibold', f.needs_review ? 'bg-amber-100 text-amber-800' : 'bg-violet-100 text-violet-700')}
                    title={f.ai_confidence !== null ? `확신 ${Math.round(f.ai_confidence * 100)}%` : undefined} data-testid="ai-organized"><Sparkles className="size-3" />{f.organized_by === 'ai' ? 'AI 정리됨' : '규칙 정리'}{f.needs_review && ' · 확인 필요'}</span>}
                </div>
                <div className="truncate text-xs text-ink-3">
                  {f.folder && <span className="mr-1.5"><Folder className="mr-0.5 inline size-3" />{f.folder}</span>}
                  {f.tags.map((t) => <span key={t} className="mr-1 text-brand-600">#{t}</span>)}
                  {fmtSize(Number(f.size_bytes))} · {f.created_by_name} · {fmtDateTime(f.created_at)}
                </div>
                {f.snippet && <div className="mt-0.5 line-clamp-1 text-xs text-ink-2">…{f.snippet}…</div>}
                {/* V14 3번: 정리 상태 — 중 / 됨(폴더·태그) / 실패(이유 + 다시 정리) */}
                {f.organize_status === 'pending' && <div className="mt-0.5 flex items-center gap-1 text-xs text-violet-700" data-testid="organize-pending"><Loader2 className="size-3 animate-spin" />AI 정리 중…</div>}
                {f.organize_status === 'done' && f.organized_by === 'ai' && <div className="mt-0.5 truncate text-xs text-violet-700" data-testid="organize-done">AI 정리됨: {f.folder || '최상위'}{f.tags.length > 0 && ` · ${f.tags.slice(0, 4).map((t) => '#' + t).join(' ')}`}</div>}
                {f.organize_status === 'failed' && (
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-amber-800" data-testid="organize-failed">
                    <span className="min-w-0 truncate">AI 정리 못 함 — {f.organize_error ?? '이유 모름'}</span>
                    {(f.created_by === user.id || admin) && <button className="shrink-0 font-semibold underline" onClick={() => organize(f, 'redo')} data-testid="organize-retry">다시 정리</button>}
                  </div>
                )}
              </div>
              <a href={`/api/library/${f.id}/download`} className="inline-flex size-8 items-center justify-center rounded-input text-ink-2 hover:bg-slate-100" aria-label={`${f.title} 내려받기`}><Download className="size-4" /></a>
              {f.can_undo && (f.created_by === user.id || admin) && <button onClick={() => organize(f, 'undo')} className="inline-flex size-8 items-center justify-center rounded-input text-ink-2 hover:bg-slate-100" aria-label={`${f.title} 정리 되돌리기`} title="AI 정리 되돌리기"><Undo2 className="size-4" /></button>}
              {(f.created_by === user.id || admin) && RANK[f.level] >= RANK.edit && <>
                <button onClick={() => setEdit({ ...f, tags: f.tags.join(', ') as never })} className="inline-flex size-8 items-center justify-center rounded-input text-ink-2 hover:bg-slate-100" aria-label={`${f.title} 고치기`}><Pencil className="size-4" /></button>
                {(RANK[f.level] >= RANK.delete || f.created_by === user.id) && <button onClick={() => remove(f)} className="inline-flex size-8 items-center justify-center rounded-input text-red-600 hover:bg-red-50" aria-label={`${f.title} 지우기`}><Trash2 className="size-4" /></button>}
              </>}
            </li>
          ))}
        </ul>
      )}
      </DropZone>
      {permFolder && <FolderPerms folder={permFolder} onClose={() => setPermFolder(null)} />}
      <Modal open={!!edit} onClose={() => setEdit(null)} title="자료 고치기">
        {edit && (
          <form onSubmit={save} className="space-y-3">
            <Field label="제목"><input className={inputCls} value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} required /></Field>
            <Field label="폴더" hint="/ 로 하위 폴더 (예: 브랜드/다짐)"><input className={inputCls} value={edit.folder} onChange={(e) => setEdit({ ...edit, folder: e.target.value })} /></Field>
            <Field label="태그" hint="쉼표로 구분"><input className={inputCls} value={edit.tags as never} onChange={(e) => setEdit({ ...edit, tags: e.target.value as never })} /></Field>
            <Field label="설명"><textarea className={inputCls} value={edit.description ?? ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
            <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setEdit(null)}>취소</Button><Button type="submit">저장</Button></div>
          </form>
        )}
      </Modal>
    </div>
  );
}

/** V13 4번 폴더 권한 (대표만): 등급마다 이 폴더(와 하위 폴더)를 좁힌다. "상속" = 상위 폴더·메뉴 권한을 따름 */
function FolderPerms({ folder, onClose }: { folder: string; onClose: () => void }) {
  const { data, reload } = useApi<{ perms: { folder: string; role: string; level: string }[] }>('/api/library/folder-perms');
  const roles = ['admin', 'dept_lead', 'site_manager', 'staff'] as const;
  const inherited = (role: string) => { const parts = folder.split('/'); for (let n = parts.length - 1; n >= 1; n--) { const p = data?.perms.find((x) => x.role === role && x.folder === parts.slice(0, n).join('/')); if (p) return `${p.folder} 설정`; } return '메뉴 권한'; };
  async function set(role: string, level: string) {
    try { await api('/api/library/folder-perms', { method: 'PUT', body: { folder, role, level: level || null } }); reload(); toast.ok('바꿨습니다'); } catch (e: any) { toast.error(e.message); }
  }
  return (
    <Modal open onClose={onClose} title={`"${folder}" 폴더 권한`}>
      <div className="space-y-2" data-testid="folder-perms">
        <p className="text-xs text-ink-2">하위 폴더는 이 설정을 그대로 따릅니다. 메뉴 권한(사용자 관리 → 메뉴 권한)보다 넓힐 수는 없습니다. 대표는 항상 모든 폴더를 봅니다.</p>
        {roles.map((r) => (
          <label key={r} className="flex items-center justify-between gap-2 text-sm">{ROLE_LABEL[r]}
            <select className={cx(inputCls, 'h-9 w-44')} value={data?.perms.find((x) => x.folder === folder && x.role === r)?.level ?? ''} onChange={(e) => set(r, e.target.value)} aria-label={`${ROLE_LABEL[r]} 폴더 권한`}>
              <option value="">상속 ({inherited(r)})</option><option value="none">안 보임</option><option value="view">보기</option><option value="edit">올리기·수정</option><option value="delete">삭제까지</option>
            </select>
          </label>
        ))}
        <div className="flex justify-end"><Button variant="secondary" onClick={onClose}>닫기</Button></div>
      </div>
    </Modal>
  );
}
