'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Check, Loader2, MessageSquarePlus, Paperclip, Pin, Search, Send, Sparkles, Trash2, X } from 'lucide-react';
import { AI_ACCEPT } from '@/components/libraryUpload';
import { AttachChips, DEFAULT_FILE_ASK, useAiAttach } from '@/components/aiAttach';
import { DropZone } from '@/components/upload';
import { api, broadcastRefresh, useApi } from '@/components/client';
import { useSession } from '@/components/session';
import { Button, Empty, PageHeader, cx, inputCls, toast } from '@/components/ui';
import { VoiceButton } from '@/components/voice';
import { AiBudgetBar, costLine, type Budget } from '@/components/AiBudget';
import { DocJobCard } from '@/components/DocJobCard';
import { ChatComposer, MsgTools, useAiConversation, type ChatMsg } from '@/components/aiChat';

type Proposal = { id: string; kind: string; summary: string; state?: 'done' | 'cancelled' | 'busy'; link?: string; preview?: { assignees?: string[]; due?: string | null; checklist?: string[]; description?: string; files?: number; when?: string; place?: string | null; attendees?: string[]; tasks?: string[]; taskDue?: string; calendar?: string; warnings?: string[]; moves?: string[]; folder?: string } };
type Msg = Omit<ChatMsg, 'proposals'> & { proposals?: Proposal[] };
type Thread = { id: string; title: string; task_id: string | null; task_title: string | null; pinned: boolean; updated_at: string; turns: number };
const EXAMPLES = ['다짐 로고 찾아서 이 업무에 첨부해줘', '이번 주 내 마감 업무 정리해줘', '내일 3시 회의 준비 업무 만들어줘', '3분기 매출 현장별로 엑셀 만들어줘'];

/** V9 AI 비서: 자료실·업무·일정·매출을 내 권한으로 찾아 답하고, 바꾸는 일은 제안 → [확인] 후 실행 */
export default function AssistantPage() {
  const { user } = useSession();
  const sp = useSearchParams();
  const router = useRouter();
  const taskId = sp.get('task') ?? undefined;
  // V14 2번: 보관된 대화 — ?thread= 로 이어서, 업무에서 열면 그 업무의 최근 대화로
  const [threadId, setThreadId] = useState<string | null>(sp.get('thread'));
  const [tq, setTq] = useState('');
  const threads = useApi<{ threads: Thread[] }>(`/api/ai/threads?${new URLSearchParams({ ...(tq ? { q: tq } : {}) })}`, [tq]);
  const taskThreads = useApi<{ threads: Thread[] }>(taskId ? `/api/ai/threads?taskId=${taskId}` : null);
  const [listOpen, setListOpen] = useState(false);
  useEffect(() => { if (taskId && !sp.get('thread') && taskThreads.data?.threads[0] && !threadId) openThread(taskThreads.data.threads[0].id); }, [taskThreads.data]); // eslint-disable-line react-hooks/exhaustive-deps
  async function openThread(id: string | null) {
    setListOpen(false); setThreadId(id);
    router.replace(`/assistant?${new URLSearchParams({ ...(taskId ? { task: taskId } : {}), ...(id ? { thread: id } : {}) })}`);
    if (!id) { setMsgs([]); return; }
    try {
      const r = await api(`/api/ai/threads/${id}`);
      conv.cancelEdit();
      setMsgs(r.messages.map((m: any) => ({ role: m.role, text: m.status === 'stopped' && m.role === 'assistant' ? '멈춤' : m.text, stopped: m.status === 'stopped' && m.role === 'assistant', files: m.file_names?.length ? m.file_names : undefined, blocked: m.status === 'blocked', docJobs: m.doc_jobs?.length ? m.doc_jobs.map((j: any) => j.id) : undefined,
        proposals: m.proposals?.length ? m.proposals.map((p: any) => ({ id: p.id, kind: p.kind, summary: p.summary, state: p.status === 'done' ? 'done' : p.status === 'cancelled' ? 'cancelled' : undefined, link: p.result?.link })) : undefined })));
    } catch (e: any) { toast.error(e.message); setThreadId(null); }
  }
  useEffect(() => { if (threadId && !msgs.length) openThread(threadId); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function threadAct(t: Thread, what: 'rename' | 'pin' | 'delete') {
    try {
      if (what === 'delete') { if (!confirm(`"${t.title}" 대화를 지울까요?`)) return; await api(`/api/ai/threads/${t.id}`, { method: 'DELETE' }); if (threadId === t.id) openThread(null); }
      else if (what === 'pin') await api(`/api/ai/threads/${t.id}`, { method: 'PATCH', body: { pinned: !t.pinned } });
      else { const v = prompt('대화 이름', t.title); if (!v?.trim()) return; await api(`/api/ai/threads/${t.id}`, { method: 'PATCH', body: { title: v.trim() } }); }
      threads.reload();
    } catch (e: any) { toast.error(e.message); }
  }
  const status = useApi<{ enabled: boolean; model?: string; overLimit?: boolean; canSetLimit?: boolean; usage?: { costUsd?: number; limitUsd: number; requests: number }; budget?: Budget; creditMessage?: string | null }>('/api/ai/status');
  const task = useApi<{ task: { title: string } }>(taskId ? `/api/tasks/${taskId}` : null);
  const threadRef = useRef(threadId); threadRef.current = threadId;
  // V19 부록 A: 줄바꿈·멈춤·수정 (패널과 같은 동작)
  const conv = useAiConversation<Msg>({
    body: (t, fileIds) => ({ text: t, ...(threadRef.current ? { threadId: threadRef.current } : {}), taskId, ...(fileIds.length ? { fileIds } : {}) }),
    onReply: (r) => {
      if (r.threadId && r.threadId !== threadRef.current) { setThreadId(r.threadId); router.replace(`/assistant?${new URLSearchParams({ ...(taskId ? { task: taskId } : {}), thread: r.threadId })}`); }
      status.reload(); threads.reload();
    },
    toAssistant: (r) => ({ role: 'assistant', text: r.reply || '(답 없음)', proposals: r.proposals, blocked: r.blocked, docJobs: r.docJobs?.map((j: any) => j.id), costKrw: r.costKrw }),
  });
  const { msgs, setMsgs, busy } = conv;
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs, busy]);

  // V12 8번: 자료(사진·PDF·엑셀)를 붙여 요청 → 자료실 "AI 요청 첨부"에 저장하고 AI 가 내용을 읽음
  // 대표 요청(2026-10-14): 사진은 버튼·끌어 놓기·붙여넣기(Ctrl+V) 모두
  const att = useAiAttach();
  const { files, uploading, attach } = att;
  async function send(q: string) {
    const t = q.trim() || (files.length ? DEFAULT_FILE_ASK : ''); if (!t || busy || uploading) return;
    setText('');
    // 문맥(최근 20개 + 요약)은 서버가 보관된 대화에서 꺼낸다
    await conv.send(t, att.take());
  }
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const editLast = () => { const t = conv.editLast(); if (t !== null) { setText(t); requestAnimationFrame(() => inputRef.current?.focus()); } };
  const lastUserIdx = msgs.map((m) => m.role).lastIndexOf('user');
  const lastAiIdx = msgs.map((m) => (m.role === 'assistant' && !m.note ? 'a' : '')).lastIndexOf('a');
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
  async function editLimit() {
    const v = prompt('이번 달부터 적용할 AI 월 한도(달러)', String(status.data?.usage?.limitUsd ?? 30));
    if (v === null) return;
    try { await api('/api/ai/limit', { method: 'PUT', body: { monthlyUsd: Number(v) } }); status.reload(); toast.ok('한도를 바꿨습니다'); } catch (e: any) { toast.error(e.message); }
  }

  if (status.data && !status.data.enabled) return <Empty title="AI 비서가 꺼져 있습니다" icon={Sparkles}>관리자가 AI 를 설정하면 사용할 수 있습니다.</Empty>;
  const u = status.data?.usage;
  return (
    <div className="mx-auto flex max-w-5xl gap-4">
    {/* V14 2번: 대화 목록 (휴대폰은 위 "대화 목록" 버튼) */}
    <aside className={cx('w-64 shrink-0 flex-col gap-2 lg:flex', listOpen ? 'fixed inset-0 z-50 flex bg-white p-3 pt-[calc(var(--sat)+12px)]' : 'hidden')} data-testid="ai-threads">
      <div className="flex gap-1.5">
        <Button className="flex-1" onClick={() => openThread(null)} data-testid="ai-new-thread"><MessageSquarePlus />새 대화</Button>
        {listOpen && <Button variant="secondary" onClick={() => setListOpen(false)} aria-label="닫기"><X /></Button>}
      </div>
      <label className="relative"><Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" />
        <input className={cx(inputCls, 'h-8 pl-8 text-sm')} placeholder="대화 검색" value={tq} onChange={(e) => setTq(e.target.value)} aria-label="대화 검색" /></label>
      <ul className="scrollbar-thin min-h-0 flex-1 space-y-0.5 overflow-y-auto">
        {threads.data?.threads.map((t) => (
          <li key={t.id} className={cx('group flex items-center gap-1 rounded-input px-2 py-1.5 text-sm', threadId === t.id ? 'bg-brand-50 font-medium' : 'hover:bg-slate-50')}>
            <button className="min-w-0 flex-1 text-left" onClick={() => openThread(t.id)}>
              <span className="flex items-center gap-1">{t.pinned && <Pin className="size-3 shrink-0 text-amber-600" />}<span className="truncate">{t.title}</span></span>
              <span className="block truncate text-[11px] text-ink-3">{t.task_title ? `📌 ${t.task_title} · ` : ''}{t.turns}번 · {new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric' }).format(new Date(t.updated_at))}</span>
            </button>
            <span className="flex shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
              <button className="rounded p-1 text-ink-3 hover:text-ink" onClick={() => threadAct(t, 'pin')} aria-label={t.pinned ? '고정 해제' : '고정'}><Pin className="size-3.5" /></button>
              <button className="rounded p-1 text-xs text-ink-3 hover:text-ink" onClick={() => threadAct(t, 'rename')} aria-label="이름 바꾸기">✎</button>
              <button className="rounded p-1 text-ink-3 hover:text-red-600" onClick={() => threadAct(t, 'delete')} aria-label="대화 지우기"><Trash2 className="size-3.5" /></button>
            </span>
          </li>
        ))}
        {threads.data && !threads.data.threads.length && <li className="px-2 py-3 text-xs text-ink-3">{tq ? '찾는 대화가 없습니다' : '아직 대화가 없습니다'}</li>}
      </ul>
    </aside>
    <div className="flex h-[calc(100dvh-9rem)] min-w-0 flex-1 flex-col sm:h-[calc(100dvh-6rem)]">
      <PageHeader title="AI 비서" icon={Sparkles}
        sub={<>자료실·업무·일정{user.role === 'owner' || user.role === 'admin' ? '·매출' : ''}을 내 권한 안에서 찾아 답합니다. 업무 만들기·첨부·댓글은 <b>[확인]</b>을 눌러야 반영됩니다.
          {u?.costUsd !== undefined && <span className="ml-1 text-xs text-ink-3">이번 달 ${u.costUsd.toFixed(2)} / 한도 ${u.limitUsd}{status.data?.canSetLimit && <button onClick={editLimit} className="ml-1 text-brand-600 underline">한도 바꾸기</button>}</span>}</>} />
      <div className="mb-2"><AiBudgetBar budget={status.data?.budget} creditMessage={status.data?.creditMessage} onChanged={status.reload} /></div>
      <div className="mb-2 flex items-center gap-2 lg:hidden">
        <Button size="sm" variant="secondary" onClick={() => setListOpen(true)} data-testid="ai-threads-open">대화 목록</Button>
        <Button size="sm" variant="ghost" onClick={() => openThread(null)}><MessageSquarePlus />새 대화</Button>
      </div>
      {taskId && (taskThreads.data?.threads.length ?? 0) > 0 && <p className="mb-1 text-xs text-ink-3" data-testid="task-thread-count">이 업무 대화 {taskThreads.data!.threads.length}개</p>}
      {taskId && task.data && <div className="mb-2 rounded-input bg-brand-50 px-3 py-1.5 text-sm text-brand-800">이 업무 기준: <Link href={`/tasks/${taskId}`} className="font-semibold underline">{task.data.task.title}</Link></div>}
      <DropZone onFiles={(f) => attach(f)} disabled={att.full || !!uploading} label="여기에 놓으면 AI 요청에 첨부됩니다 (최대 5개)" className="flex min-h-0 flex-1 flex-col" testid="ai-drop">
      <div className="scrollbar-thin flex-1 space-y-3 overflow-y-auto rounded-card border border-line bg-white p-3 shadow-card" data-testid="ai-chat">
        {!msgs.length && (
          <div className="space-y-2 p-2">
            <p className="text-sm text-ink-2">이렇게 말해 보세요</p>
            <div className="flex flex-wrap gap-1.5">{EXAMPLES.map((e) => <button key={e} onClick={() => send(e)} className="rounded-full border border-line px-3 py-1 text-sm text-ink-2 hover:bg-slate-50">{e}</button>)}</div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={cx('flex flex-col', m.role === 'user' ? 'items-end' : 'items-start')}>
            {m.stopped ? <div className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-ink-3" data-testid="ai-stopped">■ 멈춤</div>
            : m.note ? <div className="rounded-input bg-green-50 px-2.5 py-1 text-xs text-green-800" data-testid="ai-kept">✓ {m.text}</div> : <>
            <div className={cx('max-w-[88%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm', m.role === 'user' ? 'bg-brand-600 text-white' : m.error ? 'bg-red-50 text-red-700' : m.blocked ? 'bg-amber-50 text-amber-900' : 'bg-slate-100 text-ink')} data-testid={m.blocked ? 'ai-blocked' : m.role === 'user' ? 'ai-user-msg' : 'ai-answer'}>
              {m.files?.length ? <div className="mb-1 text-xs opacity-80">📎 {m.files.join(', ')}</div> : null}
              {m.text}
              {!!m.proposals?.length && (
                <div className="mt-2 space-y-1.5">
                  {m.proposals.map((p) => (
                    <div key={p.id} className="rounded-input border border-amber-200 bg-white p-2 text-ink" data-testid="ai-proposal">
                      <div className="text-xs font-semibold text-amber-700">✨ AI 제안</div>
                      <div className="text-sm">{p.summary}</div>
                      {p.preview && (
                        <div className="mt-1 space-y-1 text-xs text-ink-2" data-testid="ai-proposal-preview">
                          {p.preview.assignees && <div>담당: {p.preview.assignees.join(', ')} (각자 1건){p.preview.due && ` · 마감 ${p.preview.due}`}{p.preview.files ? ` · 📎 ${p.preview.files}개 첨부` : ''}</div>}
                          {!!p.preview.checklist?.length && <details><summary className="cursor-pointer">체크리스트 {p.preview.checklist.length}개</summary><ul className="ml-4 list-disc">{p.preview.checklist.map((c, k) => <li key={k}>{c}</li>)}</ul></details>}
                          {p.preview.description && <p className="line-clamp-3 whitespace-pre-wrap rounded bg-slate-50 p-1.5">{p.preview.description}</p>}
                          {p.preview.when && <div data-testid="ai-event-preview">🗓 {p.preview.when}{p.preview.place && ` · 📍 ${p.preview.place}`}{p.preview.calendar && ` · ${p.preview.calendar}`}{!!p.preview.attendees?.length && <div>참석: {p.preview.attendees.join(', ')}</div>}{!!p.preview.tasks?.length && <div data-testid="ai-event-tasks">연결 업무: {p.preview.tasks.join(', ')} · 마감 {p.preview.taskDue} (일정과 날짜 연동)</div>}</div>}
                          {!!p.preview.moves?.length && <ul className="ml-4 list-disc" data-testid="ai-organize-preview">{p.preview.moves.map((x, k) => <li key={k}>{x}</li>)}</ul>}
                          {p.preview.folder && <div>📁 저장 폴더: {p.preview.folder}</div>}
                          {!!p.preview.warnings?.length && <ul className="rounded bg-amber-50 p-1.5 text-amber-800" data-testid="ai-event-warnings">{p.preview.warnings.map((w, k) => <li key={k}>⚠ {w}</li>)}</ul>}
                        </div>
                      )}
                      {p.state === 'done' ? <div className="mt-1 text-xs text-green-700">✓ 반영됨 {p.link && <Link href={p.link} className="underline">열기</Link>}</div>
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
            {m.docJobs?.map((id) => <DocJobCard key={id} id={id} onRefine={(t) => { setText(t); inputRef.current?.focus(); }} />)}
            {!m.error && <MsgTools text={m.text} right={m.role === 'user'} onEdit={i === lastUserIdx ? editLast : undefined} onRegenerate={i === lastAiIdx && i > lastUserIdx && !m.blocked ? conv.regenerate : undefined} />}
            {m.role === 'assistant' && costLine(m.costKrw) && <span className="mt-0.5 text-[10.5px] text-ink-3" data-testid="ai-cost">{costLine(m.costKrw)}</span>}
            </>}
          </div>
        ))}
        {busy && <div className="flex items-center gap-2 text-sm text-ink-3"><Loader2 className="size-4 animate-spin" />찾아보는 중…</div>}
        <div ref={end} />
      </div>
      </DropZone>
      <AttachChips files={files} uploading={uploading} onRemove={att.remove} />
      <input ref={att.inputRef} type="file" multiple accept={AI_ACCEPT} className="hidden" onChange={(e) => attach(e.target.files)} data-testid="ai-file-input" />
      <div className="mt-2">
        <ChatComposer value={text} onChange={setText} onSend={() => send(text)} onStop={() => conv.stop()} busy={busy} canSend={!uploading && (!!text.trim() || files.length > 0)} inputRef={inputRef}
          onPaste={att.onPaste} ariaLabel="AI 에게 요청" disabled={status.data?.overLimit} placeholder={status.data?.overLimit ? '이번 달 한도에 도달했습니다' : 'AI에게 요청 · 사진은 붙여넣기(Ctrl+V)도 됩니다'}
          leading={<Button type="button" variant="secondary" onClick={() => att.inputRef.current?.click()} aria-label="자료 첨부 (사진·PDF·엑셀)" disabled={att.full || !!uploading}><Paperclip /></Button>}
          trailing={<VoiceButton value={text} onChange={setText} label="음성으로 요청" />} />
      </div>
      {/* V14 6번: 직원 고지 (상시) */}
      <p className="mt-1.5 text-center text-[11px] text-ink-3" data-testid="ai-notice">회사 업무용 AI 입니다. 대화는 보관되며 권한이 있는 관리자가 사용 내역을 볼 수 있습니다. 업무와 무관한 요청은 처리하지 않습니다.</p>
    </div>
    </div>
  );
}
