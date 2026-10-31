'use client';
import { showTask } from './TaskPanelHost';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Mic, RotateCcw } from 'lucide-react';
import { parseTaskText } from '@/lib/nlparse';
import { VoiceChoice, correctVoice, learnVoice, listen, voiceAvailable, voiceErrorToast, type VoiceFix } from './voice';
import { api, broadcastRefresh, useApi } from './client';
import { useSession } from './session';
import { AssigneePicker, DuePicker, PriorityPicker, RepeatChip, markNew, warnAway } from './TaskQuick';
import { Button, Modal, cx, inputCls, toast, todayStr } from './ui';

const EXAMPLES = ['내일 오후 3시까지 견적서 보내기', '금요일까지 김민수 두정점 원판 수량 파악, 중요', '매주 월요일 오전 10시 주간 회의 자료 준비'];
type Card = { title: string; dueDate: string | null; dueTime: string | null; assigneeId: string | null; requestedById: string | null; priority: string; rrule: string | null };

function Row({ label, children, bad }: { label: string; children: React.ReactNode; bad?: boolean }) {
  return (
    <div className={cx('flex min-h-12 items-center gap-3 border-b border-line py-1.5 last:border-b-0', bad && 'bg-red-50/60')}>
      <span className={cx('w-16 shrink-0 text-sm', bad ? 'font-semibold text-red-600' : 'text-ink-2')}>{label}{bad && ' *'}</span><span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

/** 다른 화면에서 열기: window.dispatchEvent(new Event('wos-voice-add')) */
export const openVoiceAdd = () => window.dispatchEvent(new Event('wos-voice-add'));

/**
 * V11 5번·V24 "음성 등록": 말하기 가이드 → 실시간 글자 → 회사 단어장 보정(고친 말 밑줄·되돌리기) → 인식 결과 카드(빠진 필수 항목 빨간 표시) → 고쳐서 저장.
 * 앱은 휴대폰 음성 인식, 웹은 브라우저 음성 인식(voice.tsx). 마이크를 못 쓰면 키보드 음성 입력으로 같은 카드를 만든다.
 */
export function VoiceAddTask() {
  const { user, dir } = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const [card, setCard] = useState<Card | null>(null);
  const [busy, setBusy] = useState(false);
  const [fixes, setFixes] = useState<VoiceFix[]>([]);
  const [fixing, setFixing] = useState(false);
  const [ask, setAsk] = useState(false); // #541 이미 말한 내용이 있으면 [이어서 녹음]·[처음부터(초기화)]
  const stop = useRef<() => void>(() => {});
  const projects = useApi<{ projects: { id: string; name: string }[] }>(open ? '/api/projects' : null);
  useEffect(() => { const h = () => { setOpen(true); setText(''); setCard(null); setFixes([]); }; window.addEventListener('wos-voice-add', h); return () => window.removeEventListener('wos-voice-add', h); }, []);
  const close = () => { stop.current(); setListening(false); setOpen(false); };

  function recognize(t: string) {
    const p = parseTaskText(t, dir.users, todayStr(), projects.data?.projects ?? []);
    setCard({ title: t.trim() ? p.title : '', dueDate: p.dueDate, dueTime: p.dueTime, assigneeId: p.assigneeId ?? user.id, requestedById: user.id, priority: p.priority ?? 'normal', rrule: p.rrule });
  }
  /** 대표 실기기(10/16): 말더듬·반복·지시 문구가 업무명에 그대로 → AI 로 업무명·담당·마감 정리(없거나 실패하면 규칙 결과 그대로) */
  async function tidy(t: string) {
    if (t.replace(/\s/g, '').length < 12) return; // 짧은 말은 규칙으로 충분
    setFixing(true);
    try {
      const r = await api<{ ok: boolean; title?: string; assigneeId?: string | null; dueDate?: string | null; dueTime?: string | null }>('/api/voice/structure', { body: { text: t } });
      if (r.ok) setCard((c) => c && { ...c, title: r.title || c.title, assigneeId: r.assigneeId ?? c.assigneeId, dueDate: c.dueDate ?? r.dueDate ?? null, dueTime: c.dueTime ?? r.dueTime ?? null });
    } catch { /* 규칙 결과 그대로 */ } finally { setFixing(false); }
  }
  function start(fresh = true) {
    setAsk(false);
    if (!voiceAvailable()) { voiceErrorToast('unsupported'); return; }
    const base = fresh ? '' : text.trim();
    const join = (t: string) => (base && t ? `${base} ${t}` : base || t);
    if (fresh) { setText(''); setFixes([]); }
    setListening(true);
    stop.current = listen({ onPartial: (t) => setText(join(t)), onEnd: async (r, err) => {
      setListening(false);
      if (!r) { setText(base); voiceErrorToast(err); return; }
      setText(join(r.text)); setFixing(true);
      const c = await correctVoice(r); // 회사 단어장(사람·현장·프로젝트·자주 쓰는 말)으로 보정
      const all = join(c.text);
      setFixing(false); setText(all); setFixes((f) => (fresh ? c.fixes : [...f, ...c.fixes]));
      if (all.trim()) { recognize(all); tidy(all); }
    } });
  }
  /** 고친 말 되돌리기 → 다시 인식, 다음부터 이 보정은 쓰지 않음 */
  function undoFix(f: VoiceFix) {
    const t = text.replace(f.to, f.from);
    setText(t); setFixes((x) => x.filter((y) => y !== f)); learnVoice([f], false); recognize(t);
  }
  async function save() {
    if (!card || !card.title.trim() || !card.dueDate) return;
    setBusy(true);
    try {
      const r = await api('/api/tasks', { body: { title: card.title.trim(), dueDate: card.dueDate, dueTime: card.dueTime, assigneeId: card.assigneeId, requestedById: user.id,
        priority: card.priority, recurrenceRule: card.rrule, approvalRequired: false } });
      if (fixes.length) learnVoice(fixes, true); // 받아들인 보정은 다음부터 바로 적용
      markNew(r.id); broadcastRefresh(); close();
      toast.ok(`업무를 등록했습니다: ${card.title.trim()}`, { label: '보기', run: () => showTask(r.id, (h) => router.push(h)) });
      if (card.assigneeId && card.assigneeId !== user.id) warnAway(card.assigneeId, card.dueDate, dir.users.find((u) => u.id === card.assigneeId)?.name ?? '담당자');
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  const missing = (_k: string) => <span className="text-xs font-semibold leading-snug text-red-600">말씀하지 않으셨어요 — 위 버튼을 눌러 고르세요</span>;
  const set = <K extends keyof Card>(k: K) => (v: Card[K]) => setCard((c) => (c ? { ...c, [k]: v } : c));
  return (
    <Modal open={open} onClose={close} title="음성으로 업무 등록">
      {!card ? (
        <div className="space-y-4" data-testid="voice-guide">
          <p className="text-lg font-semibold leading-snug"><b className="text-brand-700">업무 내용</b>과 <b className="text-brand-700">마감(언제까지)</b>을 말씀해 주세요.<span className="mt-1 block text-sm font-normal text-ink-2">담당자·우선순위·반복은 말해도 되고 안 해도 됩니다.</span></p>
          <ul className="space-y-1.5 text-sm text-ink-2">{EXAMPLES.map((e) => <li key={e} className="rounded-input bg-slate-50 px-3 py-2">“{e}”</li>)}</ul>
          <div className="flex flex-col items-center gap-2 py-2">
            <button type="button" onClick={listening ? () => stop.current() : () => (text.trim() ? setAsk(!ask) : start())} aria-label={listening ? '듣기 멈추기' : '말하기 시작'} aria-pressed={listening} aria-haspopup="menu" aria-expanded={ask} data-testid="voice-start"
              className={cx('flex size-20 items-center justify-center rounded-full text-white shadow-pop', listening ? 'animate-pulse bg-red-500' : 'bg-brand-600 active:scale-95')}><Mic className="size-9" /></button>
            {ask && <VoiceChoice onPick={start} onClose={() => setAsk(false)} />}
            <span className="text-sm text-ink-2" data-testid="voice-state">{listening ? '듣고 있어요… 말을 마치면 자동으로 정리합니다 (최대 60초)' : fixing ? '업무명·담당자·마감 정리하는 중…' : '눌러서 말하기 · 조용히 또박또박 말해도 됩니다'}</span>
          </div>
          <label className="block text-sm text-ink-2">말한 내용 (키보드 🎤 음성 입력이나 글로도 됩니다)
            <textarea className={cx(inputCls, 'mt-1 min-h-[72px] text-base')} value={text} onChange={(e) => setText(e.target.value)} placeholder="예: 내일 오후 3시까지 견적서 보내기" aria-label="말한 내용" data-testid="voice-text" />
          </label>
          <Button className="h-12 w-full text-base" onClick={() => recognize(text)} disabled={!text.trim()} data-testid="voice-recognize">인식 결과 보기</Button>
        </div>
      ) : (
        <div className="space-y-3" data-testid="voice-card">
          <p className="text-sm text-ink-2">들은 내용: “{text}”</p>
          {fixes.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs" data-testid="voice-fixes">
              <span className="text-ink-3">단어장으로 고침</span>
              {fixes.map((f, k) => (
                <button key={k} type="button" onClick={() => undoFix(f)} className="rounded-full border border-brand-200 bg-brand-50 px-2 py-0.5 text-brand-800" title="눌러서 되돌리기" data-testid="voice-fix">
                  <s className="text-ink-3">{f.from}</s> → <u className="decoration-brand-500 decoration-2 underline-offset-2">{f.to}</u> ↺
                </button>
              ))}
            </div>
          )}
          <div className="rounded-card border border-line px-3">
            <Row label="업무명" bad={!card.title.trim()}>
              <input className={cx(inputCls, 'h-10 text-base', !card.title.trim() && 'border-red-400')} value={card.title} onChange={(e) => set('title')(e.target.value)} placeholder="말씀하지 않으셨어요 — 눌러서 입력" aria-label="인식한 업무명" />
            </Row>
            <Row label="마감" bad={!card.dueDate}>
              {/* 대표 실기기: "선택"이 세로로 꺾이고 오른쪽 안내가 따로 놀았음 → 버튼은 한 줄 고정, 안내는 버튼 아래 한 줄 왼쪽 맞춤 */}
              <span className="flex flex-col items-start gap-1" data-testid="voice-due-row">
                <span className="shrink-0 whitespace-nowrap [&_*]:whitespace-nowrap"><DuePicker value={card.dueDate} onChange={set('dueDate')} time={card.dueTime} onTime={set('dueTime')} label="인식한 마감" emptyText="날짜 선택" /></span>
                {!card.dueDate && missing('마감')}
              </span>
            </Row>
            <Row label="담당자"><AssigneePicker value={card.assigneeId} onChange={set('assigneeId')} withName size={22} /></Row>
            <Row label="우선순위"><PriorityPicker value={card.priority} onChange={set('priority')} label="인식한 우선순위" /></Row>
            <Row label="반복"><RepeatChip value={card.rrule} anchorDate={card.dueDate} onChange={set('rrule')} /></Row>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" className="h-12" onClick={() => setCard(null)}><RotateCcw />다시 말하기</Button>
            <Button className="h-12 flex-1 text-base" onClick={save} disabled={busy || !card.title.trim() || !card.dueDate} data-testid="voice-save">{!card.title.trim() || !card.dueDate ? '빨간 항목을 채워 주세요' : '이대로 등록'}</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
