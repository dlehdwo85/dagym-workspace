'use client';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Download, FileSpreadsheet, FileText, Folder, Image as ImageIcon, Library, Loader2, Pencil, Search, Trash2, Upload } from 'lucide-react';
import { api, useApi } from '@/components/client';
import { useSession } from '@/components/session';
import { Button, Empty, ErrorBox, Field, Modal, PageHeader, Skeleton, cx, fmtDateTime, inputCls, toast } from '@/components/ui';

type F = { id: string; folder: string; title: string; file_name: string; mime_type: string; size_bytes: number; tags: string[]; description: string | null;
  created_at: string; created_by: string; created_by_name: string; has_text: boolean; snippet: string | null };
const fmtSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : n >= 1024 ? `${Math.round(n / 1024)}KB` : `${n}B`);
const isImg = (f: F) => /^image\/(png|jpe?g|gif|webp)$/.test(f.mime_type);

/** V9 회사 자료실: 로고·소개서·단가표·보고서. 업무 첨부와 같은 저장소, AI 비서가 찾아 쓸 수 있음 */
export default function LibraryPage() {
  const { user } = useSession();
  const admin = user.role === 'owner' || user.role === 'admin';
  const sp = useSearchParams();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [folder, setFolder] = useState<string | null>(null);
  const url = `/api/library?${new URLSearchParams({ ...(query ? { q: query } : {}), ...(folder !== null ? { folder } : {}) })}`;
  const { data, error, loading, reload } = useApi<{ files: F[]; folders: { folder: string; n: number }[] }>(url);
  const [busy, setBusy] = useState('');
  const [upFolder, setUpFolder] = useState('');
  const [upTags, setUpTags] = useState('');
  const [edit, setEdit] = useState<F | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const hi = sp.get('file');
  useEffect(() => { const t = setTimeout(() => setQuery(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => { setUpFolder(folder ?? ''); }, [folder]);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    const list = Array.from(files);
    const tags = upTags.split(/[,\s]+/).map((t) => t.replace(/^#/, '').trim()).filter(Boolean).slice(0, 20);
    for (const [n, file] of list.entries()) {
      setBusy(`${list.length > 1 ? `${n + 1}/${list.length} ` : ''}${file.name} 올리는 중…`);
      try {
        const r = await api('/api/library', { body: { fileName: file.name, mimeType: file.type || 'application/octet-stream', size: file.size, folder: upFolder, tags } });
        const up = await fetch(r.upload.url, { method: 'PUT', headers: r.upload.headers, body: file });
        if (!up.ok) throw new Error(`파일 전송 실패 (${up.status})`);
        await api(`/api/library/${r.id}/complete`, { body: {} });
      } catch (e: any) { toast.error(`${file.name}: ${e.message}`); }
    }
    setBusy(''); if (fileRef.current) fileRef.current.value = '';
    toast.ok(`${list.length}개 올렸습니다`); reload();
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
  const folders = data?.folders ?? [];
  const top = [...new Set(folders.map((f) => f.folder).filter(Boolean))];

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader title="자료실" icon={Library} sub="로고·회사 소개서·단가표·보고서를 한곳에. 업무에 바로 첨부하고, AI 비서가 찾아 씁니다."
        actions={<Button onClick={() => fileRef.current?.click()} disabled={!!busy} data-testid="library-upload">{busy ? <Loader2 className="animate-spin" /> : <Upload />}올리기</Button>} />
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
        <button role="tab" aria-selected={folder === null} onClick={() => setFolder(null)} className={cx('shrink-0 rounded-full border px-3 py-1 text-sm', folder === null ? 'border-brand-600 bg-brand-50 font-semibold text-brand-700' : 'border-line bg-white text-ink-2')}>전체</button>
        {top.map((f) => (
          <button key={f} role="tab" aria-selected={folder === f} onClick={() => setFolder(f)} className={cx('inline-flex shrink-0 items-center gap-1 rounded-full border px-3 py-1 text-sm', folder === f ? 'border-brand-600 bg-brand-50 font-semibold text-brand-700' : 'border-line bg-white text-ink-2')}>
            <Folder className="size-3.5" />{f}<span className="text-xs text-ink-3">{folders.find((x) => x.folder === f)?.n}</span>
          </button>
        ))}
      </div>
      {error ? <ErrorBox error={error} retry={reload} /> : loading && !data ? <Skeleton rows={5} /> : !data!.files.length ? (
        <Empty title={query ? '찾는 자료가 없습니다' : '아직 자료가 없습니다'} icon={Library}>{query ? '다른 말로 찾아 보세요' : '로고·소개서·단가표를 올려 두면 업무에 바로 첨부하고 AI 비서가 찾아 씁니다.'}</Empty>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-white shadow-card" data-testid="library-list">
          {data!.files.map((f) => (
            <li key={f.id} className={cx('flex items-center gap-3 px-3 py-2.5', hi === f.id && 'bg-amber-50')}>
              <a href={`/api/library/${f.id}/download${isImg(f) ? '?inline=1' : ''}`} target="_blank" rel="noreferrer" className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-input border border-line bg-slate-50">
                {isImg(f) ? <img src={`/api/library/${f.id}/download?inline=1`} alt="" className="size-full object-contain" loading="lazy" />
                  : /sheet|excel|csv/.test(f.mime_type + f.file_name) ? <FileSpreadsheet className="size-5 text-emerald-600" /> : /^image\//.test(f.mime_type) ? <ImageIcon className="size-5 text-ink-3" /> : <FileText className="size-5 text-ink-3" />}
              </a>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{f.title}</div>
                <div className="truncate text-xs text-ink-3">
                  {f.folder && <span className="mr-1.5"><Folder className="mr-0.5 inline size-3" />{f.folder}</span>}
                  {f.tags.map((t) => <span key={t} className="mr-1 text-brand-600">#{t}</span>)}
                  {fmtSize(Number(f.size_bytes))} · {f.created_by_name} · {fmtDateTime(f.created_at)}
                </div>
                {f.snippet && <div className="mt-0.5 line-clamp-1 text-xs text-ink-2">…{f.snippet}…</div>}
              </div>
              <a href={`/api/library/${f.id}/download`} className="inline-flex size-8 items-center justify-center rounded-input text-ink-2 hover:bg-slate-100" aria-label={`${f.title} 내려받기`}><Download className="size-4" /></a>
              {(f.created_by === user.id || admin) && <>
                <button onClick={() => setEdit({ ...f, tags: f.tags.join(', ') as never })} className="inline-flex size-8 items-center justify-center rounded-input text-ink-2 hover:bg-slate-100" aria-label={`${f.title} 고치기`}><Pencil className="size-4" /></button>
                <button onClick={() => remove(f)} className="inline-flex size-8 items-center justify-center rounded-input text-red-600 hover:bg-red-50" aria-label={`${f.title} 지우기`}><Trash2 className="size-4" /></button>
              </>}
            </li>
          ))}
        </ul>
      )}
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
