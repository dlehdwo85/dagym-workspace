'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Check, Loader2, Mic, Send, Sparkles, X } from 'lucide-react';
import { api, broadcastRefresh, useApi } from '@/components/client';
import { useSession } from '@/components/session';
import { Button, Empty, PageHeader, cx, inputCls, toast } from '@/components/ui';
import { listenOnce, speechSupported } from '@/lib/nlparse';

type Proposal = { id: string; kind: string; summary: string; state?: 'done' | 'cancelled' | 'busy'; link?: string };
type Msg = { role: 'user' | 'assistant'; text: string; proposals?: Proposal[]; error?: boolean };
const EXAMPLES = ['다짐 로고 찾아서 이 업무에 첨부해줘', '이번 주 내 마감 업무 정리해줘', '내일 3시 회의 준비 업무 만들어줘', '3분기 매출 현장별로 엑셀 만들어줘'];

/** V9 AI 비서: 자료실·업무·일정·매출을 내 권한으로 찾아 답하고, 바꾸는 일은 제안 → [확인] 후 실행 */
export default function AssistantPage() {
  const { user } = useSession();
  const sp = useSearchParams();
  const taskId = sp.get('task') ?? undefined;
  const status = useApi<{ enabled: boolean; model?: string; overLimit?: boolean; canSetLimit?: boolean; usage?: { costUsd?: number; limitUsd: number; requests: number } }>('/api/ai/status');
  const task = useApi<{ task: { title: string } }>(taskId ? `/api/tasks/${taskId}` : null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs, busy]);

  async function send(q: string) {
    const t = q.trim(); if (!t || busy) return;
    const next: Msg[] = [...msgs, { role: 'user', text: t }];
    setMsgs(next); setText(''); setBusy(true);
    try {
      const history = next.filter((m) => !m.error).slice(-20).map((m) => ({ role: m.role, text: m.text + (m.proposals?.length ? `\n(제안: ${m.proposals.map((p) => `${p.summary} [${p.state === 'done' ? '실행됨' : p.state === 'cancelled' ? '취소됨' : '대기'}]`).join('; ')})` : '') }));
      const r = await api('/api/ai/chat', { body: { messages: history, taskId } });
      setMsgs((m) => [...m, { role: 'assistant', text: r.reply || '(답 없음)', proposals: r.proposals }]);
      status.reload();
    } catch (e: any) {
      setMsgs((m) => [...m, { role: 'assistant', text: e.message, error: true }]);
    } finally { setBusy(false); }
  }
  useEffect(() => {
    const q0 = sp.get('q');
    if (q0 && !started.current && status.data?.enabled) { started.current = true; send(q0); }
  }, [status.data?.enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  async function decide(mi: number, p: Proposal, accept: boolean) {
    const set = (patch: Partial<Proposal>) => setMsgs((m) => m.map((x, i) => (i === mi ? { ...x, proposals: x.proposals!.map((y) => (y.id === p.id ? { ...y, ...patch } : y)) } : x)));
    set({ state: 'busy' });
    try {
      const r = await api(`/api/ai/proposals/${p.id}`, { body: { accept } });
      set({ state: accept ? 'done' : 'cancelled', link: r.link });
      if (accept) { toast.ok('반영했습니다'); broadcastRefresh(); }
    } catch (e: any) { set({ state: undefined }); toast.error(e.message); }
  }
  function voice() {
    setListening(true);
    listenOnce((t) => setText((x) => (x ? x + ' ' : '') + t), (err) => { setListening(false); if (err && err !== 'no-speech' && err !== 'aborted') toast.error('음성을 듣지 못했습니다. 키보드의 🎤 로 말해 보세요.'); });
  }
  async function editLimit() {
    const v = prompt('이번 달부터 적용할 AI 월 한도(달러)', String(status.data?.usage?.limitUsd ?? 30));
    if (v === null) return;
    try { await api('/api/ai/limit', { method: 'PUT', body: { monthlyUsd: Number(v) } }); status.reload(); toast.ok('한도를 바꿨습니다'); } catch (e: any) { toast.error(e.message); }
  }

  if (status.data && !status.data.enabled) return <Empty title="AI 비서가 꺼져 있습니다" icon={Sparkles}>관리자가 AI 를 설정하면 사용할 수 있습니다.</Empty>;
  const u = status.data?.usage;
  return (
    <div className="mx-auto flex h-[calc(100dvh-9rem)] max-w-3xl flex-col sm:h-[calc(100dvh-6rem)]">
      <PageHeader title="AI 비서" icon={Sparkles}
        sub={<>자료실·업무·일정{user.role === 'owner' || user.role === 'admin' ? '·매출' : ''}을 내 권한 안에서 찾아 답합니다. 업무 만들기·첨부·댓글은 <b>[확인]</b>을 눌러야 반영됩니다.
          {u?.costUsd !== undefined && <span className="ml-1 text-xs text-ink-3">이번 달 ${u.costUsd.toFixed(2)} / 한도 ${u.limitUsd}{status.data?.canSetLimit && <button onClick={editLimit} className="ml-1 text-brand-600 underline">한도 바꾸기</button>}</span>}</>} />
      {taskId && task.data && <div className="mb-2 rounded-input bg-brand-50 px-3 py-1.5 text-sm text-brand-800">이 업무 기준: <Link href={`/tasks/${taskId}`} className="font-semibold underline">{task.data.task.title}</Link></div>}
      <div className="scrollbar-thin flex-1 space-y-3 overflow-y-auto rounded-card border border-line bg-white p-3 shadow-card" data-testid="ai-chat">
        {!msgs.length && (
          <div className="space-y-2 p-2">
            <p className="text-sm text-ink-2">이렇게 말해 보세요</p>
            <div className="flex flex-wrap gap-1.5">{EXAMPLES.map((e) => <button key={e} onClick={() => send(e)} className="rounded-full border border-line px-3 py-1 text-sm text-ink-2 hover:bg-slate-50">{e}</button>)}</div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={cx('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
            <div className={cx('max-w-[88%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm', m.role === 'user' ? 'bg-brand-600 text-white' : m.error ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-ink')}>
              {m.text}
              {!!m.proposals?.length && (
                <div className="mt-2 space-y-1.5">
                  {m.proposals.map((p) => (
                    <div key={p.id} className="rounded-input border border-amber-200 bg-white p-2 text-ink" data-testid="ai-proposal">
                      <div className="text-xs font-semibold text-amber-700">✨ AI 제안</div>
                      <div className="text-sm">{p.summary}</div>
                      {p.state === 'done' ? <div className="mt-1 text-xs text-emerald-700">✓ 반영됨 {p.link && <Link href={p.link} className="underline">열기</Link>}</div>
                        : p.state === 'cancelled' ? <div className="mt-1 text-xs text-ink-3">취소함</div> : (
                          <div className="mt-1.5 flex gap-1.5">
                            <Button size="sm" onClick={() => decide(i, p, true)} disabled={p.state === 'busy'}><Check />확인</Button>
                            <Button size="sm" variant="secondary" onClick={() => decide(i, p, false)} disabled={p.state === 'busy'}><X />취소</Button>
                          </div>
                        )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && <div className="flex items-center gap-2 text-sm text-ink-3"><Loader2 className="size-4 animate-spin" />찾아보는 중…</div>}
        <div ref={end} />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); send(text); }} className="mt-2 flex items-end gap-2">
        <textarea className={cx(inputCls, 'max-h-32 min-h-[42px] flex-1 resize-none')} rows={1} value={text} onChange={(e) => setText(e.target.value)} placeholder={status.data?.overLimit ? '이번 달 한도에 도달했습니다' : 'AI 에게 요청하기'}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(text); } }} aria-label="AI 에게 요청" disabled={status.data?.overLimit} />
        {speechSupported() && <Button type="button" variant="secondary" onClick={voice} aria-label="말로 요청" disabled={listening}>{listening ? <Loader2 className="animate-spin" /> : <Mic />}</Button>}
        <Button type="submit" disabled={busy || !text.trim()} aria-label="보내기"><Send /></Button>
      </form>
    </div>
  );
}
