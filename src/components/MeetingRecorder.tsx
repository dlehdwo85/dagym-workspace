'use client';
// V30 ⑥ (#74) 녹음 → 회의록 AI 요약: 일정 편집 화면 "회의 메모" 아래. [녹음 시작/끝] 또는 [파일 올리기] → 자료실('회의 녹음', 쓰고 지움) → 서버 받아쓰기·요약
// → 카드(요약·결정 사항·할 일 후보 [업무로]·약 N원). 1회 60분, 회사 월 한도(무료 30분)는 서버가 지킨다.
import { useEffect, useRef, useState } from 'react';
import { FileAudio, Mic, Square } from 'lucide-react';
import { api, useApi } from './client';
import { uploadToLibrary } from './libraryUpload';
import { Button, cx, toast } from './ui';

export type MinutesTodo = { title: string; assignee: string | null; due: string | null; detail: string };
export type Minutes = { id: string; summary: string; decisions: string[]; todos: MinutesTodo[]; transcript: string | null; durationSec: number; costKrw: number; createdByName: string | null; createdAt: string };
type Info = { items: Minutes[]; quota: { capMin: number; usedMin: number }; perMinKrw: number; maxSec: number; sttReady: boolean; canWork: boolean };

const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`;

export function MeetingRecorder({ eventId, occurrenceStart, canWork, followed, onTodo }: {
  eventId: string; occurrenceStart?: string; canWork: boolean; followed: Set<string>; onTodo: (t: MinutesTodo) => void;
}) {
  const occQ = occurrenceStart ? `?occurrenceStart=${encodeURIComponent(occurrenceStart)}` : '';
  const info = useApi<Info>(`/api/events/${eventId}/minutes${occQ}`);
  const [rec, setRec] = useState<MediaRecorder | null>(null);
  const [sec, setSec] = useState(0);
  const secRef = useRef(0);
  const chunks = useRef<Blob[]>([]);
  const [status, setStatus] = useState('');
  const [showText, setShowText] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const maxSec = info.data?.maxSec ?? 3600;

  useEffect(() => {
    if (!rec) return;
    const t = setInterval(() => { secRef.current += 1; setSec(secRef.current); if (secRef.current >= maxSec) rec.stop(); }, 1000);
    return () => clearInterval(t);
  }, [rec, maxSec]);

  async function submit(blob: Blob, duration: number) {
    const type = blob.type || 'audio/webm';
    const ext = /mp4|m4a/.test(type) ? 'm4a' : /wav/.test(type) ? 'wav' : /mpeg|mp3/.test(type) ? 'mp3' : 'webm';
    const est = Math.max(1, Math.ceil(duration / 60)) * (info.data?.perMinKrw ?? 10);
    try {
      setStatus(`녹음 올리는 중… (${Math.max(1, Math.round(blob.size / 1024 / 1024))}MB)`);
      const up = await uploadToLibrary(new File([blob], `회의 녹음 ${new Date().toISOString().slice(0, 16).replace('T', ' ')}.${ext}`, { type }), '회의 녹음', (pct) => setStatus(`녹음 올리는 중… ${pct}%`), ['회의 녹음']);
      setStatus(`받아쓰고 요약하는 중… (${mmss(duration)}, 약 ${won(est)})`);
      await api(`/api/events/${eventId}/minutes`, { body: { audioFileId: up.id, duration: Math.max(1, Math.round(duration)), ...(occurrenceStart ? { occurrenceStart } : {}) } });
      toast.ok('회의록을 만들었습니다'); info.reload();
    } catch (e: any) { toast.error(e.message); } finally { setStatus(''); }
  }
  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m));
      const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks.current = []; secRef.current = 0; setSec(0);
      r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      r.onstop = () => { stream.getTracks().forEach((t) => t.stop()); setRec(null); const blob = new Blob(chunks.current, { type: r.mimeType || 'audio/webm' }); if (blob.size > 0) void submit(blob, secRef.current); };
      r.start(1000); setRec(r);
    } catch { toast.error('마이크를 쓸 수 없습니다 — 브라우저 권한을 확인하거나 [파일 올리기]로 녹음 파일을 올려 주세요'); }
  }
  function stop() { rec?.stop(); }
  async function pickFile(f: File | undefined) {
    if (!f) return;
    if (f.size > 100 * 1024 * 1024) { toast.error('녹음 파일은 100MB 까지입니다'); return; }
    const dur = await new Promise<number>((res) => {
      const a = document.createElement('audio'); const url = URL.createObjectURL(f);
      a.onloadedmetadata = () => { URL.revokeObjectURL(url); res(Number.isFinite(a.duration) ? a.duration : 0); };
      a.onerror = () => { URL.revokeObjectURL(url); res(0); };
      a.src = url;
    });
    const duration = dur > 0 ? dur : Math.max(1, f.size / 6000);
    if (duration > maxSec) { toast.error(`녹음은 1회 ${Math.round(maxSec / 60)}분까지입니다`); return; }
    await submit(f, duration);
  }

  const latest = info.data?.items[0];
  const q = info.data?.quota;
  const busy = !!status;
  return (
    <section data-testid="minutes">
      <h3 className="mb-2 flex flex-wrap items-center gap-1.5 text-sm font-semibold"><Mic className="size-4 text-ink-3" />AI 회의록
        {q && <span className="text-xs font-normal text-ink-3" data-testid="minutes-quota">· 이번 달 녹음 {q.usedMin}/{q.capMin}분 · 약 {won(info.data!.perMinKrw)}/분</span>}</h3>
      {canWork && (
        <div className="flex flex-wrap items-center gap-2">
          {info.data && !info.data.sttReady ? (
            <p className="text-xs text-ink-2">받아쓰기(STT)가 아직 설정되지 않았습니다 — 플랫폼 운영자에게 요청해 주세요.</p>
          ) : rec ? (
            <Button type="button" size="sm" variant="danger" onClick={stop} data-testid="minutes-stop"><Square />녹음 끝 {mmss(sec)}</Button>
          ) : (
            <>
              <Button type="button" size="sm" variant="secondary" onClick={start} disabled={busy} data-testid="minutes-record"><Mic />녹음 시작</Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => fileRef.current?.click()} disabled={busy} data-testid="minutes-upload"><FileAudio />파일 올리기</Button>
              <input ref={fileRef} type="file" accept="audio/*,video/webm,.m4a,.mp3,.wav,.webm" className="hidden" data-testid="minutes-file" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void pickFile(f); }} />
            </>
          )}
          {status && <span className="text-xs text-ink-2" aria-live="polite" data-testid="minutes-status">{status}</span>}
        </div>
      )}
      {!latest && !status && <p className="mt-1 text-xs text-ink-3">회의를 녹음하거나 녹음 파일을 올리면 요약·결정 사항·할 일을 만들어 드립니다. 녹음 원본은 받아쓴 뒤 바로 지웁니다.</p>}
      {latest && (
        <div className="mt-2 space-y-2 rounded-input border border-line bg-white p-3 text-sm" data-testid="minutes-card">
          <p className="text-xs text-ink-3">{new Date(latest.createdAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · {mmss(latest.durationSec)} · {latest.createdByName ?? ''} · <span data-testid="minutes-cost">약 {won(latest.costKrw)}</span>
            {latest.transcript && <> · <button type="button" className="underline" onClick={() => setShowText(showText ? null : latest.transcript)}>{showText ? '녹취 닫기' : '녹취 보기'}</button></>}</p>
          <p className="whitespace-pre-wrap" data-testid="minutes-summary">{latest.summary}</p>
          {latest.decisions.length > 0 && (
            <div><p className="text-xs font-semibold text-ink-2">결정 사항</p>
              <ul className="mt-0.5 list-disc space-y-0.5 pl-5" data-testid="minutes-decisions">{latest.decisions.map((d, i) => <li key={i}>{d}</li>)}</ul></div>
          )}
          {latest.todos.length > 0 && (
            <div><p className="text-xs font-semibold text-ink-2">할 일 후보</p>
              <ul className="mt-0.5 space-y-1" data-testid="minutes-todos">
                {latest.todos.map((t, i) => (
                  <li key={i} className="flex items-center gap-2 rounded-input bg-slate-50 px-2.5 py-1.5">
                    <span className="min-w-0 flex-1"><span className={cx(followed.has(t.title) && 'text-ink-3')}>{t.title}</span>
                      <span className="ml-1 text-xs text-ink-2">{[t.assignee, t.due ? `기한 ${t.due}` : null].filter(Boolean).join(' · ')}</span>
                      {t.detail && <span className="block truncate text-xs text-ink-3">{t.detail}</span>}</span>
                    {followed.has(t.title) ? <span className="text-xs font-medium text-green-600">업무로 만듦</span>
                      : canWork && <Button type="button" size="sm" variant="ghost" onClick={() => onTodo(t)} data-testid="minutes-todo-task">업무로</Button>}
                  </li>
                ))}
              </ul></div>
          )}
          {showText && <pre className="max-h-60 overflow-y-auto whitespace-pre-wrap rounded-input bg-slate-50 p-2 text-xs text-ink-2" data-testid="minutes-transcript">{showText}</pre>}
          {info.data && info.data.items.length > 1 && <p className="text-xs text-ink-3">이전 회의록 {info.data.items.length - 1}건은 가장 최근 것만 보여 드립니다.</p>}
        </div>
      )}
    </section>
  );
}
