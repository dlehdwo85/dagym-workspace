'use client';
import { useEffect, useRef, useState } from 'react';
import { Copy, Loader2, Mail, MessageSquare, Send, Sparkles, Trash2 } from 'lucide-react';
import { api, useApi } from './client';
import { Button, cx, inputCls, toast } from './ui';
import { KakaoSend } from './KakaoSend';

export type AssistDraft = { channel: 'email' | 'sms' | 'kakao'; subject: string; body: string; attachmentIds: string[] };
type Msg = { id: number; role: 'user' | 'assistant'; action: string; content: string; draft: AssistDraft | null; cost_krw: string | null; created_at: string };
const QUICK: [string, string][] = [['mail', '메일 초안'], ['sms', '문자 초안'], ['kakao', '카카오톡 초안'], ['summary', '요약'], ['next', '다음 할 일']];

/** V28-1 이 업무의 AI 비서 — 업무 1건 문맥(Haiku), 초안은 시안 창으로 넘겨 사람이 확인 후 보냄. 대화는 업무 × 나 단위로 남는다 */
export function TaskAssist({ taskId, onDraft }: { taskId: string; onDraft: (d: AssistDraft) => void }) {
  const hist = useApi<{ messages: Msg[] }>(`/api/tasks/${taskId}/assist`, [taskId]);
  const [busy, setBusy] = useState<string | null>(null);
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const msgs = hist.data?.messages ?? [];
  // 대화 칸 안에서만 맨 아래로(페이지 전체를 끌어내리지 않음)
  useEffect(() => { const box = end.current?.parentElement; if (box) box.scrollTop = box.scrollHeight; }, [msgs.length, busy]);
  async function run(action: string, t?: string) {
    if (busy) return;
    setBusy(action);
    try {
      const r = await api(`/api/tasks/${taskId}/assist`, { body: { action, text: t || undefined } });
      setText(''); await hist.reload();
      if (r.draft && r.draft.channel !== 'kakao' && (action === 'mail' || action === 'sms')) onDraft(r.draft);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(null); }
  }
  async function clear() {
    if (!confirm('이 업무의 AI 비서 대화를 지울까요?')) return;
    try { await api(`/api/tasks/${taskId}/assist`, { method: 'DELETE' }); hist.reload(); } catch (e: any) { toast.error(e.message); }
  }
  const copy = (s: string) => navigator.clipboard?.writeText(s).then(() => toast.ok('복사했습니다'), () => toast.error('복사하지 못했습니다'));
  return (
    <div className="space-y-2" data-testid="task-assist">
      <div className="flex flex-wrap gap-1.5">
        {QUICK.map(([k, l]) => (
          <button key={k} type="button" onClick={() => run(k)} disabled={!!busy} data-testid={`assist-${k}`}
            className="inline-flex items-center gap-1 rounded-full border border-line bg-white px-2.5 py-1 text-xs font-medium text-ink-2 hover:border-brand-600 hover:text-brand-700 disabled:opacity-50">
            {busy === k ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}{l}</button>
        ))}
        {msgs.length > 0 && <button type="button" onClick={clear} className="ml-auto rounded p-1 text-ink-3 hover:bg-slate-100" aria-label="대화 지우기"><Trash2 className="size-3.5" /></button>}
      </div>
      {msgs.length > 0 && (
        <div className="max-h-80 space-y-2 overflow-y-auto rounded-input bg-slate-50 p-2" data-testid="assist-messages">
          {msgs.map((m) => m.role === 'user' ? (
            <p key={m.id} className="ml-auto w-fit max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-brand-600 px-3 py-1.5 text-sm text-white">{m.content}</p>
          ) : (
            <div key={m.id} className="max-w-[95%] space-y-1.5 rounded-2xl rounded-bl-sm bg-white px-3 py-2 text-sm shadow-card" data-testid="assist-reply">
              {m.content && <p className="whitespace-pre-wrap">{m.content}</p>}
              {m.draft && (m.draft.subject || m.draft.body) && (
                <div className="rounded-input border border-line p-2 text-[13px]" data-testid="assist-draft">
                  {m.draft.subject && <p className="font-semibold">{m.draft.subject}</p>}
                  <p className="whitespace-pre-wrap text-ink-2">{m.draft.body}</p>
                  {m.draft.attachmentIds.length > 0 && <p className="mt-1 text-xs text-ink-3">첨부 {m.draft.attachmentIds.length}개 고름</p>}
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {m.draft.channel !== 'kakao' && <Button size="sm" variant="secondary" onClick={() => onDraft(m.draft!)} data-testid="assist-open-draft">
                      {m.draft.channel === 'sms' ? <MessageSquare /> : <Mail />}시안 창에서 열기</Button>}
                    <Button size="sm" variant="ghost" onClick={() => copy([m.draft!.subject, m.draft!.body].filter(Boolean).join('\n\n'))}><Copy />복사</Button>
                    {m.draft.channel === 'kakao' && <KakaoSend taskId={taskId} msgId={m.id} body={[m.draft.subject, m.draft.body].filter(Boolean).join('\n\n')} />}
                  </div>
                </div>
              )}
              {m.cost_krw && <p className="text-[11px] text-ink-3">약 {Math.max(1, Math.round(Number(m.cost_krw)))}원</p>}
            </div>
          ))}
          {busy && <p className="flex items-center gap-1.5 text-xs text-ink-3"><Loader2 className="size-3.5 animate-spin" />작성 중…</p>}
          <div ref={end} />
        </div>
      )}
      <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) run('ask', text.trim()); }} className="flex gap-1.5">
        <input className={cx(inputCls, 'py-1.5')} value={text} onChange={(e) => setText(e.target.value)} placeholder="예: 견적서 첨부해서 관리소장님께 회신 써줘" aria-label="이 업무의 AI 비서에게" data-testid="assist-input" />
        <Button size="sm" type="submit" disabled={!!busy || !text.trim()} aria-label="보내기"><Send /></Button>
      </form>
    </div>
  );
}
