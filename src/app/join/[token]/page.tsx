'use client';
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { AuthCard, PasswordInput } from '@/components/AuthCard';
import { Button, Field, inputCls } from '@/components/ui';
import { api } from '@/components/client';
import { OrDivider, SocialButtons } from '@/components/SocialButtons';

/**
 * #1176 회사 초대 링크(대표 11/26): 관리자가 단체방 등에 공유한 링크 → 이메일 또는 소셜로 합류 신청 → (이메일은 확인 메일) → 회사 관리자가 승인하면 로그인.
 * 승인 없는 가입은 없음. 앱 안에서도 이 화면은 열림(회사 만들기·결제는 없음 — iOS 3.1.1)
 */
export default function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [info, setInfo] = useState<{ ok: boolean; company: string | null; problem: string | null } | null>(null);
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const [agree, setAgree] = useState({ terms: false, privacy: false, age14: false, ai: false });
  const [social, setSocial] = useState(0);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ message: string; devVerify?: string } | null>(null);
  useEffect(() => { api(`/api/join/${encodeURIComponent(token)}`).then(setInfo).catch((e) => setInfo({ ok: false, company: null, problem: e.message })); }, [token]);
  const all = agree.terms && agree.privacy && agree.age14 && agree.ai;
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    if (!all) return setErr('필수 항목에 모두 동의해 주세요');
    setBusy(true);
    try { setDone(await api(`/api/join/${encodeURIComponent(token)}`, { body: { ...f, agree } })); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  const box = (k: keyof typeof agree, label: React.ReactNode) => (
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={agree[k]} onChange={(e) => setAgree({ ...agree, [k]: e.target.checked })} data-testid={`join-agree-${k}`} /><span>{label}</span></label>
  );
  return (
    <AuthCard member title={info?.company ? `${info.company} 합류 신청` : '회사 합류 신청'}>
      {!info && <p className="text-sm">확인 중…</p>}
      {info && !info.ok && <p className="text-sm text-red-700" role="alert" data-testid="join-problem">{info.problem}</p>}
      {done && <div className="space-y-2 text-sm" data-testid="join-done">
        <p>{done.message}</p>
        <p className="text-xs text-ink-3">메일이 안 보이면 스팸함을 확인해 주세요. 관리자가 승인하면 다시 메일로 알려 드립니다.</p>
        {done.devVerify && <p className="text-xs text-ink-3">개발용 확인 링크: <a href={done.devVerify} className="underline" data-testid="join-dev-verify">{done.devVerify}</a></p>}
      </div>}
      {info?.ok && !done && (
        <form onSubmit={submit} className="space-y-3" data-testid="join-form">
          <p className="text-sm text-ink-2"><b>{info.company}</b>에서 공유한 초대 링크입니다. 신청하면 회사 관리자가 확인한 뒤 승인합니다(승인 전에는 들어갈 수 없습니다).</p>
          <SocialButtons verb="합류 신청" join={token} onReady={setSocial} />
          {social > 0 && <OrDivider text="또는 이메일로" />}
          <Field label="이름"><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={50} required autoComplete="name" data-testid="join-name" /></Field>
          <Field label="이메일"><input className={inputCls} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} maxLength={200} required autoComplete="email" data-testid="join-email" /></Field>
          <Field label="비밀번호 (8자 이상)"><PasswordInput autoComplete="new-password" minLength={8} value={f.password} onChange={(v) => setF({ ...f, password: v })} /></Field>
          <div className="space-y-1.5 rounded-card border border-line p-3">
            {box('terms', <>(필수) <Link href="/terms" target="_blank" className="underline">이용약관</Link> 동의</>)}
            {box('privacy', <>(필수) <Link href="/privacy" target="_blank" className="underline">개인정보 처리방침</Link> 동의</>)}
            {box('age14', '(필수) 만 14세 이상입니다')}
            {box('ai', <>(필수) <Link href="/ai-notice" target="_blank" className="underline">AI 기능 이용</Link> 동의 — 워크인의 핵심 기능입니다</>)}
          </div>
          {err && <p className="text-sm text-red-700" role="alert">{err}</p>}
          <Button type="submit" className="w-full" disabled={busy} data-testid="join-submit">{busy ? '보내는 중…' : '합류 신청'}</Button>
          <p className="text-center text-xs text-ink-3">이미 계정이 있나요? <Link href="/login" className="underline">로그인</Link></p>
        </form>
      )}
    </AuthCard>
  );
}
