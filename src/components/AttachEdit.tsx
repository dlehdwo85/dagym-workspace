'use client';
// #533 업무 첨부 [고치기](대표 10/23 23:50 "첨부파일 올린 상태에서 수정 후 저장"): 형식별 브라우저 편집기 → 같은 첨부의 새 버전(이전 버전 보관·되돌리기).
// 글(txt·csv·md…) = 글 편집 · 사진 = 돌리기·자르기·펜·글자 · PDF = 가리기(흰 상자)·글자·체크·서명(서버가 찍음) · 그 밖(한글·파워포인트…) = 내려받아 고친 뒤 [고친 파일 올리기] 안내
import { useEffect, useRef, useState } from 'react';
import { Check, Crop, Download, Eraser, Loader2, Move, PenLine, RotateCcw, RotateCw, Trash2, Type, Undo2, Upload, X } from 'lucide-react';
import { api } from './client';
import { putFile } from './upload';
import { usePdfPages } from './pdfPages';
import { SignaturePad } from './SignaturePad';
import { Button, Modal, cx, inputCls, toast } from './ui';

export type EditMode = 'doc' | 'sheet' | 'text' | 'image' | 'pdf' | 'other';
const MB = 1024 * 1024;
const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|xml|ya?ml|log|ini|html?)$/i;
/** 어떤 편집기로 고치나 — docx·xlsx 는 기존 편집(워크인 문서·칸 고치기) */
export function editModeOf(a: { file_name?: string | null; mime_type?: string | null; size_bytes?: number | string | null }): EditMode {
  const n = String(a.file_name ?? ''), m = String(a.mime_type ?? ''), size = Number(a.size_bytes ?? 0);
  if (/\.docx$/i.test(n)) return 'doc';
  if (/\.xlsx$/i.test(n)) return 'sheet';
  if ((TEXT_EXT.test(n) || /^text\//.test(m) || m === 'application/json') && size <= 2 * MB) return 'text';
  if (/^image\/(png|jpeg|webp)$/.test(m) && size <= 30 * MB) return 'image';
  if ((m === 'application/pdf' || /\.pdf$/i.test(n)) && size <= 50 * MB) return 'pdf';
  return 'other';
}
const formatName = (n: string) => (/\.hwpx?$/i.test(n) ? '한글' : /\.pptx?$/i.test(n) ? '파워포인트' : /\.doc$/i.test(n) ? '옛 Word(.doc)' : /\.xls$/i.test(n) ? '옛 Excel(.xls)' : /^image\//.test(n) ? '사진' : '이 형식');
const readErr = async (r: Response) => (await r.json().catch(() => null))?.error?.message ?? `불러오지 못했습니다(${r.status})`;

/** 고친 글·사진을 같은 첨부의 새 버전으로(올릴 자리 → 올리기 → 완료) */
async function saveAsVersion(a: any, blob: Blob, edit: 'text' | 'image', note: string, fileName: string = a.file_name) {
  const mimeType = blob.type || a.mime_type;
  const st = await api<any>(`/api/attachments/${a.id}/versions`, { body: { fileName, mimeType, size: blob.size, note } });
  await putFile(st.upload, blob);
  return api<{ version: number }>(`/api/attachments/${a.id}/versions/complete`, { body: { key: st.key, fileName, mimeType, note, edit } });
}

export function AttachEditModal({ a, onClose, onSaved, onDownload, onUploadNew }: { a: any; onClose: () => void; onSaved: () => void; onDownload: () => void; onUploadNew: () => void }) {
  const mode = editModeOf(a);
  const done = (v: number) => { toast.ok(`v${v} 으로 저장했습니다(이전 버전 보관)`); onSaved(); onClose(); };
  return (
    <Modal open onClose={onClose} title={`고치기 — ${a.file_name}`} wide={mode !== 'other'}>
      {mode === 'text' ? <TextEdit a={a} onDone={done} onClose={onClose} />
        : mode === 'image' ? <ImageEdit a={a} onDone={done} onClose={onClose} />
          : mode === 'pdf' ? <PdfEdit a={a} onDone={done} onClose={onClose} />
            : <OtherGuide a={a} onDownload={onDownload} onUploadNew={() => { onClose(); onUploadNew(); }} />}
    </Modal>
  );
}

const Loading = () => <p className="flex items-center gap-2 py-6 text-sm text-ink-2"><Loader2 className="size-4 animate-spin" />불러오는 중…</p>;

// ---------------- 글(txt·csv·md…) ----------------
function TextEdit({ a, onDone, onClose }: { a: any; onDone: (v: number) => void; onClose: () => void }) {
  const [text, setText] = useState<string | null>(null);
  const [orig, setOrig] = useState('');
  const [enc, setEnc] = useState<'utf8' | 'bom' | 'euc-kr'>('utf8');
  const [busy, setBusy] = useState(false);
  const table = /\.(csv|tsv)$/i.test(a.file_name ?? '');
  useEffect(() => {
    let dead = false;
    (async () => {
      const r = await fetch(`/api/attachments/${a.id}/raw`); if (!r.ok) throw new Error(await readErr(r));
      const buf = new Uint8Array(await r.arrayBuffer());
      let t: string; let e: 'utf8' | 'bom' | 'euc-kr' = 'utf8';
      if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) { t = new TextDecoder().decode(buf.subarray(3)); e = 'bom'; }
      else { try { t = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { t = new TextDecoder('euc-kr').decode(buf); e = 'euc-kr'; } }
      if (!dead) { setText(t); setOrig(t); setEnc(e); }
    })().catch((e) => { if (!dead) { toast.error(e.message); onClose(); } });
    return () => { dead = true; };
  }, [a.id]); // eslint-disable-line react-hooks/exhaustive-deps
  async function save() {
    if (text === null) return;
    if (!text.length) { toast.error('내용이 비어 있습니다'); return; }
    setBusy(true);
    try {
      const body = new TextEncoder().encode(text);
      const bom = enc === 'bom' || (enc === 'euc-kr' && table); // 엑셀이 한글 csv 를 깨뜨리지 않게
      const blob = new Blob(bom ? [new Uint8Array([0xef, 0xbb, 0xbf]), body] : [body], { type: a.mime_type || 'text/plain' });
      onDone((await saveAsVersion(a, blob, 'text', '브라우저에서 글 고침')).version);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  if (text === null) return <Loading />;
  return (
    <div className="space-y-2" data-testid="att-text-edit">
      {enc === 'euc-kr' && <p className="rounded-input bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">옛 한글 인코딩(EUC-KR) 파일이라 저장하면 UTF-8 로 바뀝니다{table ? ' — 엑셀에서 한글이 깨지지 않게 표시를 붙여 저장합니다' : ''}.</p>}
      <textarea className={cx(inputCls, 'h-[55vh] w-full resize-y font-mono text-[13px] leading-relaxed')} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} aria-label="파일 내용" data-testid="att-text-area" />
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-2">
        <span>{text.split('\n').length.toLocaleString()}줄 · {text.length.toLocaleString()}자{text !== orig && ' · 고침'}</span>
        <span className="ml-auto flex gap-2"><Button variant="secondary" onClick={onClose}>취소</Button>
          <Button onClick={save} disabled={busy || text === orig} data-testid="att-edit-save">{busy && <Loader2 className="animate-spin" />}새 버전으로 저장</Button></span>
      </div>
    </div>
  );
}

// ---------------- 사진: 돌리기·자르기·펜·글자 (고친 순서를 기록해 두고 원본에서 다시 그림 → 되돌리기 자유) ----------------
type Op = { t: 'rot'; dir: 1 | -1 } | { t: 'crop'; x: number; y: number; w: number; h: number } | { t: 'pen'; pts: [number, number][]; color: string; width: number } | { t: 'text'; x: number; y: number; text: string; color: string; size: number };
const COLORS = ['#e11d48', '#111827', '#2563eb', '#facc15', '#ffffff'];
const MAX_SIDE = 6000;
function renderOps(src: ImageBitmap, ops: Op[]): HTMLCanvasElement {
  let c = document.createElement('canvas');
  const sc = Math.min(1, MAX_SIDE / Math.max(src.width, src.height));
  c.width = Math.round(src.width * sc); c.height = Math.round(src.height * sc);
  c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height);
  for (const op of ops) {
    if (op.t === 'rot') { const n = document.createElement('canvas'); n.width = c.height; n.height = c.width; const g = n.getContext('2d')!; g.translate(n.width / 2, n.height / 2); g.rotate((op.dir * Math.PI) / 2); g.drawImage(c, -c.width / 2, -c.height / 2); c = n; }
    else if (op.t === 'crop') { const n = document.createElement('canvas'); n.width = op.w; n.height = op.h; n.getContext('2d')!.drawImage(c, op.x, op.y, op.w, op.h, 0, 0, op.w, op.h); c = n; }
    else if (op.t === 'pen') { const g = c.getContext('2d')!; g.strokeStyle = op.color; g.lineWidth = op.width; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath(); op.pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); if (op.pts.length === 1) g.lineTo(op.pts[0][0] + 0.1, op.pts[0][1]); g.stroke(); }
    else { const g = c.getContext('2d')!; g.font = `bold ${op.size}px sans-serif`; g.textBaseline = 'top'; g.lineJoin = 'round'; g.lineWidth = Math.max(2, op.size / 7); g.strokeStyle = op.color === '#ffffff' ? '#111827' : '#ffffff'; g.strokeText(op.text, op.x, op.y); g.fillStyle = op.color; g.fillText(op.text, op.x, op.y); }
  }
  return c;
}
function ImageEdit({ a, onDone, onClose }: { a: any; onDone: (v: number) => void; onClose: () => void }) {
  const [bmp, setBmp] = useState<ImageBitmap | null>(null);
  const [ops, setOps] = useState<Op[]>([]);
  const [tool, setTool] = useState<'pen' | 'text' | 'crop' | null>('pen');
  const [color, setColor] = useState(COLORS[0]);
  const [sel, setSel] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null); // 자르기 범위(그림 좌표)
  const [typing, setTyping] = useState<{ x: number; y: number; v: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const view = useRef<HTMLCanvasElement>(null);
  const stroke = useRef<[number, number][] | null>(null);
  useEffect(() => {
    let dead = false;
    (async () => {
      const r = await fetch(`/api/attachments/${a.id}/raw`); if (!r.ok) throw new Error(await readErr(r));
      const b = await createImageBitmap(await r.blob(), { imageOrientation: 'from-image' });
      if (!dead) setBmp(b);
    })().catch((e) => { if (!dead) { toast.error(e.message || '사진을 열지 못했습니다'); onClose(); } });
    return () => { dead = true; };
  }, [a.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { // 기록이 바뀌면 원본에서 다시 그려 화면에
    if (!bmp || !view.current) return;
    const out = renderOps(bmp, ops), v = view.current;
    v.width = out.width; v.height = out.height; v.getContext('2d')!.drawImage(out, 0, 0);
  }, [bmp, ops]);
  const long = () => Math.max(view.current?.width ?? 1000, view.current?.height ?? 1000);
  const pt = (e: { clientX: number; clientY: number }): [number, number] => { const c = view.current!, r = c.getBoundingClientRect(); return [((e.clientX - r.left) * c.width) / r.width, ((e.clientY - r.top) * c.height) / r.height]; };
  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!tool) return;
    const p = pt(e);
    if (tool === 'text') { setTyping({ x: p[0], y: p[1], v: '' }); return; }
    e.currentTarget.setPointerCapture(e.pointerId);
    if (tool === 'pen') { stroke.current = [p]; const g = view.current!.getContext('2d')!; g.strokeStyle = color; g.lineWidth = Math.max(2, Math.round(long() / 250)); g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath(); g.moveTo(p[0], p[1]); }
    else setSel({ x0: p[0], y0: p[1], x1: p[0], y1: p[1] });
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    const p = pt(e);
    if (tool === 'pen' && stroke.current) { stroke.current.push(p); const g = view.current!.getContext('2d')!; g.lineTo(p[0], p[1]); g.stroke(); g.beginPath(); g.moveTo(p[0], p[1]); }
    else if (tool === 'crop' && sel && e.buttons) setSel({ ...sel, x1: p[0], y1: p[1] });
  }
  function up() {
    if (tool === 'pen' && stroke.current) { const pts = stroke.current; stroke.current = null; setOps((o) => [...o, { t: 'pen', pts, color, width: Math.max(2, Math.round(long() / 250)) }]); }
  }
  const cropBox = sel && { x: Math.round(Math.max(0, Math.min(sel.x0, sel.x1))), y: Math.round(Math.max(0, Math.min(sel.y0, sel.y1))), w: Math.round(Math.abs(sel.x1 - sel.x0)), h: Math.round(Math.abs(sel.y1 - sel.y0)) };
  const cropOk = !!cropBox && cropBox.w > 8 && cropBox.h > 8;
  const pct = (v: number, of: 'w' | 'h') => `${(v / ((of === 'w' ? view.current?.width : view.current?.height) || 1)) * 100}%`;
  function commitText() { if (typing?.v.trim()) setOps((o) => [...o, { t: 'text', x: typing.x, y: typing.y, text: typing.v.trim(), color, size: Math.max(14, Math.round(long() / 22)) }]); setTyping(null); }
  async function save() {
    if (!bmp) return;
    setBusy(true);
    try {
      const out = renderOps(bmp, ops);
      const mime = /^image\/(png|jpeg|webp)$/.test(a.mime_type) ? a.mime_type : 'image/png';
      const blob: Blob | null = await new Promise((r) => out.toBlob(r, mime, 0.92));
      if (!blob) throw new Error('사진을 저장하지 못했습니다');
      const name = blob.type === a.mime_type ? a.file_name : String(a.file_name).replace(/\.\w+$/, '') + '.png'; // webp 를 못 만드는 브라우저는 png 로
      onDone((await saveAsVersion(a, blob, 'image', `브라우저에서 사진 고침(${[...new Set(ops.map((o) => ({ rot: '돌리기', crop: '자르기', pen: '펜', text: '글자' })[o.t]))].join('·')})`, name)).version);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  if (!bmp) return <Loading />;
  const tb = (on: boolean) => cx('inline-flex h-9 items-center gap-1 rounded-input border px-2.5 text-xs font-medium', on ? 'border-accent-400 bg-accent-50 text-accent-700' : 'border-line bg-white text-ink-2 hover:bg-slate-50');
  return (
    <div className="space-y-2" data-testid="att-image-edit">
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" className={tb(false)} onClick={() => { setSel(null); setOps((o) => [...o, { t: 'rot', dir: -1 }]); }} aria-label="왼쪽으로 돌리기" data-testid="img-rot-left"><RotateCcw className="size-4" /></button>
        <button type="button" className={tb(false)} onClick={() => { setSel(null); setOps((o) => [...o, { t: 'rot', dir: 1 }]); }} aria-label="오른쪽으로 돌리기" data-testid="img-rot-right"><RotateCw className="size-4" /></button>
        <button type="button" className={tb(tool === 'crop')} onClick={() => { setTool('crop'); setSel(null); }} data-testid="img-tool-crop"><Crop className="size-4" />자르기</button>
        <button type="button" className={tb(tool === 'pen')} onClick={() => setTool('pen')} data-testid="img-tool-pen"><PenLine className="size-4" />펜</button>
        <button type="button" className={tb(tool === 'text')} onClick={() => setTool('text')} data-testid="img-tool-text"><Type className="size-4" />글자</button>
        <span className="mx-1 flex gap-1">{COLORS.map((c) => <button key={c} type="button" onClick={() => setColor(c)} className={cx('size-6 rounded-full border', color === c ? 'ring-2 ring-accent-500 ring-offset-1' : 'border-line')} style={{ background: c }} aria-label={`색 ${c}`} />)}</span>
        <button type="button" className={tb(false)} onClick={() => { setSel(null); setOps((o) => o.slice(0, -1)); }} disabled={!ops.length} data-testid="img-undo"><Undo2 className="size-4" />되돌리기</button>
        {tool === 'crop' && cropOk && <Button size="sm" onClick={() => { setOps((o) => [...o, { t: 'crop', ...cropBox! }]); setSel(null); }} data-testid="img-crop-apply"><Check />이 범위로 자르기</Button>}
      </div>
      <div className="relative mx-auto w-fit max-w-full">
        <canvas ref={view} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} className={cx('block max-h-[58vh] max-w-full touch-none rounded-input border border-line bg-[repeating-conic-gradient(#f1f5f9_0_25%,#fff_0_50%)] bg-[length:16px_16px]', tool && 'cursor-crosshair')} data-testid="img-canvas" />
        {tool === 'crop' && cropBox && <div className="pointer-events-none absolute border-2 border-dashed border-accent-500 bg-accent-500/10" style={{ left: pct(cropBox.x, 'w'), top: pct(cropBox.y, 'h'), width: pct(cropBox.w, 'w'), height: pct(cropBox.h, 'h') }} />}
        {typing && <input autoFocus className={cx(inputCls, 'absolute h-8 w-48 py-0 text-sm')} style={{ left: pct(typing.x, 'w'), top: pct(typing.y, 'h') }} value={typing.v} onChange={(e) => setTyping({ ...typing, v: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter') commitText(); if (e.key === 'Escape') { e.stopPropagation(); setTyping(null); } }} onBlur={commitText} placeholder="넣을 글자 → Enter" aria-label="넣을 글자" data-testid="img-text-input" />}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-2">
        <span>{view.current?.width ?? bmp.width}×{view.current?.height ?? bmp.height} · 고친 단계 {ops.length}</span>
        <span className="ml-auto flex gap-2"><Button variant="secondary" onClick={onClose}>취소</Button>
          <Button onClick={save} disabled={busy || !ops.length} data-testid="att-edit-save">{busy && <Loader2 className="animate-spin" />}새 버전으로 저장</Button></span>
      </div>
    </div>
  );
}

// ---------------- PDF: 가리기·글자·체크·서명 (쪽 비율 좌표, 저장은 서버가 같은 자리에 찍음) ----------------
type PItem = { id: string; type: 'cover' | 'text' | 'check' | 'sign'; page: number; x: number; y: number; w: number; h: number; value?: string };
const PTOOLS = [
  { t: 'text', label: '글자', icon: Type, w: 180, h: 22 },
  { t: 'cover', label: '가리기', icon: Eraser, w: 160, h: 24 },
  { t: 'check', label: '체크', icon: Check, w: 18, h: 18 },
  { t: 'sign', label: '서명', icon: PenLine, w: 140, h: 55 },
] as const;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
function PdfEdit({ a, onDone, onClose }: { a: any; onDone: (v: number) => void; onClose: () => void }) {
  const { pages, error, total } = usePdfPages(`/api/attachments/${a.id}/raw`, 60);
  const [tool, setTool] = useState<PItem['type'] | null>('text');
  const [items, setItems] = useState<PItem[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [sig, setSig] = useState<string | null>(null);
  const [sigDraft, setSigDraft] = useState<string | null>(null);
  const [sigAt, setSigAt] = useState<Omit<PItem, 'id' | 'type'> | null>(null); // 서명을 그리면 이 자리에 놓음
  const [busy, setBusy] = useState(false);
  const [cssW, setCssW] = useState(700);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; mode: 'move' | 'size'; sx: number; sy: number; o: PItem; W: number; H: number } | null>(null);
  useEffect(() => { if (error) { toast.error(error); onClose(); } }, [error]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(() => setCssW(Math.min(820, el.clientWidth - 16))); ro.observe(el);
    return () => ro.disconnect();
  }, [pages]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (sel && (e.key === 'Delete' || e.key === 'Backspace') && !(e.target as HTMLElement).closest('textarea,input')) { setItems((x) => x.filter((i) => i.id !== sel)); setSel(null); } };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [sel]);
  const add = (it: Omit<PItem, 'id'>) => { const id = Math.random().toString(36).slice(2); setItems((x) => [...x, { ...it, id, value: it.type === 'text' ? '' : undefined }]); setSel(id); };
  function place(e: React.MouseEvent<HTMLDivElement>, n: number) {
    if (!tool || !pages || (e.target as HTMLElement).closest('[data-item]')) { if (!(e.target as HTMLElement).closest('[data-item]')) setSel(null); return; }
    const r = e.currentTarget.getBoundingClientRect(), p = pages[n - 1], d = PTOOLS.find((x) => x.t === tool)!;
    const w = Math.min(1, d.w / p.w), h = Math.min(1, d.h / p.h);
    const at = { page: n, x: clamp((e.clientX - r.left) / r.width - w / 2, 0, 1 - w), y: clamp((e.clientY - r.top) / r.height - h / 2, 0, 1 - h), w, h };
    if (tool === 'sign' && !sig) { setSigAt(at); return; }
    add({ ...at, type: tool });
  }
  function grab(e: React.PointerEvent, it: PItem, mode: 'move' | 'size') {
    if ((e.target as HTMLElement).closest('textarea') && mode === 'move') { setSel(it.id); return; }
    e.stopPropagation(); setSel(it.id);
    const page = (e.currentTarget as HTMLElement).closest('[data-page]')!.getBoundingClientRect();
    drag.current = { id: it.id, mode, sx: e.clientX, sy: e.clientY, o: it, W: page.width, H: page.height };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function moveDrag(e: React.PointerEvent) {
    const d = drag.current; if (!d) return;
    const dx = (e.clientX - d.sx) / d.W, dy = (e.clientY - d.sy) / d.H, o = d.o;
    setItems((x) => x.map((i) => (i.id !== d.id ? i : d.mode === 'move' ? { ...i, x: clamp(o.x + dx, 0, 1 - o.w), y: clamp(o.y + dy, 0, 1 - o.h) } : { ...i, w: clamp(o.w + dx, 0.01, 1 - o.x), h: clamp(o.h + dy, 0.008, 1 - o.y) })));
  }
  async function save() {
    const empty = items.find((i) => i.type === 'text' && !i.value?.trim());
    if (empty) { setSel(empty.id); toast.error('빈 글자 칸이 있습니다 — 적거나 지워 주세요'); return; }
    setBusy(true);
    try {
      const body = items.map((i) => ({ type: i.type, page: i.page, x: i.x, y: i.y, w: i.w, h: i.h, value: i.value, image: i.type === 'sign' ? sig : undefined }));
      const r = await api<{ version: number }>(`/api/attachments/${a.id}/pdf`, { body: { items: body } });
      onDone(r.version);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  if (!pages) return <Loading />;
  const tb = (on: boolean) => cx('inline-flex h-9 items-center gap-1 rounded-input border px-2.5 text-xs font-medium', on ? 'border-accent-400 bg-accent-50 text-accent-700' : 'border-line bg-white text-ink-2 hover:bg-slate-50');
  return (
    <div className="space-y-2" data-testid="att-pdf-edit">
      <div className="flex flex-wrap items-center gap-1.5">
        {PTOOLS.map((d) => <button key={d.t} type="button" className={tb(tool === d.t)} onClick={() => setTool(d.t)} data-testid={`pdf-tool-${d.t}`}><d.icon className="size-4" />{d.label}</button>)}
        {sig && <button type="button" className={tb(false)} onClick={() => { setSig(null); setItems((x) => x.filter((i) => i.type !== 'sign')); }}>서명 다시 그리기</button>}
        {sel && <button type="button" className={cx(tb(false), 'text-red-600')} onClick={() => { setItems((x) => x.filter((i) => i.id !== sel)); setSel(null); }} data-testid="pdf-item-delete"><Trash2 className="size-4" />고른 칸 지우기</button>}
        <span className="ml-auto text-xs text-ink-3">쪽을 누르면 고른 도구 칸이 놓입니다 · 끌어서 옮기고 오른쪽 아래 모서리로 크기</span>
      </div>
      {sigAt && (
        <div className="rounded-input border border-accent-200 bg-accent-50/40 p-2" data-testid="pdf-sign-pad">
          <p className="mb-1 text-xs text-ink-2">서명을 그리거나 도장 그림을 올린 뒤 [이 서명 쓰기]</p>
          <SignaturePad onChange={(png) => setSigDraft(png)} className="max-w-md" />
          <div className="mt-2 flex gap-2"><Button size="sm" variant="secondary" onClick={() => { setSigAt(null); setSigDraft(null); }}>취소</Button>
            <Button size="sm" disabled={!sigDraft} onClick={() => { setSig(sigDraft); add({ ...sigAt, type: 'sign' }); setSigAt(null); }} data-testid="pdf-sign-use">이 서명 쓰기</Button></div>
        </div>
      )}
      <div ref={box} className="max-h-[60vh] space-y-3 overflow-y-auto rounded-input bg-slate-100 p-2" onPointerMove={moveDrag} onPointerUp={() => { drag.current = null; }}>
        {total > pages.length && <p className="text-center text-xs text-amber-700">앞 {pages.length}쪽만 보입니다(전체 {total}쪽) — 뒤쪽을 고치려면 내려받아 고친 뒤 [고친 파일 올리기]</p>}
        {pages.map((p, i) => {
          const s = cssW / p.w; // 화면 px / PDF pt
          return (
            <div key={i} className={cx('relative mx-auto bg-white shadow-sm', tool && 'cursor-crosshair')} style={{ width: cssW, height: p.h * s }} onClick={(e) => place(e, i + 1)} data-testid="att-pdf-page" data-page={i + 1}>
              <img src={p.url} alt={`${i + 1}쪽`} className="pointer-events-none absolute inset-0 size-full select-none" draggable={false} />
              {items.filter((it) => it.page === i + 1).map((it) => {
                const on = sel === it.id, hPx = it.h * p.h * s;
                const lines = Math.max(1, (it.value ?? '').split('\n').length), fs = Math.max(5, Math.min(14, ((it.h * p.h) / lines) * 0.78)) * s;
                return (
                  <div key={it.id} data-item className={cx('absolute touch-none', it.type === 'cover' ? 'bg-white' : '', on ? 'outline outline-2 outline-accent-500' : it.type === 'cover' ? 'outline-dashed outline-1 outline-slate-300' : 'outline-dashed outline-1 outline-accent-300')}
                    style={{ left: `${it.x * 100}%`, top: `${it.y * 100}%`, width: `${it.w * 100}%`, height: `${it.h * 100}%`, cursor: 'move' }}
                    onPointerDown={(e) => grab(e, it, 'move')} data-testid="pdf-item" data-type={it.type}>
                    {it.type === 'text' && <textarea value={it.value} onChange={(e) => setItems((x) => x.map((y) => (y.id === it.id ? { ...y, value: e.target.value.slice(0, 2000) } : y)))} onFocus={() => setSel(it.id)} autoFocus={on && !it.value}
                      className="size-full resize-none overflow-hidden bg-transparent p-0 leading-[1.25] text-[#141419] outline-none placeholder:text-accent-400" style={{ fontSize: fs, paddingLeft: s, paddingTop: lines === 1 ? Math.max(0, (hPx - fs * 1.25) / 2) : 0 }} placeholder="글자 입력" aria-label="넣을 글자" data-testid="pdf-text-input" />}
                    {it.type === 'check' && <Check className="size-full text-[#141419]" strokeWidth={3} />}
                    {it.type === 'sign' && sig && <img src={sig} alt="서명" className="pointer-events-none size-full object-contain" />}
                    {it.type === 'cover' && hPx > 14 && <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] text-slate-300">가림</span>}
                    {on && <>
                      <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={() => { setItems((x) => x.filter((y) => y.id !== it.id)); setSel(null); }} className="absolute -right-2.5 -top-2.5 flex size-5 items-center justify-center rounded-full bg-red-500 text-white" aria-label="칸 지우기"><X className="size-3" /></button>
                      {it.type === 'text' && <span onPointerDown={(e) => grab(e, it, 'move')} className="absolute -left-2.5 -top-2.5 flex size-5 cursor-move items-center justify-center rounded-full bg-accent-500 text-white" aria-label="칸 옮기기" data-testid="pdf-item-move"><Move className="size-3" /></span>}
                      <span onPointerDown={(e) => grab(e, it, 'size')} className="absolute -bottom-1.5 -right-1.5 size-3 cursor-nwse-resize rounded-sm border border-white bg-accent-500" data-testid="pdf-item-resize" />
                    </>}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-2">
        <span>칸 {items.length}개 · 가리기는 흰 상자로 덮고, 그 위에 글자를 놓으면 고친 글자처럼 보입니다</span>
        <span className="ml-auto flex gap-2"><Button variant="secondary" onClick={onClose}>취소</Button>
          <Button onClick={save} disabled={busy || !items.length} data-testid="att-edit-save">{busy && <Loader2 className="animate-spin" />}새 버전으로 저장</Button></span>
      </div>
    </div>
  );
}

// ---------------- 그 밖: 내려받아 고친 뒤 올리기 ----------------
function OtherGuide({ a, onDownload, onUploadNew }: { a: any; onDownload: () => void; onUploadNew: () => void }) {
  const fmt = formatName(String(a.file_name ?? ''));
  return (
    <div className="space-y-3 text-sm" data-testid="att-edit-guide">
      <p>{fmt} 파일은 브라우저에서 바로 고칠 수 없습니다. 아래 순서로 고치면 <b>같은 첨부의 새 버전</b>으로 저장되고, 이전 버전은 그대로 보관됩니다.</p>
      <ol className="list-decimal space-y-1 pl-5 text-ink-2">
        <li>[내려받기]로 받아 {fmt === '한글' ? '한글 프로그램' : '쓰는 프로그램'}에서 고쳐 저장</li>
        <li>[고친 파일 올리기]로 고친 파일 선택 → v{Number(a.version ?? 1) + 1} 로 저장</li>
        <li>잘못 올렸으면 버전 기록(v 표시)에서 [되돌리기]</li>
      </ol>
      <div className="flex flex-wrap justify-end gap-2"><Button variant="secondary" onClick={onDownload}><Download />내려받기</Button><Button onClick={onUploadNew} data-testid="att-edit-upload"><Upload />고친 파일 올리기</Button></div>
    </div>
  );
}
