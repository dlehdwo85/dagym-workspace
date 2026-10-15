'use client';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Copy, Pencil, RotateCw, Send, Square } from 'lucide-react';
import { api } from './client';
import { Button, cx, inputCls, toast } from './ui';

/**
 * V19 부록 A: AI 비서 대화 입력(화면·패널 공통)
 * A1 휴대폰 Enter = 줄바꿈(보내기는 버튼), PC Enter = 보내기·Shift+Enter = 줄바꿈, 입력창 자동 높이(최대 6줄)
 * A2 답을 기다리는 동안 [보내기] → [멈춤] — 요청을 끊으면 서버도 AI 호출을 멈추고 제안을 만들지 않는다
 * A3 마지막 내 말 [수정]·AI 답 [다시 답하기]·모든 말 [복사]
 */
export type ChatMsg = { role: 'user' | 'assistant'; text: string; files?: string[]; proposals?: any[]; error?: boolean; blocked?: boolean; stopped?: boolean; note?: boolean; docJobs?: string[] };

export function useAiConversation<M extends ChatMsg>(opts: {
  /** 이번 요청의 본문(대화 id·맥락·첨부) */
  body: (text: string, fileIds: string[]) => Record<string, unknown>;
  /** 답을 받았을 때(대화 id 저장 등) */
  onReply?: (r: any) => void;
  toAssistant: (r: any) => M;
}) {
  const [msgs, setMsgs] = useState<M[]>([]);
  const [busy, setBusy] = useState(false);
  const ac = useRef<AbortController | null>(null);
  const replacing = useRef<string | null>(null); // 고쳐 보내기·다시 답하기: 바꿀 원래 질문
  const o = useRef(opts); o.current = opts;
  const msgsRef = useRef(msgs); msgsRef.current = msgs;

  async function send(text: string, files: { id: string; name: string }[] = [], shownFiles?: string[]) {
    const replaceText = replacing.current; replacing.current = null;
    setMsgs((m) => [...m, { role: 'user', text, files: shownFiles ?? (files.length ? files.map((f) => f.name) : undefined) } as M]);
    setBusy(true);
    const ctl = new AbortController(); ac.current = ctl;
    try {
      const r = await api('/api/ai/chat', { body: { ...o.current.body(text, files.map((f) => f.id)), ...(replaceText !== null ? { replaceLast: true, replaceText } : {}) }, signal: ctl.signal });
      if (ctl.signal.aborted) return;
      o.current.onReply?.(r);
      if (r.stopped) return;
      setMsgs((m) => [...m, ...(r.kept?.length ? [{ role: 'assistant', text: `이전 요청으로 이미 처리됨: ${r.kept.join(' · ')}`, note: true } as M] : []), o.current.toAssistant(r)]);
    } catch (e: any) {
      if (ctl.signal.aborted) return;
      setMsgs((m) => [...m, { role: 'assistant', text: e.message, error: true } as M]);
    } finally {
      if (ac.current === ctl) { ac.current = null; setBusy(false); }
    }
  }
  /** [멈춤]: 요청을 끊고 "멈춤" 표시만 남긴다 */
  function stop(mark = true) {
    if (!ac.current) return;
    ac.current.abort(); ac.current = null; setBusy(false);
    if (mark) setMsgs((m) => [...m, { role: 'assistant', text: '멈춤', stopped: true } as M]);
  }
  /** 이 질문(i)과 그 뒤를 화면에서 걷어 낸다 — 이미 실행된 제안은 "이미 처리됨"으로 남김 */
  function cutFrom(i: number) {
    const after = msgsRef.current.slice(i + 1);
    const done = after.flatMap((m) => (m.proposals ?? []).filter((p: any) => p.state === 'done').map((p: any) => p.summary));
    setMsgs([...msgsRef.current.slice(0, i), ...(done.length ? [{ role: 'assistant', text: `이전 요청으로 이미 처리됨: ${done.join(' · ')}`, note: true } as M] : [])]);
  }
  const lastUser = () => { for (let i = msgsRef.current.length - 1; i >= 0; i--) if (msgsRef.current[i].role === 'user') return i; return -1; };
  /** [수정]: 마지막 질문을 입력창으로 되돌린다 (답하는 중이면 먼저 멈춤) */
  function editLast(): string | null {
    if (ac.current) stop(false);
    const i = lastUser(); if (i < 0) return null;
    const q = msgsRef.current[i];
    replacing.current = q.text;
    cutFrom(i);
    return q.text;
  }
  /** [다시 답하기]: 같은 질문으로 다시 */
  function regenerate() {
    if (ac.current) stop(false);
    const i = lastUser(); if (i < 0) return;
    const q = msgsRef.current[i];
    replacing.current = q.text;
    cutFrom(i);
    void send(q.text, [], q.files);
  }
  const cancelEdit = () => { replacing.current = null; };
  useEffect(() => () => ac.current?.abort(), []);
  return { msgs, setMsgs, busy, send, stop, editLast, regenerate, cancelEdit, lastUserIndex: lastUser };
}

const touchInput = () => typeof window !== 'undefined' && (!!window.matchMedia?.('(pointer: coarse)').matches || window.innerWidth < 640);

/** 입력창 + [보내기]/[멈춤] — 자동 높이(최대 6줄) */
export function ChatComposer({ value, onChange, onSend, onStop, busy, canSend, placeholder, ariaLabel, onPaste, leading, trailing, disabled, small, inputRef }: {
  value: string; onChange: (v: string) => void; onSend: () => void; onStop: () => void; busy: boolean; canSend: boolean; placeholder?: string; ariaLabel: string;
  onPaste?: (e: React.ClipboardEvent) => void; leading?: ReactNode; trailing?: ReactNode; disabled?: boolean; small?: boolean; inputRef?: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const own = useRef<HTMLTextAreaElement>(null);
  const ref = inputRef ?? own;
  const [touch, setTouch] = useState(false);
  useEffect(() => setTouch(touchInput()), []);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    el.style.height = 'auto';
    const cs = getComputedStyle(el);
    const line = parseFloat(cs.lineHeight) || 20;
    const max = line * 6 + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + 2;
    el.style.height = `${Math.min(el.scrollHeight + 2, max)}px`;
    el.style.overflowY = el.scrollHeight + 2 > max ? 'auto' : 'hidden';
  }, [value, ref]);
  return (
    <div>
      <div className="flex items-end gap-1.5">
        {leading}
        <textarea ref={ref} rows={1} className={cx(inputCls, 'flex-1 resize-none leading-5', small ? 'min-h-9 py-1.5' : 'min-h-[42px] py-2.5')} value={value}
          onChange={(e) => onChange(e.target.value)} onPaste={onPaste} placeholder={placeholder} aria-label={ariaLabel} disabled={disabled} enterKeyHint={touch ? 'enter' : 'send'}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
            if (touch || e.shiftKey) return; // 휴대폰은 Enter = 줄바꿈, PC 는 Shift+Enter = 줄바꿈
            e.preventDefault();
            if (!busy && canSend) onSend();
          }} />
        {trailing}
        {busy
          ? <Button type="button" variant="secondary" onClick={onStop} aria-label="멈춤" title="답변 멈춤" data-testid="ai-stop"><Square className="fill-current" /></Button>
          : <Button type="button" onClick={onSend} disabled={!canSend} aria-label="보내기"><Send /></Button>}
      </div>
      {!touch && <p className="mt-0.5 px-1 text-[10px] text-ink-3" data-testid="ai-enter-hint">Enter 보내기 · Shift+Enter 줄바꿈</p>}
    </div>
  );
}

/** 말풍선 아래 작은 단추: [복사] (+ 마지막 질문 [수정], 마지막 답 [다시 답하기]) */
export function MsgTools({ text, onEdit, onRegenerate, right }: { text: string; onEdit?: () => void; onRegenerate?: () => void; right?: boolean }) {
  const btn = 'inline-flex items-center gap-0.5 rounded px-1 py-0.5 hover:bg-slate-100 hover:text-ink';
  return (
    <div className={cx('mt-0.5 flex gap-0.5 text-[11px] text-ink-3', right && 'justify-end')} data-testid="ai-msg-tools">
      <button type="button" className={btn} onClick={() => { navigator.clipboard?.writeText(text).then(() => toast.ok('복사했습니다'), () => toast.error('복사하지 못했습니다')); }} aria-label="복사"><Copy className="size-3" />복사</button>
      {onEdit && <button type="button" className={btn} onClick={onEdit} aria-label="수정" data-testid="ai-edit-last"><Pencil className="size-3" />수정</button>}
      {onRegenerate && <button type="button" className={btn} onClick={onRegenerate} aria-label="다시 답하기" data-testid="ai-regenerate"><RotateCw className="size-3" />다시 답하기</button>}
    </div>
  );
}
