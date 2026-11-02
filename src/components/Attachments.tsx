'use client';
import { dtf } from '@/lib/dtf';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, api, broadcastRefresh } from './client';
import { Camera, Check, ChevronDown, ChevronLeft, ChevronRight, Download, ExternalLink, Eye, FileArchive, FileText, FolderInput, FolderOpen, History, Image as ImageIcon, Link2, Loader2, Paperclip, PenLine, Search, Table2, Trash2, Upload, Video, X } from 'lucide-react';
import { isNativeApp } from './native';
import { MediaFull } from './MediaView';
import { Button, Field, Modal, cx, inputCls, toast, fmtDate, fmtDateTime } from './ui';
import { useBackClose } from './backClose';
import { DropHint, DropZone, UploadProgress, putFile } from './upload';
import { AttachEditModal, editModeOf } from './AttachEdit';
import { holdScreen } from './awake';
import { IosPickHint, PHOTO_ACCEPT, usePickWait } from './pickWait';
import { shrinkImage } from './shrink';

export { shrinkImage } from './shrink'; // 213차: 메신저도 쓰므로 작은 파일로 옮김(예전 가져오기 그대로)

/** 일시적인 실패(연결 끊김·서버 5xx·잠시 막힘)만 한 번 더 — 크기 초과·실행 파일 같은 거절은 바로 실패 */
const retryable = (e: unknown) => !(e instanceof ApiError) || e.status >= 500 || e.status === 429;
/**
 * V12 9번: 업무·일정 첨부 올리기(여러 개·진행률·알기 쉬운 실패 원인) — 첨부 칸·댓글 칸 끌어 놓기 공용.
 * 대표 10/27(휴대폰 사진 150장): 3개씩 함께 올리고(사진 줄이기는 한 장씩), 일시 실패는 한 번 더, 올리는 동안 화면이 꺼지지 않게,
 * 실패 알림은 장수가 많으면 끝에 한 번만(몇 장 실패했는지·이름은 진행 목록에서)
 * 213차(아이폰 147장): 화면 꺼짐 막기는 앱이면 keep-awake 플러그인(아이폰 앱 화면은 웹 Wake Lock 이 없어 화면이 꺼지면 올리기가 멈춤)
 */
export type UploadItem = { name: string; pct: number; error?: string; note?: string };
export async function uploadTaskFiles(list: File[], target: { taskId?: string; eventId?: string }, setProg: (f: (x: UploadItem[]) => UploadItem[]) => void) {
  const start = list.map((f) => ({ name: f.name, pct: 0 }));
  setProg(() => start);
  const upd = (i: number, patch: Partial<{ pct: number; error: string; note: string }>) => setProg((x) => x.map((y, j) => (j === i ? { ...y, ...patch } : y)));
  const many = list.length > 3;
  const release = many ? await holdScreen() : null;
  let shrinking: Promise<unknown> = Promise.resolve(); // 사진 줄이기는 한 번에 한 장(메모리)
  const one = async (n: number) => {
    const raw = list[n];
    const file = await (shrinking = shrinking.then(() => shrinkImage(raw), () => shrinkImage(raw))) as File;
    // B-7 촬영(파일 수정) 시각을 함께 기록 — 사진 증빙의 시점 확인용
    const capturedAt = raw.lastModified ? new Date(raw.lastModified).toISOString() : undefined;
    for (let tryN = 0; ; tryN++) {
      try {
        const r = await api<any>('/api/attachments', { body: { ...target, kind: 'file', fileName: file.name, mimeType: file.type || 'application/octet-stream', size: file.size, capturedAt, skipDuplicate: true } });
        // 332차(대표 11/02 16:1x ⑤ · 로컬: 나눠 올리다 같은 사진 21장이 두 번): 같은 이름·크기 파일이 이미 있으면 서버가 올리지 않고 알려 줌 → '이미 있음'으로 건너뜀
        if (r.duplicate) { upd(n, { pct: 100, note: '이미 있는 파일 — 건너뜀' }); return 'dup' as const; }
        const { uploadId } = await putFile(r.upload, file, (pct) => upd(n, { pct }));
        await api(`/api/attachments/${r.id}/complete`, { body: uploadId ? { uploadId } : {} });
        return 'ok' as const;
      } catch (e) { if (tryN >= 1 || !retryable(e)) throw e; upd(n, { pct: 0 }); await new Promise((r) => setTimeout(r, 1500)); }
    }
  };
  let ok = 0, dup = 0, next = 0; const failed: string[] = [];
  const worker = async () => {
    while (next < list.length) {
      const n = next++;
      try { if ((await one(n)) === 'dup') dup++; else { upd(n, { pct: 100 }); ok++; } }
      catch (e: any) { upd(n, { error: e.message }); failed.push(list[n].name); if (!many) toast.error(`${list[n].name}: ${e.message}`); }
    }
  };
  try { await Promise.all(Array.from({ length: Math.min(3, list.length) }, worker)); } finally { release?.(); }
  if (failed.length && many) toast.error(`${list.length}개 중 ${failed.length}개를 올리지 못했습니다 — 진행 목록에서 이유를 보고 다시 올려 주세요`);
  if (ok || dup) toast.ok(ok ? `${ok}개 첨부 완료${dup ? ` · 이미 있는 파일 ${dup}개 건너뜀` : ''}` : `이미 있는 파일 ${dup}개 — 새로 붙이지 않았습니다`); // 333차(로컬 332 ⓒ): 모두 중복이면 그 말만
  if (ok + dup === list.length) setTimeout(() => setProg(() => []), 1500);
  return ok + dup;
}

const isImage = (a: any) => a.kind === 'file' && /^image\//.test(a.mime_type ?? '') && !isHeic(a);
/** 248차 #780: 줄이기(JPEG)에 실패해 아이폰 원본(HEIC)이 그대로 올라간 사진 — PC 브라우저에서 안 보일 수 있어 사진 칸 대신 파일 줄('내려받아 보기') */
const isHeic = (a: any) => /^image\/hei[cf]$/i.test(a.mime_type ?? '') || /\.(heic|heif)$/i.test(a.file_name ?? '');
/** 대표 10/27(사진 150장이 지저분하지 않게): 사진 칸에 바로 보이는 수(넘으면 마지막 칸 '+n' → 사진첩) · 사진이 이보다 많으면 파일 목록의 사진 줄은 '사진 n장' 한 줄로 */
const PHOTO_PREVIEW = 12, PHOTO_ROWS_MAX = 6;
const seoulDay = (v: string) => dtf('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(v));
const dayLabel = (d: string) => `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일 (${'일월화수목금토'[new Date(`${d}T12:00:00+09:00`).getUTCDay()]})`;
const isVideo = (a: any) => a.kind === 'file' && /^video\//.test(a.mime_type ?? ''); // 대표 10/21 02:00: 영상은 보기 창에서 재생

const SOURCE_LABEL: Record<string, string> = { upload: '업로드', google_drive: 'Google Drive', chatgpt: 'ChatGPT 결과물', notion: 'Notion', web: '웹 링크', other: '기타', library: '자료실', sales_auto: '공고 첨부(자동)' };

/** readOnly(#794 함께 담당자 첨부): 보기·미리보기·내려받기만 — 올리기·고치기·버전 버튼 없음, 지우기는 내가 올린 것만 */
export function Attachments({ items, taskId, eventId, canEdit, onChange, meId, readOnly }: { items: any[]; taskId?: string; eventId?: string; canEdit: boolean; onChange: () => void; meId: string; readOnly?: boolean }) {
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
  // #533 [고치기] 하나로: docx = 워크인 문서, xlsx = 칸 고치기, 글·사진·PDF = 브라우저 편집기, 그 밖 = 내려받아 고친 뒤 올리기 안내
  const [editOf, setEditOf] = useState<any | null>(null);
  const startEdit = (a: any) => { const m = editModeOf(a); if (m === 'doc') openDoc(a); else if (m === 'sheet') setSheetOf(a); else setEditOf(a); };
  // #806(대표 10/29 '문서 고치기 빈 화면'): 사진만 든 Word 는 바꾸지 않고 안내 → [PDF 로 만들어 글자 넣기] · [원본 내려받기]
  const [photoDoc, setPhotoDoc] = useState<{ a: any; images: number; reverted?: boolean; pdf: any | null } | null>(null);
  async function openDoc(a: any) {
    try {
      const r = await api<{ link?: string; created?: boolean; imageOnly?: boolean; images?: number; reverted?: boolean; pdf?: any | null }>(`/api/attachments/${a.id}/doc`, { body: {} });
      if (r.imageOnly) { setPhotoDoc({ a, images: r.images ?? 0, reverted: r.reverted, pdf: r.pdf ?? null }); if (r.reverted) onChange(); return; }
      if (r.created) toast.ok('워크인 문서로 바꿨습니다. 같이 고친 뒤 [업무로 저장]을 누르세요');
      window.location.href = r.link!;
    } catch (e: any) { toast.error(e.message); }
  }
  async function photoDocPdf() {
    if (!photoDoc) return;
    let pdf = photoDoc.pdf;
    if (!pdf) {
      setBusy('PDF 만드는 중…');
      try { const r = await api<{ pdf: any; pages?: number; skipped?: number }>(`/api/attachments/${photoDoc.a.id}/doc/pdf`, { body: {} }); pdf = r.pdf; toast.ok(`PDF ${r.pages ?? ''}쪽을 업무에 붙였습니다${r.skipped ? `(못 바꾼 그림 ${r.skipped}개)` : ''}`); onChange(); broadcastRefresh(); }
      catch (e: any) { toast.error(e.message); return; } finally { setBusy(''); }
    }
    setPhotoDoc(null); setEditOf(pdf);
  }
  async function uploadVersion(a: any, file: File | undefined) {
    if (!file) return; setBusy('새 버전 올리는 중…');
    try { const st = await api<any>(`/api/attachments/${a.id}/versions`, { body: { fileName: file.name, mimeType: file.type || a.mime_type, size: file.size } });
      await putFile(st.upload, file); const r = await api<{ version: number }>(`/api/attachments/${a.id}/versions/complete`, { body: { key: st.key, fileName: file.name, mimeType: file.type || a.mime_type } });
      toast.ok(`v${r.version} 으로 저장했습니다(이전 버전 보관)`); onChange(); broadcastRefresh(); } catch (e: any) { toast.error(e.message); } finally { setBusy(''); if (verRef.current) verRef.current.value = ''; }
  }
  const photos = items.filter(isImage);
  const [album, setAlbum] = useState(false);
  const canDel = (a: any) => a.created_by === meId || canEdit;
  // ── 332차(대표 11/02 16:1x 업무 첨부 ①~④): 올린 묶음(같은 사람·10분 안)·날짜별로 묶어 보이고 최근 묶음만 펼침(첨부 12개 이하면 모두 펼침) · 사진은 바둑판·문서는 줄 ·
  //    체크로 바로 선택(Shift 범위 · 빈 곳에서 끌어 사각형) · 머리줄 오른쪽 [모두 선택]·선택 수 · 선택 띠 [선택 n개 내려받기(zip)]·[자료실로]·[삭제]
  const docsCount = items.length - photos.length;
  type Grp = { key: string; day: string; start: string; byId: string | null; by: string; all: any[]; photos: any[]; last: number };
  const groups = useMemo<Grp[]>(() => {
    const out: Grp[] = [];
    for (const a of items) {
      const t = Date.parse(a.created_at); const last = out[out.length - 1];
      if (last && last.byId === (a.created_by ?? null) && t - last.last <= 10 * 60e3 && seoulDay(a.created_at) === last.day) { last.all.push(a); if (isImage(a)) last.photos.push(a); last.last = t; }
      else out.push({ key: a.id, day: seoulDay(a.created_at), start: a.created_at, byId: a.created_by ?? null, by: a.created_by_name ?? '', all: [a], photos: isImage(a) ? [a] : [], last: t });
    }
    return out.reverse(); // 최근 묶음 먼저
  }, [items]);
  const [opens, setOpens] = useState<Record<string, boolean>>({});
  const isOpen = (g: Grp, i: number) => opens[g.key] ?? (i === 0 || items.length <= 12);
  const rowsOf = (g: Grp) => (g.photos.length > PHOTO_ROWS_MAX ? g.all.filter((a) => !isImage(a)) : g.all); // 사진이 많은 묶음은 사진을 바둑판에만(예전 '사진 n장' 규칙을 묶음마다)
  const [sel, setSel] = useState<Set<string>>(new Set());
  useEffect(() => { setSel((s) => { const n = new Set([...s].filter((id) => items.some((a) => a.id === id))); return n.size === s.size ? s : n; }); }, [items]);
  const order = useMemo(() => groups.flatMap((g, i) => (isOpen(g, i) ? [...g.photos, ...rowsOf(g).filter((a) => !isImage(a))] : [])), [groups, opens, items.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const lastIdx = useRef<number | null>(null);
  const toggleSel = (id: string, shift?: boolean) => {
    const idx = order.findIndex((a) => a.id === id);
    setSel((s) => { const n = new Set(s);
      if (shift && lastIdx.current !== null && idx >= 0) { const lo = Math.min(lastIdx.current, idx), hi = Math.max(lastIdx.current, idx); const add = !n.has(id); for (let k = lo; k <= hi; k++) { if (add) n.add(order[k].id); else n.delete(order[k].id); } }
      else if (n.has(id)) n.delete(id); else n.add(id);
      return n; });
    if (idx >= 0) lastIdx.current = idx;
  };
  const selItems = items.filter((a) => sel.has(a.id));
  const selFiles = selItems.filter((a) => a.kind === 'file' && a.upload_status !== 'pending');
  const selDeletable = selItems.filter(canDel);
  const dupName = (a: any) => a.kind === 'file' && items.some((x) => x.id !== a.id && x.kind === 'file' && x.file_name === a.file_name); // 같은 이름(내용은 다름)은 올린 때로 구분
  const boxRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; base: Set<string>; moved: boolean; active: boolean }>({ x: 0, y: 0, base: new Set(), moved: false, active: false });
  const [rect, setRect] = useState<{ l: number; t: number; w: number; h: number } | null>(null);
  const onDown = (e: React.PointerEvent) => {
    dragRef.current.moved = false; // 끌기 직후의 click 만 무시하고(아래 onUp), 다음 누름부터는 정상
    if (e.pointerType !== 'mouse' || e.button !== 0 || (e.target as HTMLElement).closest('a,button,input,select,textarea,label,[data-nodrag]')) return;
    dragRef.current = { x: e.clientX, y: e.clientY, base: e.shiftKey ? new Set(sel) : new Set(), moved: false, active: true };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 지원 안 하면 칸 안에서만 */ } // 칸 밖으로 끌어도 계속 고르기
  };
  const onMove = (e: React.PointerEvent) => {
    const d = dragRef.current; if (!d.active || !boxRef.current) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) return;
    d.moved = true;
    const box = boxRef.current.getBoundingClientRect();
    const l = Math.min(d.x, e.clientX), t = Math.min(d.y, e.clientY), r = Math.max(d.x, e.clientX), b = Math.max(d.y, e.clientY);
    setRect({ l: l - box.left, t: t - box.top, w: r - l, h: b - t });
    const n = new Set(d.base);
    boxRef.current.querySelectorAll<HTMLElement>('[data-att-id]').forEach((el) => { const q = el.getBoundingClientRect(); if (q.right > l && q.left < r && q.bottom > t && q.top < b && el.dataset.attId) n.add(el.dataset.attId); });
    setSel(n);
  };
  const onUp = () => { const d = dragRef.current; if (!d.active) return; d.active = false; setRect(null); }; // moved 는 다음 pointerdown 에서 풀림 — 끌기 끝에 따라오는 click 이 그 줄을 다시 토글하지 않게
  async function zipSelected() {
    const ids = selFiles.map((a) => a.id); if (!ids.length) return;
    if (isNativeApp()) { const { openFileExternally } = await import('./native'); await openFileExternally(`/api/attachments/zip?ids=${ids.join(',')}`); return; }
    setBusy('zip 으로 묶는 중…');
    try {
      const res = await fetch('/api/attachments/zip', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids }), credentials: 'same-origin' });
      if (!res.ok) { let msg = `내려받기 실패(${res.status})`; try { const j = await res.json(); msg = j.message ?? j.error ?? msg; } catch { /* 본문 없음 */ } throw new Error(msg); }
      const name = decodeURIComponent(/filename\*=UTF-8''([^;]+)/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? '첨부.zip');
      const url = URL.createObjectURL(await res.blob());
      const el = document.createElement('a'); el.href = url; el.download = name; document.body.appendChild(el); el.click(); el.remove(); setTimeout(() => URL.revokeObjectURL(url), 10_000);
      const skipped = Number(res.headers.get('x-skipped') ?? 0);
      toast.ok(`${res.headers.get('x-count') ?? ids.length}개를 zip 으로 내려받습니다${skipped ? ` · 못 담은 것 ${skipped}개(링크·기밀)` : ''}`);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(''); }
  }
  async function toLibrary() {
    const ids = selFiles.map((a) => a.id); if (!ids.length) return;
    setBusy('자료실에 등록하는 중…');
    try { const r = await api<{ added: number; already: number; skipped: number; folders: string[] }>('/api/attachments/to-library', { body: { ids } });
      toast.ok(`자료실에 ${r.added}개 등록${r.already ? ` · 이미 있던 것 ${r.already}개` : ''}${r.skipped ? ` · 건너뜀 ${r.skipped}개` : ''}${r.folders.length ? ` — 폴더: ${r.folders.slice(0, 2).join(', ')}` : ''}`); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(''); }
  }
  async function removeSelected() {
    const ids = selDeletable.map((a) => a.id); if (!ids.length) return;
    if (!confirm(`첨부 ${ids.length}개를 삭제할까요?${ids.length < sel.size ? ` (내가 올리지 않은 ${sel.size - ids.length}개는 빼고)` : ''}`)) return;
    setBusy('삭제하는 중…'); let n = 0;
    for (const id of ids) { try { await api(`/api/attachments/${id}`, { method: 'DELETE' }); n++; } catch (e: any) { toast.error(e.message); } }
    setBusy(''); if (n) toast.ok(`첨부 ${n}개를 삭제했습니다`); setSel(new Set()); onChange(); broadcastRefresh();
  }
  const hm = (v: string) => dtf('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(v));
  const albumRef = useRef<HTMLInputElement>(null);
  const vidRef = useRef<HTMLInputElement>(null); // #109 영상 촬영
  const vidAlbumRef = useRef<HTMLInputElement>(null); // 248차 #780 영상은 사진과 따로 고르기

  const [prog, setProg] = useState<UploadItem[]>([]);
  const pick = usePickWait('task'); // 213차: 아이폰은 사진을 많이 고르면 [추가] 뒤 몇 분 동안 아무 표시가 없음 → '준비 중' 띠 · 248차 고르기 진단
  async function upload(files: FileList | null) {
    pick.received(files);
    if (!files?.length) return;
    const list = Array.from(files);
    setBusy('올리는 중…');
    const ok = await uploadTaskFiles(list, { taskId, eventId }, setProg);
    pick.done({ ok, fail: list.length - ok });
    setBusy('');
    if (vidAlbumRef.current) vidAlbumRef.current.value = '';
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
    if (!confirm('첨부를 삭제할까요?')) return false;
    try { await api(`/api/attachments/${id}`, { method: 'DELETE' }); onChange(); return true; } catch (e: any) { toast.error(e.message); return false; }
  }

  return (
    <DropZone onFiles={(f) => upload(f)} disabled={readOnly || !canEdit || !!busy} label={taskId ? '놓으면 이 업무에 첨부됩니다' : '놓으면 이 일정에 첨부됩니다'} testid="attach-drop">
      {items.length > 0 && (
        <div className="mb-1.5 flex min-h-8 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-2" data-testid="att-head">
          {sel.size > 0 ? (
            /* 선택 띠는 머리줄 자리에(높이 고정) — 띠가 끼어들어 줄이 밀리면 끌어 고르는 중에 줄 위치가 바뀜 */
            <span className="flex flex-wrap items-center gap-1.5" data-testid="att-sel-bar">
              <b className="tabular-nums text-accent-700" title="Shift 로 범위 · 빈 곳에서 끌어 사각형 선택" data-testid="att-sel-count">선택 {sel.size}</b>
              <Button size="sm" variant="secondary" onClick={zipSelected} disabled={!!busy || !selFiles.length} data-testid="att-sel-zip"><FileArchive />선택 {selFiles.length}개 내려받기(zip)</Button>
              {taskId && !readOnly && <Button size="sm" variant="secondary" onClick={toLibrary} disabled={!!busy || !selFiles.length} data-testid="att-sel-library"><FolderInput />자료실로</Button>}
              {selDeletable.length > 0 && <Button size="sm" variant="danger" onClick={removeSelected} disabled={!!busy} data-testid="att-sel-delete"><Trash2 />삭제{selDeletable.length < sel.size ? ` ${selDeletable.length}개` : ''}</Button>}
              <button type="button" className="underline" onClick={() => setSel(new Set())} data-testid="att-sel-clear">선택 해제</button>
            </span>
          ) : (
            <>
              <span data-testid="att-photo-summary"><b className="text-ink">첨부 {items.length}개</b>{photos.length > 0 && <> · 사진 {photos.length}장</>}{docsCount > 0 && <> · 문서 {docsCount}개</>}</span>
              {photos.length > PHOTO_PREVIEW && <button type="button" className="font-semibold text-accent-700 underline" onClick={() => setAlbum(true)} data-testid="photo-album-open">사진첩으로 모두 보기</button>}
            </>
          )}
          <span className="ml-auto flex items-center gap-2">
            <button type="button" className="rounded-full border border-line px-2 py-0.5 font-medium hover:bg-slate-50" onClick={() => setSel(sel.size === items.length ? new Set() : new Set(items.map((a) => a.id)))} data-testid="att-select-all">{sel.size === items.length ? '선택 해제' : '모두 선택'}</button>
          </span>
        </div>
      )}
      <div ref={boxRef} className={cx('relative space-y-2', rect && 'select-none')} data-testid="attachments" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        {rect && <div className="pointer-events-none absolute z-20 rounded border border-accent-500 bg-accent-500/10" style={{ left: rect.l, top: rect.t, width: rect.w, height: rect.h }} />}
        {groups.map((g, gi) => { const open = isOpen(g, gi); const headed = groups.length > 1; const rows = rowsOf(g); return (
          <section key={g.key} data-testid="att-group" data-open={open ? '1' : '0'}>
            {headed && (
              <button type="button" onClick={() => setOpens({ ...opens, [g.key]: !open })} aria-expanded={open} className="flex w-full items-center gap-1.5 rounded-input bg-slate-50 px-2 py-1 text-left text-xs text-ink-2 hover:bg-slate-100" data-testid="att-group-head" data-nodrag>
                {open ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />}
                <b className="text-ink">{dayLabel(g.day)} {hm(g.start)}</b><span className="truncate">{g.by}</span>
                <span className="ml-auto shrink-0 tabular-nums">{g.photos.length > 0 && `사진 ${g.photos.length}장`}{g.photos.length > 0 && g.all.length > g.photos.length && ' · '}{g.all.length > g.photos.length && `문서 ${g.all.length - g.photos.length}개`}</span>
              </button>
            )}
            {open && g.photos.length > 0 && (
              <div className={cx(headed && 'mt-1.5')} data-testid="photo-section">
                <div className={cx('grid gap-2', g.photos.length > PHOTO_ROWS_MAX ? 'grid-cols-4 gap-1.5 sm:grid-cols-6' : 'grid-cols-3 sm:grid-cols-4')} data-testid="photo-grid">
                  {g.photos.slice(0, g.photos.length > PHOTO_PREVIEW ? PHOTO_PREVIEW - 1 : PHOTO_PREVIEW).map((a) => { const on = sel.has(a.id); return (
                    <div key={a.id} className={cx('relative rounded-input', on && 'ring-2 ring-accent-500 ring-offset-1')} data-att-id={a.id}>
                      <a href={`/api/attachments/${a.id}/download?inline=1`} onClick={(e) => { e.preventDefault(); if (dragRef.current.moved) return; setView(a); }} className="group relative block aspect-square overflow-hidden rounded-input border border-line bg-slate-100" title={a.file_name} data-photo={a.id}>
                        <img src={`/api/attachments/${a.id}/download?inline=1`} alt={a.file_name} loading="lazy" className={cx('size-full object-cover transition-transform group-hover:scale-105', on && 'opacity-80')} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                        {a.captured_at && <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/60 to-transparent px-1.5 pb-1 pt-4 text-[10px] text-white">{fmtDateTime(a.captured_at)}</span>}
                      </a>
                      <button type="button" className={cx('absolute left-1 top-1 z-10 flex size-6 items-center justify-center rounded-full border-2 border-white shadow', on ? 'bg-accent-600' : 'bg-black/35 opacity-70 hover:opacity-100')} aria-label={`${a.file_name} 선택`} aria-pressed={on} onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleSel(a.id, e.shiftKey); }} data-testid="photo-check">{on && <Check className="size-3.5 text-white" />}</button>
                    </div>); })}
                  {g.photos.length > PHOTO_PREVIEW && (
                    <button type="button" onClick={() => setAlbum(true)} className="relative block aspect-square overflow-hidden rounded-input border border-line bg-slate-100" aria-label={`사진 ${photos.length}장 모두 보기`} data-testid="photo-more">
                      <img src={`/api/attachments/${g.photos[PHOTO_PREVIEW - 1].id}/download?inline=1`} alt="" loading="lazy" className="size-full object-cover" />
                      <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-lg font-bold text-white">+{g.photos.length - (PHOTO_PREVIEW - 1)}</span>
                    </button>
                  )}
                </div>
              </div>
            )}
            {open && rows.length > 0 && (
              <ul className={cx('space-y-1.5', headed && 'mt-1.5')} data-testid="att-rows">
                {rows.map((a) => { const on = sel.has(a.id); return (
                  <li key={a.id} className={cx('flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-input border px-2.5 py-2 text-sm', on ? 'border-accent-300 bg-accent-50/60' : 'border-line')} data-att-id={a.id} data-selected={on ? '1' : undefined}
                    onClick={(e) => { if (dragRef.current.moved) return; if ((e.target as HTMLElement).closest('a,button,input,select,textarea,label')) return; toggleSel(a.id, e.shiftKey); }}>
                    <input type="checkbox" checked={on} onChange={() => {}} onClick={(e) => { e.stopPropagation(); toggleSel(a.id, e.shiftKey); }} className="size-4 shrink-0 accent-accent-600" aria-label={`${a.doc_title || a.file_name || a.url} 선택`} data-testid="att-check" />
            <FileKindIcon a={a} />
            {/* #533: 버튼이 많아도 이름이 사라지지 않게 — 이름 최소 폭, 모자라면 버튼 묶음이 다음 줄로 */}
            <div className="min-w-[10rem] flex-1">
              <a href={`/api/attachments/${a.id}/download${a.kind === 'file' ? '?inline=1' : ''}`} target="_blank" rel="noopener noreferrer" className="block truncate font-semibold text-accent-700 hover:underline">
                {a.doc_title || a.file_name || a.url}
              </a>
              <div className="flex flex-wrap gap-x-2 text-xs text-ink-2">
                <span className={cx('rounded px-1 font-bold', fileKind(a).cls)} data-testid="att-ext">{fileExt(a)}</span>{/* 330차: HWP·PDF 같은 종류 글자 */}
                <span>{SOURCE_LABEL[a.source] ?? a.source}</span>
                {a.doc_version && <span>버전 {a.doc_version}</span>}
                {a.doc_base_date && <span>기준일 {fmtDate(a.doc_base_date)}</span>}
                {a.doc_owner && <span>문서 담당 {a.doc_owner}</span>}
                {a.size_bytes ? <span>{fmtSize(Number(a.size_bytes))}</span> : null}
                {dupName(a) && <span title="같은 이름의 파일이 더 있어 올린 때로 구분" data-testid="att-uploaded-at">올림 {fmtDateTime(a.created_at)}</span>}
                {isHeic(a) && <span className="text-amber-700" data-testid="att-heic">아이폰 사진(HEIC) — PC 에서 안 보이면 내려받아 보기</span>}
                {a.captured_at && isImage(a) && <span>촬영 {fmtDateTime(a.captured_at)}</span>}{/* 로컬 검수 10/17: 문서(txt 등)는 "촬영" 아님 */}
                <span>{a.created_by_name}</span>
                {a.from_name && <span className="font-medium text-violet-700" data-testid="att-from">{a.from_name} 업무</span>}
                {a.kind === 'link' && <span className="truncate">원본: {(() => { try { return new URL(a.url).hostname; } catch { return ''; } })()}</span>}
              </div>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-1">
            {/* V14 49: 업무를 볼 수 있는 사람 누구나 미리보기(PDF·사진)·내려받기 — 앱은 서명 주소를 받아 기기 브라우저/공유로 넘김 */}
            {isVideo(a) && <button type="button" onClick={() => setView(a)} className="flex size-11 shrink-0 items-center justify-center rounded-input text-ink-2 hover:bg-slate-100 sm:size-8" aria-label={`${a.file_name} 재생`} title="재생" data-testid="att-play"><Eye className="size-4" /></button>}
            {a.kind === 'file' && /^(image\/|application\/pdf)/.test(a.mime_type ?? '') && (
              <button type="button" onClick={() => openFile(a.id, true)} className="flex size-11 shrink-0 items-center justify-center rounded-input text-ink-2 hover:bg-slate-100 sm:size-8" aria-label={`${a.file_name} 미리보기`} title="미리보기" data-testid="att-preview"><Eye className="size-4" /></button>
            )}
            {a.kind === 'file' && (
              <button type="button" onClick={() => openFile(a.id, false)} className="flex size-11 shrink-0 items-center justify-center rounded-input text-ink-2 hover:bg-slate-100 sm:size-8" aria-label={`${a.file_name} 내려받기`} title="내려받기" data-testid="att-download"><Download className="size-4" /></button>
            )}
            {a.kind === 'file' && canEdit && (() => { const m = editModeOf(a); return (
              <button type="button" onClick={() => startEdit(a)} className="inline-flex h-8 shrink-0 items-center gap-1 rounded-input border border-accent-200 bg-accent-50 px-2 text-xs font-medium text-accent-700 hover:bg-accent-100"
                title={EDIT_TITLE[m]} data-testid="att-edit" data-mode={m}>{m === 'sheet' ? <Table2 className="size-3.5" /> : <PenLine className="size-3.5" />}{m === 'doc' && a.doc_id ? '편집 계속' : '고치기'}</button>); })()}
            {a.kind === 'file' && canEdit && <button type="button" onClick={() => { setVerTarget(a); verRef.current?.click(); }} className="flex size-11 shrink-0 items-center justify-center rounded-input text-ink-2 hover:bg-slate-100 sm:size-8" aria-label={`${a.file_name} 새 버전 올리기`} title="내려받아 고친 파일을 새 버전으로(이전 버전 보관)" data-testid="att-new-version"><Upload className="size-4" /></button>}
            {a.kind === 'file' && !readOnly && (Number(a.version ?? 1) > 1 || a.doc_id) && <button type="button" onClick={() => setVersionsOf(a)} className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full bg-slate-100 px-2 text-[11px] font-semibold text-ink-2 hover:bg-slate-200" title="버전 기록·되돌리기" data-testid="att-versions"><History className="size-3" />v{a.version ?? 1}</button>}
            {(a.created_by === meId || canEdit) && <button onClick={() => remove(a.id)} className="rounded p-1 text-ink-3 hover:bg-red-50 hover:text-red-600" aria-label="첨부 삭제"><Trash2 className="size-4" /></button>}
            </div>
                  </li>); })}
              </ul>
            )}
          </section>); })}
        {!items.length && <p className="text-xs text-ink-3">첨부된 자료가 없습니다</p>}
      </div>
      {canEdit && <div className="mt-2"><DropHint onClick={() => pick.open(fileRef)} disabled={!!busy} /></div>}
      {pick.node && <div className="mt-2">{pick.node}</div>}
      <div className={cx('mt-2 flex flex-wrap gap-1.5', readOnly && 'hidden')}>
        <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => upload(e.target.files)} data-testid="file-input" />
        <input ref={camRef} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={(e) => upload(e.target.files)} />
        <input ref={albumRef} type="file" accept={PHOTO_ACCEPT} multiple className="hidden" onChange={(e) => upload(e.target.files)} data-testid="album-input" />
        <input ref={vidAlbumRef} type="file" accept="video/*" multiple className="hidden" onChange={(e) => upload(e.target.files)} data-testid="video-album-input" />
        <input ref={vidRef} type="file" accept="video/*" capture="environment" className="hidden" onChange={(e) => upload(e.target.files)} data-testid="video-input" />
        <Button size="sm" variant="secondary" onClick={() => pick.open(fileRef, 'file')} disabled={!!busy}><Paperclip />파일 첨부</Button>
        {taskId && <Button size="sm" variant="secondary" onClick={() => setLibOpen(true)} disabled={!!busy} title="자료실에 있는 파일을 이 업무에 연결(복사 아님, 자료실 권한 그대로)" data-testid="att-from-library"><FolderOpen />자료실에서</Button>}
        <Button size="sm" variant="secondary" onClick={() => pick.open(camRef, 'camera')} disabled={!!busy}><Camera />사진 촬영</Button>
        <Button size="sm" variant="secondary" onClick={() => pick.open(albumRef, 'photo')} disabled={!!busy} data-testid="att-album"><ImageIcon />사진</Button>
        <Button size="sm" variant="secondary" onClick={() => pick.open(vidAlbumRef, 'video')} disabled={!!busy} title="영상 고르기(100MB 까지)" data-testid="att-video-album"><Video />영상</Button>
        <Button size="sm" variant="secondary" onClick={() => pick.open(vidRef, 'video')} disabled={!!busy} className="sm:hidden" title="영상 촬영(100MB 까지)" data-testid="att-video-capture"><Video />영상 촬영</Button>
        <Button size="sm" variant="secondary" onClick={() => setLinkOpen(true)}><Link2 />문서 링크 연결</Button>
        {busy && <span className="inline-flex items-center gap-1.5 text-xs text-ink-2"><Loader2 className="size-3.5 animate-spin" />{busy}</span>}
      </div>
      {canEdit && <IosPickHint className="mt-1 text-[11px] text-ink-3" />}
      {album && <PhotoAlbum photos={photos} canDel={canDel} onOpen={setView} onClose={() => setAlbum(false)} onChange={() => { onChange(); broadcastRefresh(); }} />}
      {/* 사진 크게 보기: 좌우로 넘기기 · 대표 10/27: 사진은 여기서 고치기·지우기(사진이 많으면 목록 줄이 없음) */}
      {view && (
        <div className="fixed inset-0 z-[80] flex flex-col bg-black/90" role="dialog" aria-label="사진 보기" data-testid="photo-viewer" onClick={() => setView(null)}>
          <div className="flex items-center gap-2 px-4 pb-2 pt-[calc(var(--sat)+8px)] text-sm text-white" onClick={(e) => e.stopPropagation()}>
            <span className="min-w-0 flex-1 truncate">{isImage(view) && photos.length > 1 && <b className="mr-1.5 tabular-nums" data-testid="photo-viewer-index">{photos.findIndex((p) => p.id === view.id) + 1}/{photos.length}</b>}{view.file_name}{view.captured_at && isImage(view) ? ` · 촬영 ${fmtDateTime(view.captured_at)}` : ''}</span>
            {isImage(view) && canEdit && <button type="button" className="shrink-0 rounded px-2 py-1 text-white/90 hover:bg-white/10" onClick={() => { const a = view; setView(null); startEdit(a); }} data-testid="photo-viewer-edit">고치기</button>}
            {isImage(view) && canDel(view) && <button type="button" className="shrink-0 rounded px-2 py-1 text-white/90 hover:bg-white/10" onClick={async () => { if (await remove(view.id)) setView(null); }} data-testid="photo-viewer-delete">지우기</button>}
            <button type="button" className="shrink-0 rounded px-2 py-1 text-white/90" aria-label="사진 닫기" onClick={() => setView(null)}>닫기</button>
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
      {prog.length > 1 && <p className="mt-2 text-xs text-ink-2" data-testid="pick-received">받은 파일 <b>{prog.length}개</b> · 올린 것 {prog.filter((p) => p.pct >= 100).length}/{prog.length}{prog.some((p) => p.error) ? ` · 못 올린 것 ${prog.filter((p) => p.error).length}` : ''}</p>}
      <UploadProgress items={prog} />
      <input ref={verRef} type="file" className="hidden" onChange={(e) => uploadVersion(verTarget, e.target.files?.[0])} aria-label="새 버전 파일" data-testid="att-version-file" />
      {photoDoc && (
        <Modal open onClose={() => setPhotoDoc(null)} title="사진으로 된 문서입니다">
          <div className="space-y-3 text-sm text-ink-2" data-testid="photo-doc">
            <p>이 Word 파일에는 글 없이 사진 {photoDoc.images}장만 들어 있습니다. 워크인 문서로 바꾸면 빈 화면이 되어 바꾸지 않았습니다.</p>
            {photoDoc.reverted && <p className="rounded-input bg-slate-50 px-3 py-2 text-xs" data-testid="photo-doc-reverted">예전에 바꿔 둔 빈 문서는 지우고 원래 첨부로 되돌렸습니다.</p>}
            <p>PDF 로 만들면 쪽마다 사진이 그대로 보이고, 그 위에 글자·체크·서명을 넣을 수 있습니다. 원본 Word 는 첨부에 그대로 남습니다.</p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={() => { openFile(photoDoc.a.id, false); setPhotoDoc(null); }} data-testid="photo-doc-download">원본 내려받기</Button>
              <Button onClick={photoDocPdf} disabled={!!busy} data-testid="photo-doc-pdf">{photoDoc.pdf ? '만든 PDF 열어 글자 넣기' : 'PDF 로 만들어 글자 넣기'}</Button>
            </div>
          </div>
        </Modal>
      )}
      {editOf && <AttachEditModal a={editOf} onClose={() => setEditOf(null)} onSaved={() => { onChange(); broadcastRefresh(); }} onDownload={() => openFile(editOf.id, false)} onUploadNew={() => { setVerTarget(editOf); verRef.current?.click(); }} />}
      {versionsOf && <VersionsModal a={versionsOf} canEdit={canEdit} onClose={() => setVersionsOf(null)} onChange={() => { onChange(); broadcastRefresh(); }} />}
      {sheetOf && <SheetEditModal a={sheetOf} onClose={() => setSheetOf(null)} onSaved={() => { setSheetOf(null); onChange(); broadcastRefresh(); }} />}
      {libOpen && taskId && <LibraryPickModal onClose={() => setLibOpen(false)} onPick={async (files) => {
        let ok = 0; for (const f of files) { try { await api(`/api/library/${f.id}/attach`, { body: { taskId } }); ok++; } catch (e: any) { toast.error(`${f.title}: ${e.message}`); } }
        if (ok) toast.ok(`자료실 파일 ${ok}건을 첨부했습니다`); setLibOpen(false); onChange(); broadcastRefresh(); }} />}
    </DropZone>
  );
}

/** 대표 10/27(사진 150장): 사진첩 — 날짜(촬영일, 없으면 올린 날)별로 모아 보기 · [고르기] → 여러 장 지우기(올린 사람·편집 권한만) */
function PhotoAlbum({ photos, canDel, onOpen, onClose, onChange }: { photos: any[]; canDel: (a: any) => boolean; onOpen: (a: any) => void; onClose: () => void; onChange: () => void }) {
  useBackClose(true, onClose);
  const [pick, setPick] = useState<Set<string> | null>(null); // null = 보기, Set = 고르기
  const [busy, setBusy] = useState(false);
  const groups = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const a of photos) { const d = seoulDay(a.captured_at ?? a.created_at); m.set(d, [...(m.get(d) ?? []), a]); }
    return [...m.entries()].sort((x, y) => y[0].localeCompare(x[0]));
  }, [photos]);
  const deletable = photos.filter(canDel);
  const toggle = (id: string) => setPick((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  async function removePicked() {
    const ids = [...(pick ?? [])];
    if (!ids.length || !confirm(`사진 ${ids.length}장을 지울까요?`)) return;
    setBusy(true); let ok = 0;
    for (const id of ids) { try { await api(`/api/attachments/${id}`, { method: 'DELETE' }); ok++; } catch (e: any) { toast.error(e.message); } }
    setBusy(false); if (ok) toast.ok(`사진 ${ok}장을 지웠습니다`); setPick(null); onChange();
  }
  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-white" role="dialog" aria-label="사진첩" data-testid="photo-album">
      <div className="flex items-center gap-2 border-b border-line px-4 pb-2 pt-[calc(var(--sat)+10px)]">
        <b className="text-base">사진 {photos.length}장</b>
        {deletable.length > 0 && <button type="button" className={cx('ml-auto rounded-full border px-3 py-1 text-xs', pick ? 'border-accent-500 bg-accent-50 font-semibold text-accent-700' : 'border-line')} onClick={() => setPick(pick ? null : new Set())} data-testid="photo-album-pick">{pick ? '고르기 끝' : '고르기'}</button>}
        <button type="button" className={cx('rounded px-2 py-1 text-sm text-ink-2 hover:bg-slate-100', !deletable.length && 'ml-auto')} onClick={onClose} data-testid="photo-album-close">닫기</button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {groups.map(([d, list]) => (
          <section key={d} data-testid="photo-album-day">
            <h3 className="sticky top-0 z-10 bg-white/95 py-2 text-xs font-semibold text-ink-2">{dayLabel(d)} · {list.length}장</h3>
            <div className="grid grid-cols-4 gap-1 sm:grid-cols-6 lg:grid-cols-8">
              {list.map((a) => { const on = !!pick?.has(a.id); return (
                <button key={a.id} type="button" onClick={() => (pick ? canDel(a) && toggle(a.id) : onOpen(a))} aria-pressed={pick ? on : undefined} aria-label={a.file_name} title={a.file_name}
                  className={cx('relative aspect-square overflow-hidden rounded bg-slate-100', on && 'ring-2 ring-accent-500 ring-offset-1')} data-testid="photo-album-item">
                  <img src={`/api/attachments/${a.id}/download?inline=1`} alt="" loading="lazy" className={cx('size-full object-cover', on && 'opacity-75')} onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }} />
                  {pick && canDel(a) && <span className={cx('absolute right-1 top-1 flex size-5 items-center justify-center rounded-full border-2 border-white', on ? 'bg-accent-600' : 'bg-black/30')}>{on && <Check className="size-3 text-white" />}</span>}
                </button>); })}
            </div>
          </section>
        ))}
      </div>
      {pick && (
        <div className="flex items-center gap-3 border-t border-line px-4 pb-[calc(var(--sab)+10px)] pt-2 text-sm" data-testid="photo-album-bar">
          <b className="tabular-nums" data-testid="photo-album-count">{pick.size}장 선택</b>
          <button type="button" className="text-xs text-ink-2 underline" onClick={() => setPick(new Set(pick.size === deletable.length ? [] : deletable.map((a) => a.id)))} data-testid="photo-album-all">{pick.size === deletable.length ? '선택 해제' : '모두 선택'}</button>
          <Button size="sm" variant="danger" className="ml-auto" disabled={!pick.size || busy} onClick={removePicked} data-testid="photo-album-delete"><Trash2 />{busy ? '지우는 중…' : '지우기'}</Button>
        </div>
      )}
    </div>
  );
}

const VKIND: Record<string, string> = { original: '원본', upload: '새 파일 올림', doc: '문서 편집 저장', sheet: '칸 고침', restore: '되돌림', text: '글 고침', image: '사진 고침', pdf: 'PDF 에 써넣음' };
const EDIT_TITLE: Record<string, string> = { doc: 'Word 파일을 워크인 문서로 열어 요청자·담당자가 같이 고치고 [업무로 저장]', sheet: 'Excel 칸 값을 고쳐 새 버전으로(서식·수식 그대로)', text: '글을 고쳐 새 버전으로 저장', image: '돌리기·자르기·펜·글자로 고쳐 새 버전으로 저장', pdf: '가리기·글자·체크·서명을 넣어 새 버전으로 저장', other: '내려받아 고친 뒤 [고친 파일 올리기] = 새 버전' };
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
/** 330차(대표 11/02 15:2x 첨부 파일 종류 표기): 종류 글자 — 파일 이름의 확장자(HWP·HWPX·PDF·XLSX·DOCX·JPG·ZIP …) → 없으면 형식(mime) → 그래도 모르면 '파일' · 링크는 '링크' */
const MIME_EXT: [RegExp, string][] = [[/pdf/, 'PDF'], [/hwpx/, 'HWPX'], [/hwp|haansoft/, 'HWP'], [/spreadsheetml|ms-excel/, 'XLSX'], [/csv/, 'CSV'], [/wordprocessingml|msword/, 'DOCX'], [/presentationml|ms-powerpoint/, 'PPTX'],
  [/zip|compressed/, 'ZIP'], [/^image\/jpe?g/, 'JPG'], [/^image\/png/, 'PNG'], [/^image\/hei[cf]/, 'HEIC'], [/^image\/gif/, 'GIF'], [/^image\/webp/, 'WEBP'], [/^image\//, '사진'], [/^video\//, '영상'], [/^audio\//, '음성'], [/^text\/plain/, 'TXT'], [/x-workin-doc/, '문서']];
export function extLabel(kind: string | undefined, ext: string | null | undefined, mimeType: string | null | undefined): string {
  if (kind === 'link') return '링크';
  if (ext) { const e = ext.toUpperCase(); return e === 'JPEG' ? 'JPG' : e; }
  const mime = (mimeType ?? '').toLowerCase();
  for (const [re, x] of MIME_EXT) if (re.test(mime)) return x;
  return '파일';
}
export function fileExt(a: { kind?: string; file_name?: string | null; mime_type?: string | null }): string {
  const m = /\.([a-z][a-z0-9]{0,4})$/i.exec((a.file_name ?? '').trim());
  return extLabel(a.kind, m?.[1] ?? null, a.mime_type);
}
/** 332차 보완: 서버가 종류별로 전부 센 값(attachment_kinds: kind·ext·mime·n)으로 같은 요약 — 첨부가 수십 개여도 수가 맞음 */
export function attKindSummaryCounts(rows: { kind?: string; ext?: string | null; mime?: string | null; n: number }[], max = 3): string {
  const m = new Map<string, number>(); let total = 0;
  for (const r of rows) { const e = extLabel(r.kind, r.ext, r.mime); m.set(e, (m.get(e) ?? 0) + r.n); total += r.n; }
  const groups = [...m.entries()].sort((a, b) => b[1] - a[1]);
  if (!groups.length) return '';
  if (total === 1) return groups[0][0];
  const rest = groups.slice(max).reduce((n, [, c]) => n + c, 0);
  return groups.slice(0, max).map(([e, c]) => `${e} ${c}`).join(' · ') + (rest ? ` 외 ${rest}` : '');
}
/** 여러 개면 종류별로 묶어 'HWP 2 · PDF 1'(많은 순, 같으면 먼저 올린 순 · max 종까지, 나머지는 '외 n') · 1개면 'PDF' */
export function attKindSummary(files: { kind?: string; file_name?: string | null; mime_type?: string | null }[], max = 3): string {
  const m = new Map<string, number>();
  for (const f of files) { const e = fileExt(f); m.set(e, (m.get(e) ?? 0) + 1); }
  const groups = [...m.entries()].sort((a, b) => b[1] - a[1]);
  if (!groups.length) return '';
  if (files.length === 1) return groups[0][0];
  const rest = groups.slice(max).reduce((n, [, c]) => n + c, 0);
  return groups.slice(0, max).map(([e, c]) => `${e} ${c}`).join(' · ') + (rest ? ` 외 ${rest}` : '');
}
export function FileKindIcon({ a, small }: { a: any; small?: boolean }) {
  const k = fileKind(a); const ext = fileExt(a);
  // 330차: 큰 칸(32px)에는 아이콘 대신 확장자 글자(4자까지) — 한글(HWP)인지 PDF 인지 바로 보이게 · 작은 칸·링크·긴 확장자는 아이콘
  const text = !small && k.key !== 'link' && ext.length <= 4;
  return (
    <span className={cx('flex shrink-0 items-center justify-center rounded-md', k.cls, small ? 'size-5' : 'size-8')} title={`${k.label} · ${ext}`} data-file-kind={k.key} data-ext={ext} aria-hidden>
      {text ? <span className="text-[10px] font-extrabold leading-none tracking-tight">{ext}</span> : k.key === 'link' ? <Link2 className={small ? 'size-3' : 'size-4'} /> : k.key === 'img' ? <ImageIcon className={small ? 'size-3' : 'size-4'} /> : <FileText className={small ? 'size-3' : 'size-4'} />}
    </span>
  );
}

/** 336차: 목록 API 가 주는 시각(ISO)을 서울 날짜(YYYY-MM-DD)로 — fmtDate 는 날짜 문자열만 받아 ISO 를 주면 'NaN' 이 났음 */
const dayKst = (x?: string | null) => (x ? dtf('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(x)) : '');
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
  const [view, setView] = useState<LibPreviewFile | null>(null); /* 336차(대표 11/02 17:3x ①): 줄을 누르면 옆(휴대폰은 목록 자리)에 미리보기 — 고르기 전 내용 확인 */
  const toggle = (f: any) => setSel((s) => { const c = { ...s }; if (c[f.id]) delete c[f.id]; else c[f.id] = { id: f.id, title: f.title || f.file_name, file_name: f.file_name, size_bytes: Number(f.size_bytes) }; return c; });
  useEffect(() => { let on = true; setData(null);
    api<any>(`/api/library?limit=60&space=${encodeURIComponent(space)}&folder=${encodeURIComponent(folder)}&q=${encodeURIComponent(query)}`).then((d) => { if (on) setData(d); }).catch((e) => { if (on) setErr(e.message); });
    return () => { on = false; }; }, [query, space, folder]);
  const files: any[] = (data?.files ?? []).filter((f: any) => f.mime_type !== 'application/x-workin-doc');
  const n = Object.keys(sel).length;
  const SP: Record<string, string> = { all: '전체', work: '업무', sales: '영업', marketing: '마케팅' };
  return (
    <Modal open onClose={onClose} title={title} wide xl={!!view}>
      <div className="space-y-2 text-sm" data-testid="lib-pick" data-preview={view ? '1' : '0'}>
        <form onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); }} className="flex flex-wrap items-center gap-1.5">
          <input className={cx(inputCls, 'h-9 min-w-0 flex-1')} value={q} onChange={(e) => setQ(e.target.value)} placeholder="파일 이름·폴더·내용으로 찾기" aria-label="자료 검색" data-testid="lib-pick-q" />
          <Button size="sm" type="submit" variant="secondary"><Search />찾기</Button>
          {(data?.spaces?.length ?? 0) > 1 && <select className={cx(inputCls, 'h-9 w-auto py-0')} value={space} onChange={(e) => { setSpace(e.target.value); setFolder('*'); }} aria-label="공간"><option value="all">모든 공간</option>{(data?.spaces ?? []).map((s: string) => <option key={s} value={s}>{SP[s] ?? s}</option>)}</select>}
          <select className={cx(inputCls, 'h-9 max-w-[12rem] py-0')} value={folder} onChange={(e) => setFolder(e.target.value)} aria-label="폴더" data-testid="lib-pick-folder"><option value="*">모든 폴더</option>{(data?.folders ?? []).map((f: any) => <option key={f.folder} value={f.folder}>{f.folder || '(최상위)'}{f.n ? ` (${f.n})` : ''}</option>)}</select>
        </form>
        {err && <p className="text-xs text-red-700">{err}</p>}
        <p className="text-[11px] text-ink-3">{query ? `"${query}" 검색 결과` : '최근 올린 순'} · 줄을 누르면 내용 미리보기, 네모를 체크하면 선택 · 체크한 파일을 이 업무에 연결합니다(복사 아님 — 자료실에서 지우거나 등급을 바꾸면 업무에서도 같이 적용).</p>
        <div className="flex gap-2 md:items-stretch">
        <ul className={cx('max-h-[50vh] min-w-0 flex-1 divide-y divide-line overflow-y-auto rounded-input border border-line', view && 'hidden md:block')} data-testid="lib-pick-list">
          {!data && !err && <li className="px-3 py-3 text-xs text-ink-3">불러오는 중…</li>}
          {files.map((f) => { const on = !!sel[f.id]; const viewing = view?.id === f.id; return (
            <li key={f.id}><div className={cx('flex items-center gap-2.5 px-2.5 py-2 hover:bg-slate-50', on && 'bg-accent-50/50', viewing && 'ring-1 ring-inset ring-accent-300')} data-testid="lib-pick-item" data-viewing={viewing ? '1' : undefined}>
              <input type="checkbox" className="size-4 shrink-0 accent-brand-600" checked={on} onChange={() => toggle(f)} aria-label={`${f.title || f.file_name} 선택`} />
              <button type="button" onClick={() => setView(f)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left" title="내용 미리보기" aria-label={`${f.title || f.file_name} 미리보기`} data-testid="lib-pick-view">
                <FileKindIcon a={{ kind: 'file', mime_type: f.mime_type, file_name: f.file_name }} small />
                <span className="min-w-0 flex-1"><span className="block truncate font-medium">{f.title || f.file_name}</span><span className="block truncate text-[11px] text-ink-3">{f.folder || '최상위'}{f.security === 'confidential' ? ' · 기밀' : ''} · {f.created_by_name ?? ''} · {fmtDate(dayKst(f.updated_at ?? f.created_at))}</span></span>
                <span className="text-xs tabular-nums text-ink-3">{f.size_bytes ? fmtSize(Number(f.size_bytes)) : ''}</span>
                <Eye className={cx('size-4 shrink-0', viewing ? 'text-accent-600' : 'text-ink-3')} aria-hidden />
              </button>
            </div></li>); })}
          {data && !files.length && <li className="px-3 py-3 text-xs text-ink-3">{query ? '찾는 자료가 없습니다' : '자료실에 파일이 없습니다'}</li>}
        </ul>
        {view && <LibPreview f={view} onClose={() => setView(null)} backLabel="목록" className="w-full md:max-h-[50vh] md:w-[22rem] md:shrink-0 md:overflow-y-auto"
          action={{ label: sel[view.id] ? '선택 해제' : '이 파일 선택', active: !!sel[view.id], on: () => toggle(view) }} />}
        </div>
        <div className="flex items-center justify-end gap-2"><span className="mr-auto text-xs text-ink-2">{n ? `${n}개 선택` : ''}</span><Button variant="secondary" onClick={onClose}>취소</Button>
          <Button onClick={async () => { setBusy(true); try { await onPick(Object.values(sel)); } finally { setBusy(false); } }} disabled={!n || busy} data-testid="lib-pick-go">{confirmLabel}{n ? ` (${n})` : ''}</Button></div>
      </div>
    </Modal>
  );
}

/** 336차(대표 11/02 17:3x ① 고르기 전 내용 확인): 자료실 고르기 창 미리보기 패널에 넘기는 줄(목록 API 가 주는 칸 그대로) */
export type LibPreviewFile = { id: string; title?: string | null; file_name: string; mime_type?: string | null; size_bytes?: number | string | null; folder?: string | null; description?: string | null; tags?: string[] | null;
  created_at?: string | null; created_by_name?: string | null; team_name?: string | null; security?: string | null; upload_status?: string | null };
/** 창 안에 바로 띄울 수 있는 종류 — 사진(브라우저가 그리는 형식)·영상·PDF(형식이 PDF 로 올라온 것만, 아니면 내려받기로 돌아가서 문서 취급) */
export function libPreviewKind(f: { mime_type?: string | null; file_name?: string | null }): 'image' | 'video' | 'pdf' | 'doc' {
  const mime = (f.mime_type ?? '').toLowerCase(); const ext = (f.file_name ?? '').toLowerCase().split('.').pop() ?? '';
  if (/^image\/(png|jpe?g|gif|webp)$/.test(mime) || ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime === 'application/pdf') return 'pdf';
  return 'doc';
}
/** 미리보기 패널: 사진은 큰 그림 · 영상은 재생 · PDF 는 첫 장(창 안) · 한글·워드·엑셀 등은 파일 정보 + 본문 앞부분(올릴 때 뽑아 둔 글자) + [새 탭에서 열기/내려받기].
 *  업무 첨부 [자료실에서] 창과 메일·문자 [자료실에서 고르기] 두 곳이 같이 쓴다 */
export function LibPreview({ f, onClose, action, backLabel, className }: { f: LibPreviewFile; onClose: () => void; backLabel?: string; className?: string;
  action?: { label: string; on: () => void; active?: boolean } }) {
  const kind = libPreviewKind(f); const k = fileKind({ kind: 'file', mime_type: f.mime_type, file_name: f.file_name }); const ext = fileExt({ kind: 'file', mime_type: f.mime_type, file_name: f.file_name });
  const url = `/api/library/${f.id}/download?inline=1`;
  const [text, setText] = useState<{ text: string | null; more: boolean; text_error: string | null } | null>(null); const [textErr, setTextErr] = useState('');
  const [broken, setBroken] = useState(false);
  const android = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent); // 안드로이드 웹뷰는 창 안 PDF 를 못 그림 → 새 탭 안내
  useEffect(() => { setText(null); setTextErr(''); setBroken(false);
    if (kind === 'image' || kind === 'video') return; let on = true;
    api<any>(`/api/library/${f.id}/preview`).then((d) => { if (on) setText(d); }).catch((e) => { if (on) setTextErr(e.message); });
    return () => { on = false; }; }, [f.id, kind]);
  const name = f.title || f.file_name;
  return (
    <div className={cx('flex min-h-0 flex-col gap-2 rounded-input border border-line bg-white p-2.5', className)} data-testid="lib-preview" data-kind={kind}>
      <div className="flex items-center gap-1.5">
        {backLabel && <button type="button" onClick={onClose} className="inline-flex h-7 shrink-0 items-center gap-0.5 rounded px-1 text-xs text-ink-2 hover:bg-slate-50 md:hidden" data-testid="lib-preview-back"><ChevronLeft className="size-4" />{backLabel}</button>}
        <FileKindIcon a={{ kind: 'file', mime_type: f.mime_type, file_name: f.file_name }} small />
        <span className="min-w-0 flex-1 truncate text-sm font-medium" title={f.file_name}>{name}</span>
        <button type="button" onClick={onClose} className={cx('inline-flex size-7 shrink-0 items-center justify-center rounded text-ink-3 hover:bg-slate-100 hover:text-ink-1', backLabel && 'hidden md:inline-flex')} aria-label="미리보기 닫기" title="미리보기 닫기"><X className="size-4" /></button>
      </div>
      {kind === 'image' && !broken && <img src={url} alt="" className="max-h-[42vh] w-full rounded-input bg-slate-50 object-contain" onError={() => setBroken(true)} data-testid="lib-preview-media" />}
      {kind === 'video' && <video src={url} controls playsInline preload="metadata" className="max-h-[42vh] w-full rounded-input bg-black" data-testid="lib-preview-media" />}
      {kind === 'pdf' && (android
        ? <p className="rounded-input bg-slate-50 px-3 py-6 text-center text-xs text-ink-3">안드로이드 앱에서는 PDF 를 창 안에 그릴 수 없습니다 — 아래 [새 탭에서 열기]로 보세요</p>
        : <iframe src={`${url}#page=1&toolbar=0&navpanes=0`} title={`${name} 첫 장`} className="h-[42vh] w-full rounded-input border border-line bg-slate-50" data-testid="lib-preview-media" />)}
      {(kind === 'doc' || broken) && (
        <div className="flex items-center gap-3 rounded-input bg-slate-50 px-3 py-3">
          <span className={cx('flex size-11 shrink-0 items-center justify-center rounded-lg text-xs font-extrabold', k.cls)}>{ext.slice(0, 4)}</span>
          <p className="text-xs text-ink-2">{broken ? '이 사진은 화면에서 바로 그릴 수 없는 형식(HEIC 등)이라 내려받아 확인해 주세요' : `${k.label} 파일은 창 안에서 바로 열 수 없어 파일 정보와 본문 앞부분으로 보여 드립니다`}</p>
        </div>)}
      <dl className="grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-1 text-xs" data-testid="lib-preview-info">
        <dt className="text-ink-3">종류</dt><dd>{k.label} · {ext}{f.security === 'confidential' ? ' · 기밀' : ''}</dd>
        <dt className="text-ink-3">크기</dt><dd className="tabular-nums">{f.size_bytes ? fmtSize(Number(f.size_bytes)) : '-'}</dd>
        <dt className="text-ink-3">올린 사람</dt><dd>{f.created_by_name || '-'}</dd>
        <dt className="text-ink-3">올린 때</dt><dd>{f.created_at ? fmtDateTime(f.created_at) : '-'}</dd>
        <dt className="text-ink-3">폴더</dt><dd className="break-all">{f.folder || '최상위'}{f.team_name ? ` · ${f.team_name}` : ''}</dd>
        {f.description && <><dt className="text-ink-3">설명</dt><dd className="whitespace-pre-wrap break-words">{f.description}</dd></>}
        {(f.tags?.length ?? 0) > 0 && <><dt className="text-ink-3">태그</dt><dd>{f.tags!.join(' · ')}</dd></>}
      </dl>
      {kind !== 'image' && kind !== 'video' && (
        <div className="rounded-input border border-line bg-slate-50/60 p-2" data-testid="lib-preview-text">
          <p className="mb-1 text-[11px] font-medium text-ink-3">본문 앞부분{text?.more ? ' (1,500자까지)' : ''}</p>
          {textErr ? <p className="text-xs text-red-700">{textErr}</p>
            : !text ? <p className="text-xs text-ink-3"><Loader2 className="inline size-3 animate-spin" /> 불러오는 중…</p>
            : text.text ? <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-ink-1">{text.text}</pre>
            : <p className="text-xs text-ink-3">{text.text_error ?? '본문 없음'}</p>}
        </div>)}
      <div className="mt-auto flex flex-wrap items-center justify-end gap-1.5 pt-1">
        <a href={url} target="_blank" rel="noopener" className="inline-flex h-8 items-center gap-1 rounded-input border border-line px-2.5 text-xs text-ink-2 hover:bg-slate-50" data-testid="lib-preview-open"><ExternalLink className="size-3.5" />{kind === 'doc' ? '내려받기' : '새 탭에서 열기'}</a>
        {action && <Button size="sm" variant={action.active ? 'secondary' : 'primary'} onClick={action.on} data-testid="lib-preview-pick">{action.label}</Button>}
      </div>
    </div>
  );
}
