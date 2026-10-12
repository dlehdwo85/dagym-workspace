'use client';
import { useRef, useState } from 'react';
import { api, broadcastRefresh } from './client';
import { Camera, FileText, Image as ImageIcon, Link2, Loader2, Paperclip, Trash2 } from 'lucide-react';
import { Button, Field, Modal, inputCls, toast, fmtDate, fmtDateTime } from './ui';

const isImage = (a: any) => a.kind === 'file' && /^image\//.test(a.mime_type ?? '');

const SOURCE_LABEL: Record<string, string> = { upload: '업로드', google_drive: 'Google Drive', chatgpt: 'ChatGPT 결과물', notion: 'Notion', web: '웹 링크', other: '기타' };

export function Attachments({ items, taskId, eventId, canEdit, onChange, meId }: { items: any[]; taskId?: string; eventId?: string; canEdit: boolean; onChange: () => void; meId: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState('');
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState<any>({});

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      setBusy(`${file.name} 올리는 중…`);
      try {
        // B-7 촬영(파일 수정) 시각을 함께 기록 — 사진 증빙의 시점 확인용
        const capturedAt = file.lastModified ? new Date(file.lastModified).toISOString() : undefined;
        const r = await api('/api/attachments', { body: { taskId, eventId, kind: 'file', fileName: file.name, mimeType: file.type || 'application/octet-stream', size: file.size, capturedAt } });
        const up = await fetch(r.upload.url, { method: 'PUT', headers: r.upload.headers, body: file });
        if (!up.ok) throw new Error(`파일 전송 실패 (${up.status})`);
        await api(`/api/attachments/${r.id}/complete`, { body: {} });
        toast.ok(`${file.name} 첨부 완료`);
      } catch (e: any) { toast.error(`${file.name}: ${e.message}`); }
    }
    setBusy('');
    if (fileRef.current) fileRef.current.value = '';
    if (camRef.current) camRef.current.value = '';
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
  async function remove(id: string) {
    if (!confirm('첨부를 삭제할까요?')) return;
    try { await api(`/api/attachments/${id}`, { method: 'DELETE' }); onChange(); } catch (e: any) { toast.error(e.message); }
  }

  return (
    <div>
      {items.some(isImage) && (
        <div className="mb-2 grid grid-cols-3 gap-2 sm:grid-cols-4" data-testid="photo-grid">
          {items.filter(isImage).map((a) => (
            <a key={a.id} href={`/api/attachments/${a.id}/download?inline=1`} target="_blank" rel="noopener noreferrer" className="group relative block aspect-square overflow-hidden rounded-input border border-line bg-slate-100" title={a.file_name}>
              <img src={`/api/attachments/${a.id}/download?inline=1`} alt={a.file_name} loading="lazy" className="size-full object-cover transition-transform group-hover:scale-105" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
              <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/60 to-transparent px-1.5 pb-1 pt-4 text-[10px] text-white">{a.captured_at ? fmtDateTime(a.captured_at) : a.file_name}</span>
            </a>
          ))}
        </div>
      )}
      <ul className="space-y-1.5" data-testid="attachments">
        {items.map((a) => (
          <li key={a.id} className="flex items-center gap-2.5 rounded-input border border-line px-2.5 py-2 text-sm">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-slate-100 text-ink-2" aria-hidden>
              {a.kind === 'link' ? <Link2 className="size-4" /> : isImage(a) ? <ImageIcon className="size-4" /> : <FileText className="size-4" />}
            </span>
            <div className="min-w-0 flex-1">
              <a href={`/api/attachments/${a.id}/download${a.kind === 'file' ? '?inline=1' : ''}`} target="_blank" rel="noopener noreferrer" className="block truncate font-medium text-accent-700 hover:underline">
                {a.doc_title || a.file_name || a.url}
              </a>
              <div className="flex flex-wrap gap-x-2 text-xs text-ink-2">
                <span>{SOURCE_LABEL[a.source] ?? a.source}</span>
                {a.doc_version && <span>버전 {a.doc_version}</span>}
                {a.doc_base_date && <span>기준일 {fmtDate(a.doc_base_date)}</span>}
                {a.doc_owner && <span>문서 담당 {a.doc_owner}</span>}
                {a.size_bytes ? <span>{fmtSize(Number(a.size_bytes))}</span> : null}
                {a.captured_at && <span>촬영 {fmtDateTime(a.captured_at)}</span>}
                <span>{a.created_by_name}</span>
                {a.kind === 'link' && <span className="truncate">원본: {(() => { try { return new URL(a.url).hostname; } catch { return ''; } })()}</span>}
              </div>
            </div>
            {(a.created_by === meId || canEdit) && <button onClick={() => remove(a.id)} className="rounded p-1 text-ink-3 hover:bg-red-50 hover:text-red-600" aria-label="첨부 삭제"><Trash2 className="size-4" /></button>}
          </li>
        ))}
        {!items.length && <li className="text-xs text-ink-3">첨부된 자료가 없습니다</li>}
      </ul>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => upload(e.target.files)} data-testid="file-input" />
        <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => upload(e.target.files)} />
        <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()} disabled={!!busy}><Paperclip />파일 첨부</Button>
        <Button size="sm" variant="secondary" onClick={() => camRef.current?.click()} disabled={!!busy}><Camera />사진 촬영</Button>
        <Button size="sm" variant="secondary" onClick={() => setLinkOpen(true)}><Link2 />문서 링크 연결</Button>
        {busy && <span className="inline-flex items-center gap-1.5 text-xs text-ink-2"><Loader2 className="size-3.5 animate-spin" />{busy}</span>}
      </div>
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
    </div>
  );
}

/** 1MB 미만은 KB, 1KB 미만은 바이트 */
export function fmtSize(b: number) {
  if (b < 1024) return `${b}B`;
  if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))}KB`;
  return `${(b / 1024 / 1024).toFixed(1)}MB`;
}
