'use client';
import { useState, type ReactNode } from 'react';
import { Upload } from 'lucide-react';
import { cx } from './ui';

/**
 * V12 9번: 업로드 공통 — 진행률(%) + 실패 원인을 사람이 알 수 있는 말로.
 * presigned PUT(R2·S3) 은 브라우저가 저장소로 바로 보내므로, 저장소 CORS·네트워크 문제는 status 0 으로만 보인다.
 */
export async function putFile(target: { url: string; method?: string; headers?: Record<string, string>; fallback?: string; fallbackMax?: number }, file: Blob, onProgress?: (pct: number) => void): Promise<void> {
  try {
    await xhrPut(target.url, target.method ?? 'PUT', target.headers, file, onProgress);
  } catch (e) {
    // 저장소로 바로 보내기 실패(CORS·네트워크·서명 문제) → 작은 파일은 서버를 거쳐 다시 보냄
    if (target.fallback && file.size <= (target.fallbackMax ?? 4 * 1024 * 1024)) {
      try { onProgress?.(0); await xhrPut(target.fallback, 'PUT', target.headers, file, onProgress); return; }
      catch (e2) { throw new Error(`${(e as Error).message} / 서버 경유 재시도도 실패: ${(e2 as Error).message}`); }
    }
    throw e;
  }
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
export function uploadErrorText(status: number) {
  if (status === 0) return navigator.onLine === false ? '인터넷에 연결되어 있지 않습니다 — 연결 후 다시 올려 주세요'
    : '파일 저장소에 연결하지 못했습니다(저장소 접근 설정 또는 네트워크 문제) — 잠시 후 다시 시도하고, 계속되면 관리자에게 알려 주세요';
  if (status === 403) return '업로드 허가가 만료되었거나 거부되었습니다 — 다시 올려 주세요(계속되면 관리자에게 알려 주세요)';
  if (status === 413) return '파일이 너무 큽니다 — 50MB 이하로 줄여서 올려 주세요';
  if (status >= 500) return `파일 저장소가 일시적으로 응답하지 않습니다(${status}) — 잠시 후 다시 올려 주세요`;
  return `파일을 보내지 못했습니다(${status}) — 다시 올려 주세요`;
}

/** 파일을 끌어다 놓는 영역: 놓으면 onFiles(여러 개). 끄는 동안 "여기에 놓으세요" 덮개 */
export function DropZone({ onFiles, children, className, label = '여기에 놓으면 올라갑니다', disabled, testid }: { onFiles: (f: FileList) => void; children: ReactNode; className?: string; label?: string; disabled?: boolean; testid?: string }) {
  const [over, setOver] = useState(0);
  const has = (e: React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
  return (
    <div className={cx('relative', className)} data-testid={testid}
      onDragEnter={(e) => { if (disabled || !has(e)) return; e.preventDefault(); setOver((n) => n + 1); }}
      onDragOver={(e) => { if (disabled || !has(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
      onDragLeave={(e) => { if (disabled || !has(e)) return; setOver((n) => Math.max(0, n - 1)); }}
      onDrop={(e) => { if (disabled || !has(e)) return; e.preventDefault(); setOver(0); if (e.dataTransfer.files?.length) onFiles(e.dataTransfer.files); }}>
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
export function UploadProgress({ items }: { items: { name: string; pct: number; error?: string }[] }) {
  if (!items.length) return null;
  return (
    <ul className="mt-2 space-y-1 text-xs" data-testid="upload-progress" aria-live="polite">
      {items.map((it, i) => (
        <li key={i}>
          <div className="flex justify-between gap-2"><span className="truncate">{it.name}</span><span className={it.error ? 'text-red-600' : 'tabular-nums text-ink-2'}>{it.error ? '실패' : `${it.pct}%`}</span></div>
          {it.error ? <p className="text-red-600" role="alert">{it.error}</p> : <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-accent-500 transition-[width]" style={{ width: `${it.pct}%` }} /></div>}
        </li>
      ))}
    </ul>
  );
}

/** V12 10번: 업로드 안내 상자 — PC "끌어다 놓거나 눌러서 선택", 휴대폰 "눌러서 사진 찍기·파일 선택" */
export function DropHint({ onClick, disabled, what = '사진·PDF·문서', max = '50MB', testid = 'drop-hint' }: { onClick: () => void; disabled?: boolean; what?: string; max?: string; testid?: string }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} data-testid={testid}
      className="flex w-full flex-col items-center justify-center gap-1 rounded-card border-2 border-dashed border-slate-300 bg-slate-50/60 px-3 py-4 text-center text-sm text-ink-2 transition-colors hover:border-accent-500 hover:bg-accent-50/50 disabled:opacity-50">
      <Upload className="size-5 text-ink-3" />
      <span className="hidden sm:inline">파일을 여기로 <b className="font-semibold text-ink">끌어다 놓거나 눌러서 선택</b>하세요</span>
      <span className="sm:hidden"><b className="font-semibold text-ink">눌러서 사진 찍기·파일 선택</b></span>
      <span className="text-xs text-ink-3">{what}, 최대 {max} · 여러 개 가능</span>
    </button>
  );
}
