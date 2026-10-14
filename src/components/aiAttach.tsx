'use client';
import { useRef, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { uploadToLibrary } from './libraryUpload';
import { toast } from './ui';

export type AiFile = { id: string; name: string; thumb?: string };
const MAX = 5;
/** 첨부만 하고 글을 안 쓰면 이 요청으로 보낸다 */
export const DEFAULT_FILE_ASK = '첨부한 자료를 보고 내용을 정리해 줘';

/** AI 비서 첨부(사진·문서) — 버튼·끌어 놓기·붙여넣기(Ctrl+V 캡처). 자료실 "AI 요청 첨부"에 올리고 id 를 모은다 */
export function useAiAttach() {
  const [files, setFiles] = useState<AiFile[]>([]);
  const [uploading, setUploading] = useState('');
  const count = useRef(0); count.current = files.length;
  const inputRef = useRef<HTMLInputElement>(null);
  async function attach(list: FileList | File[] | null) {
    const arr = list ? Array.from(list) : [];
    if (!arr.length) return;
    if (count.current >= MAX) { toast.info(`한 번에 ${MAX}개까지 붙일 수 있습니다`); return; }
    for (const f of arr.slice(0, MAX - count.current)) {
      setUploading(`${f.name} 올리는 중…`);
      try {
        const r = await uploadToLibrary(f, undefined, (pct) => setUploading(`${f.name} 올리는 중… ${pct}%`));
        setFiles((x) => [...x, { ...r, thumb: f.type.startsWith('image/') ? URL.createObjectURL(f) : undefined }]);
      } catch (e: any) { toast.error(`${f.name}: ${e.message}`); }
    }
    setUploading(''); if (inputRef.current) inputRef.current.value = '';
  }
  /** 캡처 화면을 Ctrl+V 로 붙이면 이름 없는 image.png 가 온다 → 알아보기 쉬운 이름으로 */
  function onPaste(e: React.ClipboardEvent) {
    const imgs = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
    if (!imgs.length) return;
    e.preventDefault();
    const stamp = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'medium' }).format(new Date()).replace(/[: ]/g, '-');
    attach(imgs.map((f, i) => (/^image\.\w+$/i.test(f.name) || !f.name ? new File([f], `붙여넣은 이미지 ${stamp}${imgs.length > 1 ? `-${i + 1}` : ''}.${f.type.split('/')[1] || 'png'}`, { type: f.type }) : f)));
  }
  const remove = (id: string) => setFiles((x) => x.filter((y) => y.id !== id));
  /** 보낼 때: 지금 첨부를 꺼내고 비움 */
  const take = () => { const s = files; setFiles([]); return s; };
  return { files, uploading, inputRef, attach, onPaste, remove, take, full: files.length >= MAX };
}

export function AttachChips({ files, uploading, onRemove, compact }: { files: AiFile[]; uploading: string; onRemove: (id: string) => void; compact?: boolean }) {
  if (!files.length && !uploading) return null;
  return (
    <div className={compact ? 'flex flex-wrap gap-1.5 px-2 pt-2 text-xs' : 'mt-2 flex flex-wrap gap-1.5 text-xs'} data-testid="ai-files">
      {files.map((f) => (
        <span key={f.id} className="inline-flex max-w-[14rem] items-center gap-1 rounded-full bg-amber-50 py-0.5 pl-0.5 pr-2 text-amber-800">
          {f.thumb ? <img src={f.thumb} alt="" className="size-6 rounded-full object-cover" /> : <span className="pl-1.5">📎</span>}
          <span className="truncate">{f.name}</span>
          <button type="button" onClick={() => onRemove(f.id)} aria-label={`${f.name} 빼기`}><X className="size-3" /></button>
        </span>
      ))}
      {uploading && <span className="inline-flex items-center gap-1 text-ink-3"><Loader2 className="size-3 animate-spin" />{uploading}</span>}
    </div>
  );
}
