'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Check, Loader2, Maximize2, Send, Sparkles, X } from 'lucide-react';
import { api, broadcastRefresh } from './client';
import { Button, cx, inputCls, toast } from './ui';

type Ctx = { page: 'home' | 'tasks' | 'task' | 'calendar' | 'library' | 'revenue' | 'reports' | 'messages' | 'other'; id?: string; taskId?: string };
type P = { id: string; summary: string; state?: 'done' | 'cancelled' | 'busy'; link?: string };
type M = { role: 'user' | 'assistant'; text: string; proposals?: P[]; error?: boolean; blocked?: boolean };

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
  calendar: ['이 날 일정과 마감 업무 정리해줘', '이번 주 회의 준비 업무 만들어줘', '비어 있는 시간 알려줘'],
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
  const end = useRef<HTMLDivElement>(null);
  // 다른 업무·화면으로 가면 새 대화 (맥락이 섞이지 않게)
  const key = `${ctx.page}:${ctx.id ?? ''}:${ctx.taskId ?? ''}`;
  useEffect(() => { setMsgs([]); setThreadId(null); }, [key]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs, busy]);
  if (path.startsWith('/assistant')) return null;

  async function send(q: string) {
    const t = q.trim(); if (!t || busy) return;
    setMsgs((m) => [...m, { role: 'user', text: t }]); setText(''); setBusy(true);
    try {
      const r = await api('/api/ai/chat', { body: { text: t, ...(threadId ? { threadId } : {}), ...(ctx.taskId ? { taskId: ctx.taskId } : { context: { page: ctx.page, ...(ctx.id ? { id: ctx.id } : {}) } }) } });
      setThreadId(r.threadId ?? threadId);
      setMsgs((m) => [...m, { role: 'assistant', text: r.reply || '(답 없음)', proposals: r.proposals, blocked: r.blocked }]);
    } catch (e: any) { setMsgs((m) => [...m, { role: 'assistant', text: e.message, error: true }]); } finally { setBusy(false); }
  }
  async function decide(mi: number, p: P, accept: boolean) {
    const set = (patch: Partial<P>) => setMsgs((m) => m.map((x, i) => (i === mi ? { ...x, proposals: x.proposals!.map((y) => (y.id === p.id ? { ...y, ...patch } : y)) } : x)));
    set({ state: 'busy' });
    try { const r = await api(`/api/ai/proposals/${p.id}`, { body: { accept } }); set({ state: accept ? 'done' : 'cancelled', link: r.link }); if (accept) { toast.ok('반영했습니다'); broadcastRefresh(); } }
    catch (e: any) { set({ state: undefined }); toast.error(e.message); }
  }
  return (
    <>
      {!open && (
        <button onClick={() => onOpenChange(true)} aria-label="AI 비서 열기" data-testid="ai-dock-open"
          className="fixed bottom-6 right-6 z-40 hidden size-12 items-center justify-center rounded-full bg-violet-600 text-white shadow-pop hover:bg-violet-700 sm:flex"><Sparkles className="size-6" /></button>
      )}
      {open && (
        <div className="fixed inset-0 z-50 bg-slate-900/30 sm:inset-auto sm:bottom-6 sm:right-6 sm:bg-transparent" onClick={() => onOpenChange(false)}>
          <section role="dialog" aria-label="AI 비서" onClick={(e) => e.stopPropagation()} data-testid="ai-dock"
            className="absolute inset-x-0 bottom-0 flex h-[78dvh] flex-col rounded-t-2xl bg-white pb-[var(--sab)] shadow-pop sm:static sm:h-[560px] sm:w-[380px] sm:rounded-card sm:border sm:border-line sm:pb-0">
            <header className="flex items-center gap-2 border-b border-line px-3 py-2">
              <Sparkles className="size-4 text-violet-600" /><span className="flex-1 text-sm font-semibold">AI 비서</span>
              <Link href={`/assistant?${new URLSearchParams({ ...(threadId ? { thread: threadId } : {}), ...(ctx.taskId ? { task: ctx.taskId } : {}) })}`} onClick={() => onOpenChange(false)}
                className="inline-flex size-8 items-center justify-center rounded-input text-ink-2 hover:bg-slate-100" aria-label="전체 화면으로"><Maximize2 className="size-4" /></Link>
              <button onClick={() => onOpenChange(false)} className="inline-flex size-8 items-center justify-center rounded-input text-ink-2 hover:bg-slate-100" aria-label="닫기"><X className="size-4" /></button>
            </header>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3" data-testid="ai-dock-chat">
              {!msgs.length && (
                <div className="space-y-1.5">
                  <p className="text-xs text-ink-3">이 화면에 맞춰 물어보세요</p>
                  {SUGGEST[ctx.page].map((s) => <button key={s} onClick={() => send(s)} className="block w-full rounded-input border border-line px-3 py-2 text-left text-sm hover:bg-slate-50" data-testid="ai-dock-suggest">{s}</button>)}
                </div>
              )}
              {msgs.map((m, i) => (
                <div key={i} className={cx('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                  <div className={cx('max-w-[90%] whitespace-pre-wrap rounded-2xl px-3 py-1.5 text-sm', m.role === 'user' ? 'bg-brand-600 text-white' : m.error ? 'bg-red-50 text-red-700' : m.blocked ? 'bg-amber-50 text-amber-900' : 'bg-slate-100 text-ink')}>
                    {m.text}
                    {m.proposals?.map((p) => (
                      <div key={p.id} className="mt-1.5 rounded-input border border-amber-200 bg-white p-2 text-ink">
                        <div className="text-xs font-semibold text-amber-700">✨ AI 제안</div><div className="text-sm">{p.summary}</div>
                        {p.state === 'done' ? <div className="mt-1 text-xs text-emerald-700">✓ 반영됨 {p.link && <Link href={p.link} className="underline">열기</Link>}</div>
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
            <form onSubmit={(e) => { e.preventDefault(); send(text); }} className="flex items-end gap-1.5 border-t border-line p-2">
              <textarea rows={1} className={cx(inputCls, 'max-h-28 min-h-9 resize-none py-1.5')} value={text} onChange={(e) => setText(e.target.value)} placeholder="AI 에게 요청하기" aria-label="AI 에게 요청 (화면 맥락)"
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(text); } }} />
              <Button type="submit" disabled={busy || !text.trim()} aria-label="보내기"><Send /></Button>
            </form>
            <p className="px-3 pb-1.5 text-[10px] text-ink-3">회사 업무용 · 관리자가 사용 내역을 볼 수 있습니다</p>
          </section>
        </div>
      )}
    </>
  );
}
