'use client';
import { useRef, useState } from 'react';
import { api, broadcastRefresh } from './client';
import { Button, Field, Modal, inputCls, toast, fmtDate } from './ui';

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
        const r = await api('/api/attachments', { body: { taskId, eventId, kind: 'file', fileName: file.name, mimeType: file.type || 'application/octet-stream', size: file.size } });
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
      <ul className="space-y-1.5" data-testid="attachments">
        {items.map((a) => (
          <li key={a.id} className="flex items-start gap-2 rounded-md border px-2.5 py-2 text-sm">
            <span aria-hidden>{a.kind === 'link' ? '🔗' : /^image\//.test(a.mime_type ?? '') ? '🖼' : '📄'}</span>
            <div className="min-w-0 flex-1">
              <a href={`/api/attachments/${a.id}/download${a.kind === 'file' ? '?inline=1' : ''}`} target="_blank" rel="noopener noreferrer" className="block truncate font-medium text-brand-700 hover:underline">
                {a.doc_title || a.file_name || a.url}
              </a>
              <div className="flex flex-wrap gap-x-2 text-xs text-slate-500">
                <span>{SOURCE_LABEL[a.source] ?? a.source}</span>
                {a.doc_version && <span>버전 {a.doc_version}</span>}
                {a.doc_base_date && <span>기준일 {fmtDate(a.doc_base_date)}</span>}
                {a.doc_owner && <span>문서 담당 {a.doc_owner}</span>}
                {a.size_bytes && <span>{(a.size_bytes / 1024 / 1024).toFixed(1)}MB</span>}
                <span>{a.created_by_name}</span>
                {a.kind === 'link' && <span className="truncate">원본: {(() => { try { return new URL(a.url).hostname; } catch { return ''; } })()}</span>}
              </div>
            </div>
            {(a.created_by === meId || canEdit) && <button onClick={() => remove(a.id)} className="text-xs text-slate-400 hover:text-red-600" aria-label="첨부 삭제">삭제</button>}
          </li>
        ))}
        {!items.length && <li className="text-xs text-slate-400">첨부된 자료가 없습니다</li>}
      </ul>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => upload(e.target.files)} data-testid="file-input" />
        <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => upload(e.target.files)} />
        <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()} disabled={!!busy}>파일 첨부</Button>
        <Button size="sm" variant="secondary" onClick={() => camRef.current?.click()} disabled={!!busy}>사진 촬영</Button>
        <Button size="sm" variant="secondary" onClick={() => setLinkOpen(true)}>문서 링크 연결</Button>
        {busy && <span className="text-xs text-slate-500">{busy}</span>}
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
