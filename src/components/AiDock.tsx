'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { ArrowLeft, Check, Loader2, Maximize2, Menu, Paperclip, Pin, Plus, Search, Send, Sparkles, X } from 'lucide-react';
import { AttachChips, DEFAULT_FILE_ASK, useAiAttach } from './aiAttach';
import { AI_ACCEPT } from './libraryUpload';
import { DropZone } from './upload';
import { api, broadcastRefresh, useApi } from './client';
import { Button, cx, inputCls, toast } from './ui';

type Ctx = { page: 'home' | 'tasks' | 'task' | 'calendar' | 'library' | 'revenue' | 'reports' | 'messages' | 'other'; id?: string; taskId?: string };
type P = { id: string; summary: string; state?: 'done' | 'cancelled' | 'busy'; link?: string; preview?: { warnings?: string[]; moves?: string[]; folder?: string } };
type M = { role: 'user' | 'assistant'; text: string; files?: string[]; proposals?: P[]; error?: boolean; blocked?: boolean };

/** 지금 화면 → 맥락(id 만) */
function useCtx(): Ctx {
  const path = usePathname();
  const sp = useSearchParams();
  return useMemo(() => {
    const task = /^\/tasks\/([0-9a-f-]{36})/.exec(path)?.[1] ?? (path.startsWith('/tasks') ? sp.get('task') : null);
    if (task) return { page: 'task', taskId: task };
    if (path === '/') return { page: 'home' };
    if (path.startsWith('/tasks') || path.startsWith('/projects')) return { page: 'tasks' };
    if (path.startsWith('/calendar')) return { page: 'calendar', id: sp.get('date') ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date()) };
    if (path.startsWith('/library')) return { page: 'library', id: sp.get('file') ?? undefined };
    if (path.startsWith('/revenue')) return { page: 'revenue' };
    if (path.startsWith('/reports')) return { page: 'reports' };
    if (path.startsWith('/messages')) return { page: 'messages', id: sp.get('room') ?? undefined };
    return { page: 'other' };
  }, [path, sp]);
}
const SUGGEST: Record<Ctx['page'], string[]> = {
  home: ['오늘 내가 할 일 정리해줘', '이번 주 마감 위험한 업무 알려줘', '내일 아침 브리핑처럼 요약해줘'],
  tasks: ['이번 주 마감 업무 담당자별로 정리해줘', '기한 지난 업무 알려줘', '내일 3시 회의 준비 업무 만들어줘'],
  task: ['이 업무 체크리스트 만들어줘', '이 업무 진행 상황 요약해줘', '이 업무 관련 자료 찾아서 첨부해줘'],
  calendar: ['회의 잡아줘', '이 날 일정과 마감 업무 정리해줘', '비어 있는 시간 알려줘', '이번 주 회의 준비 업무 만들어줘'],
  library: ['이 자료 요약해줘', '다짐 로고 찾아줘', '최근 단가표 찾아줘'],
  revenue: ['이번 달 현장별 매출 비교해줘', '전년 대비 많이 줄어든 현장 알려줘', '3분기 매출 엑셀로 만들어줘'],
  reports: ['이번 주 주간 보고 초안 써줘', '지난주 완료한 업무 요약해줘', '다음 주 할 일 정리해줘'],
  messages: ['이 대화 요약해줘', '이 대화에서 할 일 업무로 만들어줘', '정중한 답장 초안 써줘'],
  other: ['오늘 내가 할 일 정리해줘', '자료실에서 로고 찾아줘', '내일 회의 준비 업무 만들어줘'],
};

/** V14 11번: 모든 화면의 AI 비서 — PC 오른쪽 아래 ✨ 패널, 휴대폰은 상단 ✨ → 아래 시트. 대화는 AI 비서 화면과 같은 보관 구조 */
export function AiDock({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const ctx = useCtx();
  const path = usePathname();
  const [msgs, setMsgs] = useState<M[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<'chat' | 'list'>('chat'); // V14 26번: 패널 안 대화 목록
  const end = useRef<HTMLDivElement>(null);
  const att = useAiAttach(); // 대표 요청(2026-10-14): 패널에서도 사진·문서 첨부(버튼·끌어 놓기·붙여넣기)
  // 다른 업무·화면으로 가면 새 대화 (맥락이 섞이지 않게)
  const key = `${ctx.page}:${ctx.id ?? ''}:${ctx.taskId ?? ''}`;
  useEffect(() => { setMsgs([]); setThreadId(null); setView('chat'); }, [key]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs, busy]);
  if (path.startsWith('/assistant')) return null;
  const hideFab = path.startsWith('/messages'); // 메시지 화면은 아래 오른쪽에 보내기 버튼 — 겹치지 않게(휴대폰은 상단 ✨)

  async function send(q: string) {
    const t = q.trim() || (att.files.length ? DEFAULT_FILE_ASK : ''); if (!t || busy || att.uploading) return;
    const sending = att.take();
    setMsgs((m) => [...m, { role: 'user', text: t, files: sending.length ? sending.map((f) => f.name) : undefined }]); setText(''); setBusy(true);
    try {
      const r = await api('/api/ai/chat', { body: { text: t, ...(threadId ? { threadId } : {}), ...(sending.length ? { fileIds: sending.map((f) => f.id) } : {}), ...(ctx.taskId ? { taskId: ctx.taskId } : { context: { page: ctx.page, ...(ctx.id ? { id: ctx.id } : {}) } }) } });
      setThreadId(r.threadId ?? threadId);
      setMsgs((m) => [...m, { role: 'assistant', text: r.reply || '(답 없음)', proposals: r.proposals, blocked: r.blocked }]);
    } catch (e: any) { setMsgs((m) => [...m, { role: 'assistant', text: e.message, error: true }]); } finally { setBusy(false); }
  }
  const newChat = () => { setMsgs([]); setThreadId(null); setView('chat'); };
  async function openThread(id: string) {
    try {
      const r = await api(`/api/ai/threads/${id}`);
      setMsgs(r.messages.map((m: any) => ({ role: m.role === 'user' ? 'user' : 'assistant', text: m.text || (m.status === 'error' ? '(오류)' : ''), files: m.file_names?.length ? m.file_names : undefined, blocked: m.status === 'blocked', error: m.status === 'error',
        proposals: (m.proposals ?? []).map((p: any) => ({ id: p.id, summary: p.summary, state: p.status === 'done' ? 'done' : p.status === 'cancelled' ? 'cancelled' : undefined, link: p.result?.link })) })));
      setThreadId(id); setView('chat');
    } catch (e: any) { toast.error(e.message); }
  }
  async function decide(mi: number, p: P, accept: boolean) {
    const set = (patch: Partial<P>) => setMsgs((m) => m.map((x, i) => (i === mi ? { ...x, proposals: x.proposals!.map((y) => (y.id === p.id ? { ...y, ...patch } : y)) } : x)));
    set({ state: 'busy' });
    try { const r = await api(`/api/ai/proposals/${p.id}`, { body: { accept } }); set({ state: accept ? 'done' : 'cancelled', link: r.link }); if (accept) { toast.ok('반영했습니다'); broadcastRefresh(); } }
    catch (e: any) { set({ state: undefined }); toast.error(e.message); }
  }
  return (
    <>
      {!open && !hideFab && (
        <button onClick={() => onOpenChange(true)} aria-label="AI 비서 열기" data-testid="ai-dock-open"
          className="fixed bottom-6 right-6 z-40 hidden size-12 items-center justify-center rounded-full bg-violet-600 text-white shadow-pop hover:bg-violet-700 sm:flex"><Sparkles className="size-6" /></button>
      )}
      {open && (
        <div className="fixed inset-0 z-50 bg-slate-900/30 sm:inset-auto sm:bottom-6 sm:right-6 sm:bg-transparent" onClick={() => onOpenChange(false)}>
          <section role="dialog" aria-label="AI 비서" onClick={(e) => e.stopPropagation()} data-testid="ai-dock"
            className="absolute inset-x-0 bottom-0 flex h-[78dvh] flex-col rounded-t-2xl bg-white pb-[var(--sab)] shadow-pop sm:static sm:h-[560px] sm:w-[380px] sm:rounded-card sm:border sm:border-line sm:pb-0">
            <header className="flex items-center gap-2 border-b border-line px-3 py-2">
              {view === 'list'
                ? <button onClick={() => setView('chat')} className="inline-flex size-8 items-center justify-center rounded-input text-ink-2 hover:bg-slate-100" aria-label="대화로 돌아가기"><ArrowLeft className="size-4" /></button>
                : <button onClick={() => setView('list')} className="inline-flex size-8 items-center justify-center rounded-input text-ink-2 hover:bg-slate-100" aria-label="대화 목록" title="대화 목록" data-testid="ai-dock-list-open"><Menu className="size-4" /></button>}
              <Sparkles className="size-4 text-violet-600" /><span className="min-w-0 flex-1 truncate text-sm font-semibold">{view === 'list' ? '대화 목록' : 'AI 비서'}</span>
              <button onClick={newChat} className="inline-flex size-8 items-center justify-center rounded-input text-ink-2 hover:bg-slate-100" aria-label="새 대화" title="새 대화" data-testid="ai-dock-new"><Plus className="size-4" /></button>
              <Link href={`/assistant?${new URLSearchParams({ ...(threadId ? { thread: threadId } : {}), ...(ctx.taskId ? { task: ctx.taskId } : {}) })}`} onClick={() => onOpenChange(false)}
                className="inline-flex size-8 items-center justify-center rounded-input text-ink-2 hover:bg-slate-100" aria-label="크게 보기" title="크게 보기"><Maximize2 className="size-4" /></Link>
              <button onClick={() => onOpenChange(false)} className="inline-flex size-8 items-center justify-center rounded-input text-ink-2 hover:bg-slate-100" aria-label="닫기"><X className="size-4" /></button>
            </header>
            {view === 'list' ? <ThreadList ctx={ctx} current={threadId} onPick={openThread} /> : <>
            <DropZone onFiles={(f) => att.attach(f)} disabled={att.full || !!att.uploading} label="여기에 놓으면 AI 요청에 첨부됩니다" className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3" data-testid="ai-dock-chat">
              {!msgs.length && (
                <div className="space-y-1.5">
                  <p className="text-xs text-ink-3">이 화면에 맞춰 물어보세요</p>
                  {SUGGEST[ctx.page].map((s) => <button key={s} onClick={() => send(s)} className="block w-full rounded-input border border-line px-3 py-2 text-left text-sm hover:bg-slate-50" data-testid="ai-dock-suggest">{s}</button>)}
                  <p className="pt-1 text-[11px] text-ink-3">📎 사진·문서를 붙이고 “문서로 만들어줘”, “자료실에 정리해줘”라고 해 보세요</p>
                </div>
              )}
              {msgs.map((m, i) => (
                <div key={i} className={cx('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                  <div className={cx('max-w-[90%] whitespace-pre-wrap rounded-2xl px-3 py-1.5 text-sm', m.role === 'user' ? 'bg-brand-600 text-white' : m.error ? 'bg-red-50 text-red-700' : m.blocked ? 'bg-amber-50 text-amber-900' : 'bg-slate-100 text-ink')}>
                    {m.files && <div className="mb-0.5 text-xs opacity-80">📎 {m.files.join(', ')}</div>}
                    {m.text}
                    {m.proposals?.map((p) => (
                      <div key={p.id} className="mt-1.5 rounded-input border border-amber-200 bg-white p-2 text-ink">
                        <div className="text-xs font-semibold text-amber-700">✨ AI 제안</div><div className="text-sm">{p.summary}</div>
                        {!!p.preview?.moves?.length && <ul className="mt-1 ml-4 list-disc text-xs text-ink-2" data-testid="ai-dock-organize">{p.preview.moves.map((x, k) => <li key={k}>{x}</li>)}</ul>}
                        {p.preview?.folder && <div className="mt-1 text-xs text-ink-2">📁 저장 폴더: {p.preview.folder}</div>}
                        {!!p.preview?.warnings?.length && <ul className="mt-1 rounded bg-amber-50 p-1.5 text-xs text-amber-800" data-testid="ai-dock-warnings">{p.preview.warnings.map((w, k) => <li key={k}>⚠ {w}</li>)}</ul>}
                        {p.state === 'done' ? <div className="mt-1 text-xs text-green-700">✓ 반영됨 {p.link && <Link href={p.link} className="underline">열기</Link>}</div>
                          : p.state === 'cancelled' ? <div className="mt-1 text-xs text-ink-3">취소함</div>
                          : <div className="mt-1 flex gap-1.5"><Button size="sm" onClick={() => decide(i, p, true)} disabled={p.state === 'busy'}><Check />확인</Button><Button size="sm" variant="secondary" onClick={() => decide(i, p, false)} disabled={p.state === 'busy'}><X />취소</Button></div>}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {busy && <div className="flex items-center gap-2 text-sm text-ink-3"><Loader2 className="size-4 animate-spin" />찾아보는 중…</div>}
              <div ref={end} />
            </div>
            </DropZone>
            <div className="border-t border-line">
            <AttachChips files={att.files} uploading={att.uploading} onRemove={att.remove} compact />
            <input ref={att.inputRef} type="file" multiple accept={AI_ACCEPT} className="hidden" onChange={(e) => att.attach(e.target.files)} data-testid="ai-dock-file-input" />
            <form onSubmit={(e) => { e.preventDefault(); send(text); }} className="flex items-end gap-1.5 p-2">
              <button type="button" onClick={() => att.inputRef.current?.click()} disabled={att.full || !!att.uploading} aria-label="사진·자료 첨부" title="사진·자료 첨부 (붙여넣기·끌어 놓기도 됩니다)" data-testid="ai-dock-attach"
                className="inline-flex size-9 shrink-0 items-center justify-center rounded-input text-ink-2 hover:bg-slate-100 disabled:opacity-40"><Paperclip className="size-4" /></button>
              <textarea rows={1} className={cx(inputCls, 'max-h-28 min-h-9 resize-none py-1.5')} value={text} onChange={(e) => setText(e.target.value)} onPaste={att.onPaste} placeholder="AI에게 요청 · 사진 첨부 가능" aria-label="AI 에게 요청 (화면 맥락)"
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(text); } }} />
              <Button type="submit" disabled={busy || !!att.uploading || (!text.trim() && !att.files.length)} aria-label="보내기"><Send /></Button>
            </form>
            </div>
            <p className="px-3 pb-1.5 text-[10px] text-ink-3">회사 업무용 · 관리자가 사용 내역을 볼 수 있습니다</p>
            </>}
          </section>
        </div>
      )}
    </>
  );
}

type Thread = { id: string; title: string; task_id: string | null; task_title: string | null; pinned: boolean; updated_at: string; turns: number; context_page: string | null; context_id: string | null };
/** V14 26번: 패널 안 대화 목록 — 검색, 이 화면·이 업무 관련 대화를 먼저 */
function ThreadList({ ctx, current, onPick }: { ctx: Ctx; current: string | null; onPick: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [sq, setSq] = useState('');
  useEffect(() => { const t = setTimeout(() => setSq(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  const { data, loading } = useApi<{ threads: Thread[] }>(`/api/ai/threads${sq ? `?q=${encodeURIComponent(sq)}` : ''}`);
  const related = (t: Thread) => (ctx.taskId ? t.task_id === ctx.taskId : t.context_page === ctx.page && (!ctx.id || t.context_id === ctx.id));
  const all = data?.threads ?? [];
  const mine = all.filter(related), rest = all.filter((t) => !related(t));
  const when = (s: string) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric' }).format(new Date(s));
  const row = (t: Thread) => (
    <li key={t.id}><button onClick={() => onPick(t.id)} className={cx('flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-slate-50', current === t.id && 'bg-violet-50')} data-testid="ai-dock-thread">
      <span className="min-w-0 flex-1"><span className="flex items-center gap-1"><span className="truncate text-sm font-medium">{t.title}</span>{t.pinned && <Pin className="size-3 shrink-0 text-violet-600" />}</span>
        <span className="block truncate text-[11px] text-ink-3">{t.task_title ? `업무: ${t.task_title} · ` : ''}{t.turns}번 물음</span></span>
      <span className="shrink-0 text-[11px] text-ink-3">{when(t.updated_at)}</span>
    </button></li>
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="ai-dock-threads">
      <div className="relative border-b border-line p-2">
        <Search className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
        <input className={cx(inputCls, 'h-9 pl-8')} value={q} onChange={(e) => setQ(e.target.value)} placeholder="대화 검색" aria-label="AI 대화 검색" autoFocus />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && !data && <p className="p-3 text-sm text-ink-3">불러오는 중…</p>}
        {!!mine.length && <><p className="px-3 pt-2 text-[11px] font-semibold text-violet-700">{ctx.taskId ? '이 업무 관련' : '이 화면 관련'}</p><ul data-testid="ai-dock-related">{mine.map(row)}</ul></>}
        {!!rest.length && <><p className="px-3 pt-2 text-[11px] font-semibold text-ink-3">{mine.length ? '다른 대화' : '최근 대화'}</p><ul>{rest.map(row)}</ul></>}
        {data && !all.length && <p className="p-4 text-center text-sm text-ink-3">{sq ? '찾는 대화가 없습니다' : '아직 대화가 없습니다'}</p>}
      </div>
    </div>
  );
}
