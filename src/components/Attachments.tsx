'use client';
import { useEffect, useRef, useState } from 'react';
import { api, broadcastRefresh } from './client';
import { Camera, Download, Eye, FileText, FolderOpen, History, Image as ImageIcon, Link2, Loader2, Paperclip, PenLine, Search, Table2, Trash2, Upload, Video } from 'lucide-react';
import { isNativeApp } from './native';
import { MediaFull } from './MediaView';
import { Button, Field, Modal, cx, inputCls, toast, fmtDate, fmtDateTime } from './ui';
import { DropHint, DropZone, UploadProgress, putFile } from './upload';

/** V8 5번: 사진은 올리기 전에 긴 변 1600px·JPEG 85% 로 줄인다(휴대폰 원본 5~10MB → 수백 KB). GIF·작은 사진·실패 시 원본 */
export async function shrinkImage(file: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type) || file.size < 400 * 1024 || typeof createImageBitmap !== 'function') return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 1.5 * 1024 * 1024) return file;
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    const blob: Blob | null = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg', lastModified: file.lastModified });
  } catch { return file; }
}

/** V12 9번: 업무·일정 첨부 올리기(여러 개·진행률·알기 쉬운 실패 원인) — 첨부 칸·댓글 칸 끌어 놓기 공용 */
export async function uploadTaskFiles(list: File[], target: { taskId?: string; eventId?: string }, setProg: (f: (x: { name: string; pct: number; error?: string }[]) => { name: string; pct: number; error?: string }[]) => void) {
  const start = list.map((f) => ({ name: f.name, pct: 0 }));
  setProg(() => start);
  const upd = (i: number, patch: Partial<{ pct: number; error: string }>) => setProg((x) => x.map((y, j) => (j === i ? { ...y, ...patch } : y)));
  let ok = 0;
  for (const [n, raw] of list.entries()) {
    try {
      const file = await shrinkImage(raw);
      // B-7 촬영(파일 수정) 시각을 함께 기록 — 사진 증빙의 시점 확인용
      const capturedAt = raw.lastModified ? new Date(raw.lastModified).toISOString() : undefined;
      const r = await api('/api/attachments', { body: { ...target, kind: 'file', fileName: file.name, mimeType: file.type || 'application/octet-stream', size: file.size, capturedAt } });
      const { uploadId } = await putFile(r.upload, file, (pct) => upd(n, { pct }));
      await api(`/api/attachments/${r.id}/complete`, { body: uploadId ? { uploadId } : {} });
      upd(n, { pct: 100 }); ok++;
    } catch (e: any) { upd(n, { error: e.message }); toast.error(`${raw.name}: ${e.message}`); }
  }
  if (ok) toast.ok(`${ok}개 첨부 완료`);
  if (ok === list.length) setTimeout(() => setProg(() => []), 1500);
  return ok;
}

const isImage = (a: any) => a.kind === 'file' && /^image\//.test(a.mime_type ?? '');
const isVideo = (a: any) => a.kind === 'file' && /^video\//.test(a.mime_type ?? ''); // 대표 10/21 02:00: 영상은 보기 창에서 재생

const SOURCE_LABEL: Record<string, string> = { upload: '업로드', google_drive: 'Google Drive', chatgpt: 'ChatGPT 결과물', notion: 'Notion', web: '웹 링크', other: '기타', library: '자료실' };

export function Attachments({ items, taskId, eventId, canEdit, onChange, meId }: { items: any[]; taskId?: string; eventId?: string; canEdit: boolean; onChange: () => void; meId: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState('');
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState<any>({});
  const [view, setView] = useState<any | null>(null); // 사진 크게 보기
  // 대표 10/20 23:05: 첨부를 업무 안에서 열어 고치고 저장 — docx 는 워크인 문서(공동 편집), xlsx 는 칸 고치기, 나머지는 새 버전 올리기. 버전 기록·되돌리기
  const [versionsOf, setVersionsOf] = useState<any | null>(null);
  const [sheetOf, setSheetOf] = useState<any | null>(null);
  const [libOpen, setLibOpen] = useState(false); // 대표 10/20 23:55: [자료실에서 가져오기]
  const verRef = useRef<HTMLInputElement>(null); const [verTarget, setVerTarget] = useState<any | null>(null);
  const editKind = (a: any) => (/\.docx$/i.test(a.file_name ?? '') ? 'doc' : /\.xlsx$/i.test(a.file_name ?? '') ? 'sheet' : 'file');
  async function openDoc(a: any) {
    try { const r = await api<{ link: string; created: boolean }>(`/api/attachments/${a.id}/doc`, { body: {} }); if (r.created) toast.ok('워크인 문서로 바꿨습니다 — 같이 고친 뒤 [업무로 저장]'); window.location.href = r.link; } catch (e: any) { toast.error(e.message); }
  }
  async function uploadVersion(a: any, file: File | undefined) {
    if (!file) return; setBusy('새 버전 올리는 중…');
    try { const st = await api<any>(`/api/attachments/${a.id}/versions`, { body: { fileName: file.name, mimeType: file.type || a.mime_type, size: file.size } });
      await putFile(st.upload, file); const r = await api<{ version: number }>(`/api/attachments/${a.id}/versions/complete`, { body: { key: st.key, fileName: file.name, mimeType: file.type || a.mime_type } });
      toast.ok(`v${r.version} 으로 저장했습니다(이전 버전 보관)`); onChange(); broadcastRefresh(); } catch (e: any) { toast.error(e.message); } finally { setBusy(''); if (verRef.current) verRef.current.value = ''; }
  }
  const photos = items.filter(isImage);
  const albumRef = useRef<HTMLInputElement>(null);
  const vidRef = useRef<HTMLInputElement>(null); // #109 영상 촬영

  const [prog, setProg] = useState<{ name: string; pct: number; error?: string }[]>([]);
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy('올리는 중…');
    await uploadTaskFiles(Array.from(files), { taskId, eventId }, setProg);
    setBusy('');
    if (fileRef.current) fileRef.current.value = '';
    if (camRef.current) camRef.current.value = '';
    if (albumRef.current) albumRef.current.value = '';
    onChange(); broadcastRefresh();
  }
  async function addLink(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api('/api/attachments', { body: { taskId, eventId, kind: 'link', url: link.url, docTitle: link.docTitle || undefined, docVersion: link.docVersion || undefined,
        docBaseDate: link.docBaseDate || undefined, docOwner: link.docOwner || undefined, source: link.source || undefined } });
      setLinkOpen(false); setLink({}); onChange(); toast.ok('문서 링크를 연결했습니다');
    } catch (e: any) { toast.error(e.message); }
  }
  /** 미리보기 = 새 창(앱은 기기 브라우저), 내려받기 = 웹은 바로 저장, 앱은 서명 주소로 넘겨 기기 브라우저가 받음(iOS 는 미리보기에서 공유) */
  async function openFile(id: string, preview: boolean) {
    const q = preview ? '?inline=1' : '';
    if (!isNativeApp()) {
      if (preview) window.open(`/api/attachments/${id}/download${q}`, '_blank', 'noopener');
      else { const el = document.createElement('a'); el.href = `/api/attachments/${id}/download`; el.rel = 'noopener'; document.body.appendChild(el); el.click(); el.remove(); }
      return;
    }
    const { openFileExternally } = await import('./native');
    await openFileExternally(`/api/attachments/${id}/download${q}`); // 기기 브라우저로(내려받기·공유)
  }
  async function remove(id: string) {
    if (!confirm('첨부를 삭제할까요?')) return;
    try { await api(`/api/attachments/${id}`, { method: 'DELETE' }); onChange(); } catch (e: any) { toast.error(e.message); }
  }

  return (
    <DropZone onFiles={(f) => upload(f)} disabled={!canEdit || !!busy} label={taskId ? '놓으면 이 업무에 첨부됩니다' : '놓으면 이 일정에 첨부됩니다'} testid="attach-drop">
      {items.some(isImage) && (
        <div className="mb-2 grid grid-cols-3 gap-2 sm:grid-cols-4" data-testid="photo-grid">
          {items.filter(isImage).map((a) => (
            <a key={a.id} href={`/api/attachments/${a.id}/download?inline=1`} onClick={(e) => { e.preventDefault(); setView(a); }} className="group relative block aspect-square overflow-hidden rounded-input border border-line bg-slate-100" title={a.file_name} data-photo={a.id}>
              <img src={`/api/attachments/${a.id}/download?inline=1`} alt={a.file_name} loading="lazy" className="size-full object-cover transition-transform group-hover:scale-105" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
              <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/60 to-transparent px-1.5 pb-1 pt-4 text-[10px] text-white">{a.captured_at ? fmtDateTime(a.captured_at) : a.file_name}</span>
            </a>
          ))}
        </div>
      )}
      <ul className="space-y-1.5" data-testid="attachments">
        {items.map((a) => (
          <li key={a.id} className="flex items-center gap-2.5 rounded-input border border-line px-2.5 py-2 text-sm">
            <FileKindIcon a={a} />
            <div className="min-w-0 flex-1">
              <a href={`/api/attachments/${a.id}/download${a.kind === 'file' ? '?inline=1' : ''}`} target="_blank" rel="noopener noreferrer" className="block truncate font-semibold text-accent-700 hover:underline">
                {a.doc_title || a.file_name || a.url}
              </a>
              <div className="flex flex-wrap gap-x-2 text-xs text-ink-2">
                <span>{SOURCE_LABEL[a.source] ?? a.source}</span>
                {a.doc_version && <span>버전 {a.doc_version}</span>}
                {a.doc_base_date && <span>기준일 {fmtDate(a.doc_base_date)}</span>}
                {a.doc_owner && <span>문서 담당 {a.doc_owner}</span>}
                {a.size_bytes ? <span>{fmtSize(Number(a.size_bytes))}</span> : null}
                {a.captured_at && isImage(a) && <span>촬영 {fmtDateTime(a.captured_at)}</span>}{/* 로컬 검수 10/17: 문서(txt 등)는 "촬영" 아님 */}
                <span>{a.created_by_name}</span>
                {a.kind === 'link' && <span className="truncate">원본: {(() => { try { return new URL(a.url).hostname; } catch { return ''; } })()}</span>}
              </div>
            </div>
            {/* V14 49: 업무를 볼 수 있는 사람 누구나 미리보기(PDF·사진)·내려받기 — 앱은 서명 주소를 받아 기기 브라우저/공유로 넘김 */}
            {isVideo(a) && <button type="button" onClick={() => setView(a)} className="flex size-11 shrink-0 items-center justify-center rounded-input text-ink-2 hover:bg-slate-100 sm:size-8" aria-label={`${a.file_name} 재생`} title="재생" data-testid="att-play"><Eye className="size-4" /></button>}
            {a.kind === 'file' && /^(image\/|application\/pdf)/.test(a.mime_type ?? '') && (
              <button type="button" onClick={() => openFile(a.id, true)} className="flex size-11 shrink-0 items-center justify-center rounded-input text-ink-2 hover:bg-slate-100 sm:size-8" aria-label={`${a.file_name} 미리보기`} title="미리보기" data-testid="att-preview"><Eye className="size-4" /></button>
            )}
            {a.kind === 'file' && (
              <button type="button" onClick={() => openFile(a.id, false)} className="flex size-11 shrink-0 items-center justify-center rounded-input text-ink-2 hover:bg-slate-100 sm:size-8" aria-label={`${a.file_name} 내려받기`} title="내려받기" data-testid="att-download"><Download className="size-4" /></button>
            )}
            {a.kind === 'file' && editKind(a) === 'doc' && canEdit && <button type="button" onClick={() => openDoc(a)} className="inline-flex h-8 shrink-0 items-center gap-1 rounded-input border border-accent-200 bg-accent-50 px-2 text-xs font-medium text-accent-700 hover:bg-accent-100" title="Word 파일을 워크인 문서로 열어 요청자·담당자가 같이 고치고 [업무로 저장]" data-testid="att-edit-doc"><PenLine className="size-3.5" />{a.doc_id ? '편집 계속' : '열어서 편집'}</button>}
            {a.kind === 'file' && editKind(a) === 'sheet' && canEdit && <button type="button" onClick={() => setSheetOf(a)} className="inline-flex h-8 shrink-0 items-center gap-1 rounded-input border border-accent-200 bg-accent-50 px-2 text-xs font-medium text-accent-700 hover:bg-accent-100" title="Excel 칸 값을 고쳐 새 버전으로(서식·수식 그대로)" data-testid="att-edit-sheet"><Table2 className="size-3.5" />칸 고치기</button>}
            {a.kind === 'file' && canEdit && <button type="button" onClick={() => { setVerTarget(a); verRef.current?.click(); }} className="flex size-11 shrink-0 items-center justify-center rounded-input text-ink-2 hover:bg-slate-100 sm:size-8" aria-label={`${a.file_name} 새 버전 올리기`} title="내려받아 고친 파일을 새 버전으로(이전 버전 보관)" data-testid="att-new-version"><Upload className="size-4" /></button>}
            {a.kind === 'file' && (Number(a.version ?? 1) > 1 || a.doc_id) && <button type="button" onClick={() => setVersionsOf(a)} className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full bg-slate-100 px-2 text-[11px] font-semibold text-ink-2 hover:bg-slate-200" title="버전 기록·되돌리기" data-testid="att-versions"><History className="size-3" />v{a.version ?? 1}</button>}
            {(a.created_by === meId || canEdit) && <button onClick={() => remove(a.id)} className="rounded p-1 text-ink-3 hover:bg-red-50 hover:text-red-600" aria-label="첨부 삭제"><Trash2 className="size-4" /></button>}
          </li>
        ))}
        {!items.length && <li className="text-xs text-ink-3">첨부된 자료가 없습니다</li>}
      </ul>
      {canEdit && <div className="mt-2"><DropHint onClick={() => fileRef.current?.click()} disabled={!!busy} /></div>}
      <div className="mt-2 flex flex-wrap gap-1.5">
        <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => upload(e.target.files)} data-testid="file-input" />
        <input ref={camRef} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={(e) => upload(e.target.files)} />
        <input ref={albumRef} type="file" accept="image/*,video/*" multiple className="hidden" onChange={(e) => upload(e.target.files)} data-testid="album-input" />
        <input ref={vidRef} type="file" accept="video/*" capture="environment" className="hidden" onChange={(e) => upload(e.target.files)} data-testid="video-input" />
        <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()} disabled={!!busy}><Paperclip />파일 첨부</Button>
        {taskId && <Button size="sm" variant="secondary" onClick={() => setLibOpen(true)} disabled={!!busy} title="자료실에 있는 파일을 이 업무에 연결(복사 아님, 자료실 권한 그대로)" data-testid="att-from-library"><FolderOpen />자료실에서</Button>}
        <Button size="sm" variant="secondary" onClick={() => camRef.current?.click()} disabled={!!busy}><Camera />사진 촬영</Button>
        <Button size="sm" variant="secondary" onClick={() => albumRef.current?.click()} disabled={!!busy}><ImageIcon />사진·영상</Button>
        <Button size="sm" variant="secondary" onClick={() => vidRef.current?.click()} disabled={!!busy} className="sm:hidden" title="영상 촬영(100MB 까지)" data-testid="att-video-capture"><Video />영상 촬영</Button>
        <Button size="sm" variant="secondary" onClick={() => setLinkOpen(true)}><Link2 />문서 링크 연결</Button>
        {busy && <span className="inline-flex items-center gap-1.5 text-xs text-ink-2"><Loader2 className="size-3.5 animate-spin" />{busy}</span>}
      </div>
      {/* 사진 크게 보기: 좌우로 넘기기 */}
      {view && (
        <div className="fixed inset-0 z-[80] flex flex-col bg-black/90" role="dialog" aria-label="사진 보기" data-testid="photo-viewer" onClick={() => setView(null)}>
          <div className="flex items-center justify-between px-4 pb-2 pt-[calc(var(--sat)+8px)] text-sm text-white">
            <span className="truncate">{view.file_name}{view.captured_at && isImage(view) ? ` · 촬영 ${fmtDateTime(view.captured_at)}` : ''}</span>
            <button type="button" className="rounded px-2 py-1 text-white/90" aria-label="사진 닫기" onClick={() => setView(null)}>닫기</button>
          </div>
          <div className="relative flex min-h-0 flex-1 items-center justify-center" onClick={(e) => e.stopPropagation()}>
            <MediaFull src={`/api/attachments/${view.id}/download?inline=1`} mime={view.mime_type} alt={view.file_name} className="max-h-full max-w-full object-contain" />
            {photos.length > 1 && <>
              <button type="button" aria-label="이전 사진" className="absolute left-2 rounded-full bg-white/20 px-3 py-2 text-2xl text-white" onClick={() => setView(photos[(photos.indexOf(photos.find((p) => p.id === view.id)) - 1 + photos.length) % photos.length])}>‹</button>
              <button type="button" aria-label="다음 사진" className="absolute right-2 rounded-full bg-white/20 px-3 py-2 text-2xl text-white" onClick={() => setView(photos[(photos.indexOf(photos.find((p) => p.id === view.id)) + 1) % photos.length])}>›</button>
            </>}
          </div>
          <a href={`/api/attachments/${view.id}/download`} className="mx-auto mb-[calc(var(--sab)+12px)] mt-2 text-sm text-white/80 underline" onClick={(e) => e.stopPropagation()}>원본 내려받기</a>
        </div>
      )}
      <Modal open={linkOpen} onClose={() => setLinkOpen(false)} title="문서 링크 연결">
        <form onSubmit={addLink} className="space-y-3">
          <p className="rounded bg-slate-50 p-2 text-xs text-slate-600">링크만 연결하며 문서를 복사하지 않습니다. 열람 권한은 원본 서비스(Google Drive·ChatGPT 등)의 공유 설정을 그대로 따릅니다. ChatGPT 결과물은 공유 링크를 붙이거나 파일로 내려받아 첨부하세요.</p>
          <Field label="링크 (https://)"><input className={inputCls} type="url" required value={link.url ?? ''} onChange={(e) => setLink({ ...link, url: e.target.value })} /></Field>
          <Field label="문서명"><input className={inputCls} value={link.docTitle ?? ''} onChange={(e) => setLink({ ...link, docTitle: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="기준일"><input className={inputCls} type="date" value={link.docBaseDate ?? ''} onChange={(e) => setLink({ ...link, docBaseDate: e.target.value })} /></Field>
            <Field label="버전"><input className={inputCls} value={link.docVersion ?? ''} onChange={(e) => setLink({ ...link, docVersion: e.target.value })} placeholder="v1.2" /></Field>
            <Field label="문서 담당자"><input className={inputCls} value={link.docOwner ?? ''} onChange={(e) => setLink({ ...link, docOwner: e.target.value })} /></Field>
            <Field label="원본 위치">
              <select className={inputCls} value={link.source ?? ''} onChange={(e) => setLink({ ...link, source: e.target.value })}>
                <option value="">주소로 자동 판별</option><option value="google_drive">Google Drive</option><option value="chatgpt">ChatGPT 결과물</option>
                <option value="notion">Notion</option><option value="web">웹</option><option value="other">기타</option>
              </select>
            </Field>
          </div>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setLinkOpen(false)}>취소</Button><Button type="submit">연결</Button></div>
        </form>
      </Modal>
      <UploadProgress items={prog} />
      <input ref={verRef} type="file" className="hidden" onChange={(e) => uploadVersion(verTarget, e.target.files?.[0])} aria-label="새 버전 파일" data-testid="att-version-file" />
      {versionsOf && <VersionsModal a={versionsOf} canEdit={canEdit} onClose={() => setVersionsOf(null)} onChange={() => { onChange(); broadcastRefresh(); }} />}
      {sheetOf && <SheetEditModal a={sheetOf} onClose={() => setSheetOf(null)} onSaved={() => { setSheetOf(null); onChange(); broadcastRefresh(); }} />}
      {libOpen && taskId && <LibraryPickModal onClose={() => setLibOpen(false)} onPick={async (files) => {
        let ok = 0; for (const f of files) { try { await api(`/api/library/${f.id}/attach`, { body: { taskId } }); ok++; } catch (e: any) { toast.error(`${f.title}: ${e.message}`); } }
        if (ok) toast.ok(`자료실 파일 ${ok}건을 첨부했습니다`); setLibOpen(false); onChange(); broadcastRefresh(); }} />}
    </DropZone>
  );
}

const VKIND: Record<string, string> = { original: '원본', upload: '새 파일 올림', doc: '문서 편집 저장', sheet: '칸 고침', restore: '되돌림' };
function VersionsModal({ a, canEdit, onClose, onChange }: { a: any; canEdit: boolean; onClose: () => void; onChange: () => void }) {
  const [data, setData] = useState<any | null>(null);
  const load = () => api<any>(`/api/attachments/${a.id}/versions`).then(setData).catch((e) => toast.error(e.message));
  useEffect(() => { load(); }, [a.id]); // eslint-disable-line react-hooks/exhaustive-deps
  async function restore(v: any) {
    if (!confirm(`v${v.version}(${v.file_name})으로 되돌릴까요? 지금 파일은 이전 버전으로 남습니다.`)) return;
    try { await api(`/api/attachments/${a.id}/versions/${v.id}/restore`, { body: {} }); toast.ok('되돌렸습니다'); load(); onChange(); } catch (e: any) { toast.error(e.message); }
  }
  return (
    <Modal open onClose={onClose} title={`버전 기록 — ${a.file_name}`}>
      {!data ? <p className="text-sm text-ink-2">불러오는 중…</p> : <div className="space-y-2 text-sm" data-testid="att-version-list">
        <p className="text-xs text-ink-2">현재 v{data.current}. 이전 버전은 그대로 보관되고, 되돌리면 새 버전으로 쌓입니다.{data.docId && <> · <a className="underline" href={`/library/doc/${data.docId}?att=${a.id}`}>워크인 문서 열기</a></>}</p>
        <ul className="divide-y divide-line">{data.versions.map((v: any) => <li key={v.id} className="flex flex-wrap items-center gap-2 py-1.5" data-testid="att-version" data-version={v.version}>
          <b className={cx('tabular-nums', v.version === data.current && 'text-accent-700')}>v{v.version}</b><span className="truncate">{v.file_name}</span>
          <span className="text-xs text-ink-3">{VKIND[v.kind] ?? v.kind}{v.note ? ` · ${v.note}` : ''} · {v.created_by_name ?? ''} · {fmtDateTime(v.created_at)}</span>
          <span className="ml-auto flex gap-1"><a href={`/api/attachments/${a.id}/versions/${v.id}/download`} className="rounded-input border border-line px-2 py-0.5 text-xs hover:bg-slate-50">내려받기</a>
            {canEdit && v.version !== data.current && <button type="button" onClick={() => restore(v)} className="rounded-input border border-line px-2 py-0.5 text-xs hover:bg-slate-50" data-testid="att-version-restore">이 버전으로</button>}</span></li>)}
          {!data.versions.length && <li className="py-2 text-xs text-ink-3">아직 고친 기록이 없습니다</li>}</ul>
      </div>}
    </Modal>
  );
}
/** xlsx 칸 고치기: 값 있는 칸만 표로(수식 칸은 잠금), 바꾼 칸만 저장 → 서식·수식·병합 그대로 새 버전 */
function SheetEditModal({ a, onClose, onSaved }: { a: any; onClose: () => void; onSaved: () => void }) {
  const [lay, setLay] = useState<any | null>(null); const [sheet, setSheet] = useState(0); const [edits, setEdits] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false);
  useEffect(() => { api<any>(`/api/attachments/${a.id}/sheet`).then(setLay).catch((e) => { toast.error(e.message); onClose(); }); }, [a.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!lay) return <Modal open onClose={onClose} title={a.file_name}><p className="text-sm text-ink-2">불러오는 중…</p></Modal>;
  const sh = lay.sheets[sheet]; const cells: [string, any][] = Object.entries(sh?.cells ?? {});
  const keyOf = (ref: string) => `${sh.name}\u0000${ref}`;
  async function save() {
    const list = Object.entries(edits).map(([k, value]) => { const [sheetName, cell] = k.split('\u0000'); return { sheet: sheetName, cell, value: value === '' ? null : (Number.isFinite(Number(value)) && value.trim() !== '' && !/^0\d/.test(value) ? Number(value) : value) }; });
    if (!list.length) { toast.error('바꾼 칸이 없습니다'); return; }
    setBusy(true);
    try { const r = await api<any>(`/api/attachments/${a.id}/sheet`, { body: { edits: list } }); toast.ok(`v${r.version} 으로 저장했습니다${r.warnings?.length ? ` (${r.warnings[0]})` : ''}`); onSaved(); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title={`칸 고치기 — ${a.file_name}`} wide>
      <div className="space-y-2 text-sm" data-testid="sheet-edit">
        <div className="flex flex-wrap items-center gap-2 text-xs">{lay.sheets.map((s: any, i: number) => <button key={s.name} type="button" onClick={() => setSheet(i)} className={cx('rounded-full border px-2 py-0.5', i === sheet ? 'border-accent-300 bg-accent-50 text-accent-700' : 'border-line')}>{s.name}</button>)}
          <span className="ml-auto text-ink-3">값이 있는 칸만 보입니다. 수식(=) 칸은 바꾸지 않습니다. 서식·병합·인쇄 설정은 그대로.</span></div>
        <div className="max-h-[60vh] overflow-auto rounded-input border border-line"><table className="w-full text-xs"><thead className="sticky top-0 bg-slate-50 text-left text-ink-3"><tr><th className="px-2 py-1">칸</th><th className="px-2 py-1">값</th></tr></thead>
          <tbody>{cells.map(([ref, v]) => { const formula = typeof v === 'string' && v.startsWith('='); const k = keyOf(ref); const cur = k in edits ? edits[k] : String(v);
            return <tr key={ref} className="border-t border-line"><td className="px-2 py-1 font-mono text-ink-2">{ref}</td><td className="px-2 py-0.5">{formula ? <span className="text-ink-3">{String(v)}</span>
              : lay.canEdit ? <input className={cx(inputCls, 'h-7 py-0 text-xs', k in edits && 'border-accent-400 bg-accent-50/40')} value={cur} onChange={(e) => setEdits({ ...edits, [k]: e.target.value })} aria-label={`${sh.name} ${ref}`} data-testid={`cell-${ref}`} /> : String(v)}</td></tr>; })}
            {!cells.length && <tr><td colSpan={2} className="px-2 py-3 text-ink-3">값이 있는 칸이 없습니다</td></tr>}</tbody></table></div>
        {lay.canEdit && <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>취소</Button><Button onClick={save} disabled={busy || !Object.keys(edits).length} data-testid="sheet-save">새 버전으로 저장{Object.keys(edits).length ? ` (${Object.keys(edits).length}칸)` : ''}</Button></div>}
      </div>
    </Modal>
  );
}

/** V35 1: 파일 종류 색 — PDF 빨강 · 엑셀 초록 · 이미지 보라 · 한글 파랑 · 워드 하늘 · 발표 주황 · 링크/기타 회색 */
export function fileKind(a: { kind?: string; file_name?: string | null; mime_type?: string | null }): { key: string; label: string; cls: string } {
  if (a.kind === 'link') return { key: 'link', label: '링크', cls: 'bg-slate-100 text-slate-600' };
  const ext = (a.file_name ?? '').toLowerCase().split('.').pop() ?? '';
  const mime = a.mime_type ?? '';
  if (ext === 'pdf' || mime === 'application/pdf') return { key: 'pdf', label: 'PDF', cls: 'bg-red-100 text-red-700' };
  if (['xls', 'xlsx', 'csv'].includes(ext) || /spreadsheet|excel|csv/.test(mime)) return { key: 'xls', label: '엑셀', cls: 'bg-green-100 text-green-700' };
  if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic'].includes(ext)) return { key: 'img', label: '사진', cls: 'bg-violet-100 text-violet-700' };
  if (['hwp', 'hwpx'].includes(ext)) return { key: 'hwp', label: '한글', cls: 'bg-blue-100 text-blue-700' };
  if (['doc', 'docx'].includes(ext) || /word/.test(mime)) return { key: 'doc', label: '워드', cls: 'bg-sky-100 text-sky-700' };
  if (['ppt', 'pptx'].includes(ext) || /presentation/.test(mime)) return { key: 'ppt', label: '발표', cls: 'bg-orange-100 text-orange-700' };
  return { key: 'file', label: '파일', cls: 'bg-slate-100 text-slate-600' };
}
export function FileKindIcon({ a, small }: { a: any; small?: boolean }) {
  const k = fileKind(a);
  return (
    <span className={cx('flex shrink-0 items-center justify-center rounded-md', k.cls, small ? 'size-5' : 'size-8')} title={k.label} data-file-kind={k.key} aria-hidden>
      {k.key === 'link' ? <Link2 className={small ? 'size-3' : 'size-4'} /> : k.key === 'img' ? <ImageIcon className={small ? 'size-3' : 'size-4'} /> : <FileText className={small ? 'size-3' : 'size-4'} />}
    </span>
  );
}

/** 1MB 미만은 KB, 1KB 미만은 바이트 */
export function fmtSize(b: number) {
  if (b < 1024) return `${b}B`;
  if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))}KB`;
  return `${(b / 1024 / 1024).toFixed(1)}MB`;
}

/** 대표 10/20 23:55: 자료실에서 가져오기 — 검색(이름·폴더·내용)·공간·폴더·최근 파일·여러 개 체크. 같은 파일을 업무에 연결(복사 아님), 권한은 자료실 폴더 권한 그대로 */
export type LibPicked = { id: string; title: string; file_name: string; size_bytes?: number };
export function LibraryPickModal({ onClose, onPick, title = '자료실에서 가져오기', confirmLabel = '첨부' }: { onClose: () => void; onPick: (files: LibPicked[]) => void | Promise<void>; title?: string; confirmLabel?: string }) {
  const [q, setQ] = useState(''); const [query, setQuery] = useState(''); const [space, setSpace] = useState('all'); const [folder, setFolder] = useState('*');
  const [sel, setSel] = useState<Record<string, LibPicked>>({}); const [busy, setBusy] = useState(false);
  const [data, setData] = useState<any | null>(null); const [err, setErr] = useState('');
  useEffect(() => { let on = true; setData(null);
    api<any>(`/api/library?limit=60&space=${encodeURIComponent(space)}&folder=${encodeURIComponent(folder)}&q=${encodeURIComponent(query)}`).then((d) => { if (on) setData(d); }).catch((e) => { if (on) setErr(e.message); });
    return () => { on = false; }; }, [query, space, folder]);
  const files: any[] = (data?.files ?? []).filter((f: any) => f.mime_type !== 'application/x-workin-doc');
  const n = Object.keys(sel).length;
  const SP: Record<string, string> = { all: '전체', work: '업무', sales: '영업', marketing: '마케팅' };
  return (
    <Modal open onClose={onClose} title={title} wide>
      <div className="space-y-2 text-sm" data-testid="lib-pick">
        <form onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); }} className="flex flex-wrap items-center gap-1.5">
          <input className={cx(inputCls, 'h-9 min-w-0 flex-1')} value={q} onChange={(e) => setQ(e.target.value)} placeholder="파일 이름·폴더·내용으로 찾기" aria-label="자료 검색" data-testid="lib-pick-q" />
          <Button size="sm" type="submit" variant="secondary"><Search />찾기</Button>
          {(data?.spaces?.length ?? 0) > 1 && <select className={cx(inputCls, 'h-9 w-auto py-0')} value={space} onChange={(e) => { setSpace(e.target.value); setFolder('*'); }} aria-label="공간"><option value="all">모든 공간</option>{(data?.spaces ?? []).map((s: string) => <option key={s} value={s}>{SP[s] ?? s}</option>)}</select>}
          <select className={cx(inputCls, 'h-9 max-w-[12rem] py-0')} value={folder} onChange={(e) => setFolder(e.target.value)} aria-label="폴더" data-testid="lib-pick-folder"><option value="*">모든 폴더</option>{(data?.folders ?? []).map((f: any) => <option key={f.folder} value={f.folder}>{f.folder || '(최상위)'}{f.n ? ` (${f.n})` : ''}</option>)}</select>
        </form>
        {err && <p className="text-xs text-red-700">{err}</p>}
        <p className="text-[11px] text-ink-3">{query ? `"${query}" 검색 결과` : '최근 올린 순'} · 체크한 파일을 이 업무에 연결합니다(복사 아님 — 자료실에서 지우거나 등급을 바꾸면 업무에서도 같이 적용).</p>
        <ul className="max-h-[50vh] divide-y divide-line overflow-y-auto rounded-input border border-line" data-testid="lib-pick-list">
          {!data && !err && <li className="px-3 py-3 text-xs text-ink-3">불러오는 중…</li>}
          {files.map((f) => { const on = !!sel[f.id]; return (
            <li key={f.id}><label className={cx('flex cursor-pointer items-center gap-2.5 px-2.5 py-2 hover:bg-slate-50', on && 'bg-accent-50/50')} data-testid="lib-pick-item">
              <input type="checkbox" className="size-4 accent-brand-600" checked={on} onChange={() => setSel((s) => { const c = { ...s }; if (c[f.id]) delete c[f.id]; else c[f.id] = { id: f.id, title: f.title || f.file_name, file_name: f.file_name, size_bytes: Number(f.size_bytes) }; return c; })} aria-label={`${f.title || f.file_name} 선택`} />
              <FileKindIcon a={{ kind: 'file', mime_type: f.mime_type, file_name: f.file_name }} small />
              <span className="min-w-0 flex-1"><span className="block truncate font-medium">{f.title || f.file_name}</span><span className="block truncate text-[11px] text-ink-3">{f.folder || '최상위'}{f.security === 'confidential' ? ' · 기밀' : ''} · {f.created_by_name ?? ''} · {fmtDate(f.updated_at ?? f.created_at)}</span></span>
              <span className="text-xs tabular-nums text-ink-3">{f.size_bytes ? fmtSize(Number(f.size_bytes)) : ''}</span>
            </label></li>); })}
          {data && !files.length && <li className="px-3 py-3 text-xs text-ink-3">{query ? '찾는 자료가 없습니다' : '자료실에 파일이 없습니다'}</li>}
        </ul>
        <div className="flex items-center justify-end gap-2"><span className="mr-auto text-xs text-ink-2">{n ? `${n}개 선택` : ''}</span><Button variant="secondary" onClick={onClose}>취소</Button>
          <Button onClick={async () => { setBusy(true); try { await onPick(Object.values(sel)); } finally { setBusy(false); } }} disabled={!n || busy} data-testid="lib-pick-go">{confirmLabel}{n ? ` (${n})` : ''}</Button></div>
      </div>
    </Modal>
  );
}
