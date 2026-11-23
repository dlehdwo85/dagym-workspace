'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { Upload } from 'lucide-react';
import { askConfirm, cx, toast } from './ui';
import { useApi } from './client';
/** 379차 #1003(대표 11/07 '아이폰 사진 한 번에 100장 이상'): 한 번에 고르는 최대 개수 — 메신저(CHAT_FILES_MAX 200, 213차)와 같게 업무 첨부·자료실·마케팅 자료 요청도 200 */
export const PICK_MAX = 200;

/**
 * V12 9번: 업로드 공통 — 진행률(%) + 실패 원인을 사람이 알 수 있는 말로.
 * presigned PUT(R2·S3) 은 브라우저가 저장소로 바로 보내므로, 저장소 CORS·네트워크 문제는 status 0 으로만 보인다.
 */
export type PutTarget = { url: string; method?: string; headers?: Record<string, string>; fallback?: string; fallbackMax?: number; multipart?: { uploadId: string; partSize: number; parts: { n: number; url: string }[] } };
/** 돌려주는 uploadId 는 조각 업로드일 때만 — 완료 API(…/complete 또는 메시지 file.uploadId)에 넘겨야 서버가 조각을 합친다 */
export async function putFile(target: PutTarget, file: Blob, onProgress?: (pct: number) => void): Promise<{ uploadId?: string }> {
  // #1128(로컬 11/23 선택안): 휴대폰 데이터(셀룰러)로 100MB 넘는 파일을 올릴 때 한 번 확인 — 연결 종류를 알려 주는 브라우저(안드로이드 크롬 등)만
  const conn = typeof navigator !== 'undefined' ? (navigator as Navigator & { connection?: { type?: string } }).connection : undefined;
  if (file.size > 100 * 1024 * 1024 && conn?.type === 'cellular'
    && !(await askConfirm(`휴대폰 데이터로 ${Math.round(file.size / 1024 / 1024)}MB 를 올립니다. 와이파이가 아니면 데이터 요금이 나올 수 있습니다. 계속할까요?`, { title: '큰 파일 올리기', ok: '올리기' }))) {
    throw new Error('올리기를 취소했습니다');
  }
  // #109 영상 100MB: 8MB 조각을 차례로(조각마다 2번까지 재시도), 진행률은 전체 기준
  if (target.multipart) {
    const { parts, partSize, uploadId } = target.multipart;
    let done = 0;
    for (const p of parts) {
      const chunk = file.slice((p.n - 1) * partSize, Math.min(file.size, p.n * partSize));
      let last: unknown = null;
      for (let tryN = 0; tryN < 3; tryN++) {
        try { await xhrPut(p.url, 'PUT', target.headers, chunk, (pct) => onProgress?.(Math.round(((done + (chunk.size * pct) / 100) / file.size) * 100))); last = null; break; } catch (e) { last = e; }
      }
      if (last) throw new Error(`조각 ${p.n}/${parts.length}: ${blockedHint((last as Error).message)}`);
      done += chunk.size; onProgress?.(Math.round((done / file.size) * 100));
    }
    return { uploadId };
  }
  try {
    await xhrPut(target.url, target.method ?? 'PUT', target.headers, file, onProgress);
  } catch (e) {
    // 저장소로 바로 보내기 실패(CORS·네트워크·서명 문제) → 작은 파일은 서버를 거쳐 다시 보냄
    if (target.fallback && file.size <= (target.fallbackMax ?? 4 * 1024 * 1024)) {
      try { onProgress?.(0); await xhrPut(target.fallback, 'PUT', target.headers, file, onProgress); return {}; }
      catch (e2) { throw new Error(`${(e as Error).message} / 서버 경유 재시도도 실패: ${(e2 as Error).message}`); }
    }
    throw new Error(blockedHint((e as Error).message));
  }
  return {};
}
function xhrPut(url: string, method: string, headers: Record<string, string> | undefined, file: Blob, onProgress?: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open(method, url);
    for (const [k, v] of Object.entries(headers ?? {})) x.setRequestHeader(k, v);
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100)); };
    // 실패하면 상태 코드와 응답 본문 앞부분(저장소 오류 코드 등)을 함께 보여 준다
    x.onload = () => (x.status >= 200 && x.status < 300 ? resolve() : reject(new Error(`${uploadErrorText(x.status)} [${x.status}${x.responseText ? ` ${x.responseText.replace(/\s+/g, ' ').slice(0, 160)}` : ''}]`)));
    x.onerror = () => reject(new Error(uploadErrorText(0)));
    x.ontimeout = () => reject(new Error('시간이 너무 오래 걸려 멈췄습니다 — 인터넷 연결을 확인하고 다시 올려 주세요'));
    x.timeout = 10 * 60_000;
    x.send(file);
  });
}
/**
 * #1132(로컬 11/23): 저장소로 바로 보내기가 막힘(상태 0, 인터넷은 연결됨) — 4MB 넘는 파일·조각은 서버 경유 재시도가 안 되므로(Vercel 요청 4.5MB 한계·조각 최소 5MB)
 * 원인이 보이게: 이 주소가 저장소 허용 주소(CORS)에 없을 때가 대부분
 */
function blockedHint(msg: string) {
  if (msg !== uploadErrorText(0) || typeof navigator === 'undefined' || navigator.onLine === false) return msg;
  return `파일 저장소가 이 주소(${typeof location !== 'undefined' ? location.host : ''})에서 보낸 4MB 넘는 파일을 받지 않았습니다(저장소 허용 주소 설정 문제) — 관리자에게 알려 주세요`;
}
export function uploadErrorText(status: number) {
  if (status === 0) return navigator.onLine === false ? '인터넷에 연결되어 있지 않습니다 — 연결 후 다시 올려 주세요'
    : '파일 저장소에 연결하지 못했습니다(저장소 접근 설정 또는 네트워크 문제) — 잠시 후 다시 시도하고, 계속되면 관리자에게 알려 주세요';
  if (status === 403) return '업로드 허가가 만료되었거나 거부되었습니다 — 다시 올려 주세요(계속되면 관리자에게 알려 주세요)';
  if (status === 413) return '파일이 너무 큽니다 — 회사가 정한 파일 한 개 최대 크기(관리 › 회사 정보) 이하로 줄여서 올려 주세요';
  if (status >= 500) return `파일 저장소가 일시적으로 응답하지 않습니다(${status}) — 잠시 후 다시 올려 주세요`;
  return `파일을 보내지 못했습니다(${status}) — 다시 올려 주세요`;
}

/** input accept 문자열('.pdf,image/*,application/pdf')에 맞는 파일인지 — 비우면 모두 허용 */
export function acceptOk(f: File, accept?: string) {
  if (!accept) return true;
  const name = f.name.toLowerCase(); const type = (f.type || '').toLowerCase();
  return accept.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean).some((a) =>
    a.startsWith('.') ? name.endsWith(a) : a.endsWith('/*') ? type.startsWith(a.slice(0, -1)) : type === a);
}

/**
 * 파일을 끌어다 놓는 영역: 놓으면 onFiles(여러 개) 또는 onFile(하나). 끄는 동안 "여기에 놓으세요" 덮개.
 * #1122(대표 11/22 '계약서 끌어다 놓기가 안 됨'): accept 를 주면 형식을 확인('이 형식은 올릴 수 없습니다 — acceptLabel'),
 * onFile(하나만)에 여러 개를 놓으면 첫 번째만 + 안내.
 */
export function DropZone({ onFiles, onFile, accept, acceptLabel, children, className, label = '여기에 놓으면 올라갑니다', disabled, testid }: {
  onFiles?: (f: FileList) => void; onFile?: (f: File) => void; accept?: string; acceptLabel?: string;
  children: ReactNode; className?: string; label?: string; disabled?: boolean; testid?: string;
}) {
  const [over, setOver] = useState(0);
  const has = (e: React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
  const dropped = (fl: FileList) => {
    const all = Array.from(fl); const ok = all.filter((f) => acceptOk(f, accept));
    if (!ok.length) { toast.error(`이 형식은 올릴 수 없습니다${acceptLabel ? ` — ${acceptLabel}` : ''}`); return; }
    if (ok.length < all.length) toast.info(`올릴 수 없는 형식 ${all.length - ok.length}개는 뺐습니다${acceptLabel ? ` (${acceptLabel})` : ''}`);
    if (onFile) { if (ok.length > 1) toast.info('파일은 하나만 올릴 수 있어 첫 번째 파일만 올립니다'); onFile(ok[0]); return; }
    if (!onFiles) return;
    if (ok.length === all.length) { onFiles(fl); return; }
    const dt = new DataTransfer(); ok.forEach((f) => dt.items.add(f)); onFiles(dt.files);
  };
  return (
    <div className={cx('relative', className)} data-testid={testid}
      // 안쪽 칸이 받으면 바깥 칸(겹친 DropZone)은 받지 않게 stopPropagation — 한 번 놓으면 한 번만 올라감
      onDragEnter={(e) => { if (disabled || !has(e)) return; e.preventDefault(); e.stopPropagation(); setOver((n) => n + 1); }}
      onDragOver={(e) => { if (disabled || !has(e)) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; }}
      onDragLeave={(e) => { if (disabled || !has(e)) return; e.stopPropagation(); setOver((n) => Math.max(0, n - 1)); }}
      onDrop={(e) => { if (disabled || !has(e)) return; e.preventDefault(); e.stopPropagation(); setOver(0); if (e.dataTransfer.files?.length) dropped(e.dataTransfer.files); }}>
      {children}
      {over > 0 && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-card border-2 border-dashed border-accent-500 bg-accent-50/90 text-sm font-semibold text-accent-700">
          <Upload className="mr-1.5 size-4" />{label}
        </div>
      )}
    </div>
  );
}

/** 여러 파일 진행률 줄 */
export function UploadProgress({ items }: { items: { name: string; pct: number; error?: string; note?: string; onOpen?: () => void }[] }) {
  if (!items.length) return null;
  // 대표 10/27(사진 150장): 6개 이상이면 한 줄 요약(올린 수/전체 · 실패 수 · 전체 진행 막대) + 펼치면 파일별(실패 먼저)
  if (items.length > 5) {
    const done = items.filter((x) => !x.error && x.pct >= 100).length, bad = items.filter((x) => x.error).length;
    const pct = Math.round(items.reduce((a, x) => a + (x.error ? 100 : x.pct), 0) / items.length);
    const busy = done + bad < items.length;
    return (
      <div className="mt-2 rounded-input border border-line bg-white p-2 text-xs" data-testid="upload-progress" data-summary="1" aria-live="polite">
        <div className="flex flex-wrap items-center gap-x-2"><b className="tabular-nums" data-testid="upload-summary">{busy ? '올리는 중' : '올리기 끝'} {done}/{items.length}</b>
          {bad > 0 && <span className="font-semibold text-red-600" role="alert" data-testid="upload-failed">실패 {bad}</span>}
          {busy && <span className="text-ink-3">화면을 닫지 말고 기다려 주세요</span>}</div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={cx('h-full transition-[width]', bad ? 'bg-amber-500' : 'bg-accent-500')} style={{ width: `${pct}%` }} /></div>
        <details className="mt-1" open={!busy && bad > 0}>
          <summary className="cursor-pointer text-ink-2">파일별 보기</summary>
          <ul className="mt-1 max-h-48 space-y-0.5 overflow-y-auto">
            {[...items].sort((a, b) => Number(!!b.error) - Number(!!a.error)).map((it, i) => (
              <li key={i} className="flex justify-between gap-2"><span className="truncate">{it.name}</span>
                <span className={it.error ? 'shrink-0 text-red-600' : 'shrink-0 tabular-nums text-ink-2'} title={it.error}>{it.error ? `실패 — ${it.error}` : it.note ?? `${it.pct}%`}</span></li>
            ))}
          </ul>
        </details>
      </div>
    );
  }
  return (
    <ul className="mt-2 space-y-1 text-xs" data-testid="upload-progress" aria-live="polite">
      {items.map((it, i) => (
        <li key={i}>
          <div className="flex justify-between gap-2"><span className="truncate">{it.name}</span><span className={it.error ? 'text-red-600' : 'tabular-nums text-ink-2'}>{it.error ? '실패' : `${it.pct}%`}</span></div>
          {it.error ? <p className="text-red-600" role="alert">{it.error}</p> : it.note ? <p className="text-violet-700" data-testid="upload-note">{it.note}{it.onOpen && <button type="button" className="ml-1.5 font-semibold underline" onClick={it.onOpen}>열기</button>}</p>
            : <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-accent-500 transition-[width]" style={{ width: `${it.pct}%` }} /></div>}
        </li>
      ))}
    </ul>
  );
}

/** V12 10번: 업로드 안내 상자 — PC "끌어다 놓거나 눌러서 선택", 휴대폰 "눌러서 사진 찍기·파일 선택" */
export function DropHint({ onClick, disabled, what = '사진·PDF·문서', max, testid = 'drop-hint' }: { onClick: () => void; disabled?: boolean; what?: string; max?: string; testid?: string }) {
  const fm = useApi<{ text: string }>(max ? null : '/api/org/file-max'); // #1128: 회사가 정한 파일 한 개 최대 크기
  const maxText = max ?? fm.data?.text;
  return (
    <button type="button" onClick={onClick} disabled={disabled} data-testid={testid}
      className="flex w-full flex-col items-center justify-center gap-1 rounded-card border-2 border-dashed border-slate-300 bg-slate-50/60 px-3 py-4 text-center text-sm text-ink-2 transition-colors hover:border-accent-500 hover:bg-accent-50/50 disabled:opacity-50">
      <Upload className="size-5 text-ink-3" />
      <span className="hidden sm:inline">파일을 여기로 <b className="font-semibold text-ink">끌어다 놓거나 눌러서 선택</b>하세요</span>
      <span className="sm:hidden"><b className="font-semibold text-ink">눌러서 사진 찍기·파일 선택</b></span>
      <span className="text-xs text-ink-3">{what}{maxText ? `, 최대 ${maxText}` : ''} · 여러 개 가능</span>
    </button>
  );
}

/** V13 3번 중복 감지: 기기에서 SHA-256 (50MB 넘거나 보안 연결이 아니면 생략 — #1128 2GB 파일도 브라우저 메모리에 통째로 읽지 않음) */
export async function fileHash(file: Blob): Promise<string | undefined> {
  try {
    if (file.size > 50 * 1024 * 1024 || !globalThis.crypto?.subtle) return undefined;
    const h = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch { return undefined; }
}

/**
 * #1122 앱 전체 보호: 놓는 칸이 아닌 곳에 파일을 떨어뜨려도 브라우저가 그 파일을 열며 쓰던 화면을 떠나지 않게.
 * DropZone·파일 입력 칸은 그대로(이미 처리했으면 defaultPrevented) — window 에서 마지막으로 받아 기본 동작만 막음.
 */
export function DropGuard() {
  useEffect(() => {
    const isFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const native = (e: DragEvent) => (e.target as HTMLElement | null)?.closest?.('input[type="file"]');
    const over = (e: DragEvent) => { if (!isFiles(e) || e.defaultPrevented || native(e)) return; e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'none'; };
    const drop = (e: DragEvent) => { if (!isFiles(e) || e.defaultPrevented || native(e)) return; e.preventDefault(); toast.info('여기에는 파일을 놓을 수 없습니다 — 파일을 올리는 칸에 놓아 주세요'); };
    window.addEventListener('dragover', over); window.addEventListener('drop', drop);
    return () => { window.removeEventListener('dragover', over); window.removeEventListener('drop', drop); };
  }, []);
  return null;
}
