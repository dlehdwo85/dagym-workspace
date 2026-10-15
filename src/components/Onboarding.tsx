'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BellRing, Check, Smartphone } from 'lucide-react';
import { api, broadcastRefresh } from './client';
import { enableNativePush, isNativeApp, subscribeWebPush } from './native';
import { useSession } from './session';
import { Button, Field, Modal, cx, inputCls, toast } from './ui';

const seoul = (n: number) => { const d = new Date(Date.now() + n * 86400000); return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d); };

/** V15 첫 로그인 3단계: ① 이름·직책 ② 첫 업무(예시 3개) ③ 휴대폰 앱·알림 켜기 */
export function Onboarding() {
  const s = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const [step, setStep] = useState(0);
  const [name, setName] = useState(s.user.name);
  const [title, setTitle] = useState('');
  const [tasks, setTasks] = useState([
    { title: '이번 주 할 일 정리하기', due: seoul(0), on: true },
    { title: s.tenant?.personal ? '자주 하는 일 반복 업무로 만들기' : '팀원 초대하기', due: seoul(1), on: true },
    { title: '내일 3시 회의 준비', due: seoul(1), on: true },
  ]);
  const [busy, setBusy] = useState(false);
  async function finish() { try { await api('/api/onboarding', { body: { done: true } }); } catch {} setOpen(false); router.refresh(); }
  async function next() {
    setBusy(true);
    try {
      if (step === 0) await api('/api/onboarding', { body: { name, title } });
      if (step === 1) {
        const unit = s.dir.orgUnits[0]?.id;
        for (const t of tasks.filter((x) => x.on && x.title.trim())) await api('/api/tasks', { body: { title: t.title.trim(), orgUnitId: unit, dueDate: t.due } });
        broadcastRefresh();
      }
      setStep(step + 1);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  async function push() {
    try { if (isNativeApp()) await enableNativePush(); else await subscribeWebPush(); toast.ok('이 기기에서 알림을 받습니다'); } catch (e: any) { toast.error(e.message); }
  }
  return (
    <Modal open={open} onClose={finish} title={['반갑습니다! 프로필부터', '첫 업무를 만들어 볼까요', '알림 켜기'][step] ?? ''}>
      <div className="space-y-4" data-testid="onboarding">
        <ol className="flex gap-1.5" aria-label="단계">{[0, 1, 2].map((i) => <li key={i} className={cx('h-1.5 flex-1 rounded-full', i <= step ? 'bg-brand-600' : 'bg-slate-200')} />)}</ol>
        {step === 0 && <>
          <Field label="이름"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} aria-label="이름" /></Field>
          <Field label="직책 (선택)"><input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 팀장, 프리랜서" aria-label="직책" /></Field>
        </>}
        {step === 1 && <>
          <p className="text-sm text-ink-2">예시를 고쳐 쓰거나 빼도 됩니다. 나중에 화면 위 “+” 나 음성 등록으로도 만들 수 있어요.</p>
          <ul className="space-y-2">{tasks.map((t, i) => (
            <li key={i} className="flex items-center gap-2">
              <input type="checkbox" checked={t.on} onChange={(e) => setTasks(tasks.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))} aria-label={`예시 ${i + 1} 사용`} />
              <input className={cx(inputCls, 'h-9 flex-1')} value={t.title} onChange={(e) => setTasks(tasks.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} aria-label={`예시 업무 ${i + 1}`} />
              <input type="date" className={cx(inputCls, 'h-9 w-36')} value={t.due} onChange={(e) => setTasks(tasks.map((x, j) => (j === i ? { ...x, due: e.target.value } : x)))} aria-label={`마감 ${i + 1}`} />
            </li>))}</ul>
        </>}
        {step === 2 && <>
          <p className="text-sm text-ink-2">마감·회의 시간에 맞춰 알림을 보내 드립니다.</p>
          <Button onClick={push} variant="secondary" className="w-full" data-testid="onboarding-push"><BellRing />이 기기에서 알림 켜기</Button>
          {!isNativeApp() && <p className="flex items-start gap-2 rounded-input bg-slate-50 p-3 text-sm text-ink-2"><Smartphone className="mt-0.5 size-4 shrink-0" />휴대폰에서는 워크인 앱(Android·iOS)을 설치하고 같은 계정으로 로그인하면 앱 알림을 받을 수 있습니다.</p>}
        </>}
        <div className="flex justify-between gap-2">
          <Button variant="ghost" onClick={finish}>건너뛰기</Button>
          {step < 2 ? <Button onClick={next} disabled={busy} data-testid="onboarding-next">다음</Button> : <Button onClick={finish} data-testid="onboarding-done"><Check />시작하기</Button>}
        </div>
      </div>
    </Modal>
  );
}
