'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BellRing, Check, Copy, Mail, MessageCircle, MessageSquare, Smartphone, UserPlus } from 'lucide-react';
import { api, useApi } from './client';
import { enableNativePush, isNativeApp, subscribeWebPush } from './native';
import { useSession } from './session';
import { kakaoEnabled, shareKakao } from './kakao';
import { SignupSteps } from './SignupSteps';
import { Button, Field, Modal, cx, inputCls, toast } from './ui';

type Status = { email: string; workEmail: string | null; phone: string | null; mailChannel: string | null; kakaoLinked: boolean; people: number; admin: boolean };

/**
 * V15 첫 로그인 안내 → V32 3: 회사를 만든 사람에게만(초대 직원은 안 뜸) ③ 연락 채널 → ④ 동료 초대(팀) → 알림 켜기. 각 단계 [나중에] 가능
 * 메일: "가입 이메일을 회사 기본 발송·회신 주소로 쓸까요?" — 예면 워크인 발송 + 답장은 이 주소(설정 없이 바로)
 */
export function Onboarding() {
  const s = useSession();
  const router = useRouter();
  const st = useApi<Status>('/api/onboarding');
  const [open, setOpen] = useState(true);
  const steps = s.tenant?.personal ? (['channels', 'push'] as const) : (['channels', 'invite', 'push'] as const);
  const [i, setI] = useState(0);
  const step = steps[i];
  const [reply, setReply] = useState<'signup' | 'other'>('signup');
  const [work, setWork] = useState('');
  const [phone, setPhone] = useState('');
  const [title, setTitle] = useState('');
  const [emails, setEmails] = useState('');
  const [links, setLinks] = useState<{ email: string; url: string }[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (st.data) { setPhone(st.data.phone ?? ''); setWork(st.data.workEmail ?? ''); } }, [st.data]);
  async function finish() { try { await api('/api/onboarding', { body: { done: true } }); } catch {} setOpen(false); router.refresh(); }
  const next = () => (i + 1 < steps.length ? setI(i + 1) : finish());
  async function saveChannels() {
    setBusy(true);
    try {
      await api('/api/onboarding', { body: { title: title.trim() || undefined, channels: { replyTo: reply, workEmail: reply === 'other' ? work.trim() : undefined, phone: phone.trim() || undefined } } });
      toast.ok('연락 채널을 저장했습니다'); next();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  async function invite() {
    const list = emails.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter((x) => /.+@.+\..+/.test(x)).slice(0, 20);
    if (!list.length) { toast.error('초대할 이메일을 적어 주세요'); return; }
    setBusy(true);
    const hq = s.dir.orgUnits[0]?.id;
    const out: { email: string; url: string }[] = [];
    for (const email of list) {
      try { const r = await api('/api/admin/users', { body: { email, name: email.split('@')[0].slice(0, 50), role: 'staff', orgUnitIds: hq ? [hq] : [] } }); out.push({ email, url: `${location.origin}${r.path}` }); }
      catch (e: any) { toast.error(`${email}: ${e.message}`); }
    }
    setLinks([...links, ...out]); setEmails(''); setBusy(false);
    if (out.length) { toast.ok(`${out.length}명에게 초대 메일을 보냈습니다`); api('/api/onboarding', { body: { invited: true } }).catch(() => {}); }
  }
  const copy = (t: string) => navigator.clipboard?.writeText(t).then(() => toast.ok('복사했습니다'), () => toast.error('복사하지 못했습니다'));
  async function push() {
    try { if (isNativeApp()) await enableNativePush(); else await subscribeWebPush(); toast.ok('이 기기에서 알림을 받습니다'); } catch (e: any) { toast.error(e.message); }
  }
  const d = st.data;
  const titles = { channels: '연락 채널 연결', invite: '동료 초대', push: '알림 켜기' };
  return (
    <Modal open={open} onClose={finish} title={titles[step]}>
      <div className="space-y-4" data-testid="onboarding">
        {step !== 'push' && <SignupSteps at={step === 'channels' ? 3 : 4} />}
        {step === 'channels' && d && <>
          <section className="space-y-2 rounded-card border border-line p-3" data-testid="ob-mail">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold"><Mail className="size-4 text-brand-600" />메일</h3>
            <p className="text-sm">가입한 이메일 <b>{d.email}</b> 을 회사 기본 발송·회신 주소로 쓸까요?</p>
            <div className="grid gap-1.5 sm:grid-cols-2" role="radiogroup" aria-label="회신 주소">
              {([['signup', '예, 이 주소로', '설정 없이 바로 — 고객 답장이 이 주소로 옵니다'], ['other', '다른 주소', '회사 대표 메일 등 다른 주소로 답장 받기']] as const).map(([k, l, h]) => (
                <button key={k} type="button" role="radio" aria-checked={reply === k} onClick={() => setReply(k)} data-testid={`ob-reply-${k}`}
                  className={cx('rounded-input border p-2.5 text-left text-sm', reply === k ? 'border-brand-600 bg-brand-50 ring-1 ring-brand-600' : 'border-line hover:bg-slate-50')}>
                  <b>{l}</b><span className="mt-0.5 block text-xs text-ink-2">{h}</span></button>
              ))}
            </div>
            {reply === 'other' && <input className={inputCls} type="email" value={work} onChange={(e) => setWork(e.target.value)} placeholder="예: office@company.co.kr" aria-label="회신 주소" />}
            <p className="text-xs text-ink-3">회사 메일함(보낸메일함)에 남기려면 나중에 <a href="/admin/mail" className="underline">회사 메일 계정 연결(고급)</a>.</p>
          </section>
          <section className="space-y-2 rounded-card border border-line p-3">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold"><MessageSquare className="size-4 text-brand-600" />문자</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="내 휴대폰 (선택 — 문자 서명)"><input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="010-0000-0000" aria-label="휴대폰" /></Field>
              <Field label="직급 (선택)"><input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 대표" aria-label="직급" /></Field>
            </div>
            <p className="text-xs text-ink-3">문자는 내 휴대폰 문자앱으로 넘겨 보냅니다(설정 필요 없음).</p>
          </section>
          <section className="space-y-1 rounded-card border border-line p-3">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold"><MessageCircle className="size-4 text-brand-600" />카카오톡</h3>
            <p className="text-sm text-ink-2">{d.kakaoLinked ? '카카오로 가입해 카카오톡 공유가 준비됐습니다.' : kakaoEnabled() ? '카카오톡으로 보내기는 바로 됩니다 — 업무에서 친구를 골라 보내세요.' : '카카오톡 보내기는 복사해서 보내는 방식으로 쓸 수 있습니다.'}</p>
          </section>
        </>}
        {step === 'invite' && <>
          <p className="text-sm text-ink-2">함께 일할 동료의 이메일을 적으면 초대 메일이 갑니다. 링크를 복사해 카카오톡·문자로 보내도 됩니다.</p>
          <Field label="이메일 (여러 명은 쉼표·줄바꿈)"><textarea className={inputCls} rows={3} value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="kim@company.co.kr, lee@company.co.kr" data-testid="ob-invite-emails" /></Field>
          <Button variant="secondary" onClick={invite} disabled={busy} data-testid="ob-invite-send"><UserPlus />초대 보내기</Button>
          {links.length > 0 && (
            <ul className="space-y-1.5 text-sm" data-testid="ob-invite-links">
              {links.map((l) => (
                <li key={l.email} className="flex flex-wrap items-center gap-1.5 rounded-input bg-slate-50 px-2 py-1.5">
                  <span className="min-w-0 flex-1 truncate">{l.email}</span>
                  <Button size="sm" variant="ghost" onClick={() => copy(l.url)}><Copy />링크 복사</Button>
                  {kakaoEnabled() && <Button size="sm" variant="ghost" onClick={() => shareKakao({ text: `워크인에서 함께 일해요 — ${s.tenant?.name ?? ''} 초대`, url: l.url, buttonTitle: '초대 받기' }).catch((e) => toast.error(e.message))}><MessageCircle />카카오톡</Button>}
                </li>
              ))}
            </ul>
          )}
        </>}
        {step === 'push' && <>
          <p className="text-sm text-ink-2">마감·회의 시간에 맞춰 알림을 보내 드립니다.</p>
          <Button onClick={push} variant="secondary" className="w-full" data-testid="onboarding-push"><BellRing />이 기기에서 알림 켜기</Button>
          {!isNativeApp() && <p className="flex items-start gap-2 rounded-input bg-slate-50 p-3 text-sm text-ink-2"><Smartphone className="mt-0.5 size-4 shrink-0" />휴대폰에서는 워크인 앱(Android·iOS)을 설치하고 같은 계정으로 로그인하면 앱 알림을 받을 수 있습니다.</p>}
        </>}
        <div className="flex justify-between gap-2">
          <Button variant="ghost" onClick={next} data-testid="onboarding-later">나중에</Button>
          {step === 'channels' ? <Button onClick={saveChannels} disabled={busy || !d} data-testid="onboarding-next">저장하고 다음</Button>
            : step === 'invite' ? <Button onClick={next} data-testid="onboarding-next">다음</Button>
            : <Button onClick={finish} data-testid="onboarding-done"><Check />시작하기</Button>}
        </div>
      </div>
    </Modal>
  );
}
