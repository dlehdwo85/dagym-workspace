'use client';
import { use, useEffect, useState } from 'react';
import { AuthCard, PasswordInput } from '@/components/AuthCard';
import { Button, Field, inputCls } from '@/components/ui';
import { api } from '@/components/client';
import { OrDivider, SocialButtons } from '@/components/SocialButtons';
import { isInApp } from '@/components/inApp';
import { APPSTORE_URL, APP_GET_PATH } from '@/lib/storeLinks';

/** 휴대폰 브라우저(앱 아님·홈 화면 웹앱 아님)에서 초대를 받은 사람 — 가입 뒤 '앱 받기' 한 단계를 보여 준다(대표 11/20). PC 는 지금처럼 바로 홈으로 */
function phoneBrowser(): 'android' | 'ios' | null {
  try {
    if (isInApp()) return null;
    if (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone) return null;
    const ua = navigator.userAgent;
    return /Android/i.test(ua) ? 'android' : /iPhone|iPod/i.test(ua) ? 'ios' : null;
  } catch { return null; }
}

export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [info, setInfo] = useState<any>(null);
  const [err, setErr] = useState('');
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('');
  const [social, setSocial] = useState(0);
  const [done, setDone] = useState<null | 'android' | 'ios'>(null);
  useEffect(() => { api(`/api/invitations/${token}`).then(setInfo).catch((e) => setErr(e.message)); }, [token]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pw !== pw2) return setErr('비밀번호가 서로 다릅니다');
    try { await api(`/api/invitations/${token}/accept`, { body: { password: pw } }); const ph = phoneBrowser(); if (ph) setDone(ph); else location.href = '/'; } catch (e: any) { setErr(e.message); }
  }
  return (
    <AuthCard title={done ? '가입 완료' : '초대 수락'}>
      {done && (
        <div className="space-y-3 break-keep" data-testid="invite-done">
          <p className="text-sm text-slate-700">가입이 끝났습니다. {done === 'android' || APPSTORE_URL
            ? <>이제 휴대폰 앱을 받아 <b>{info?.email}</b> 과 방금 정한 비밀번호로 로그인하세요. 앱에서는 알림을 받습니다.</>
            : <>아이폰 앱은 준비 중입니다. 홈 화면에 추가하면 앱처럼 쓸 수 있습니다.</>}</p>
          <a href={APP_GET_PATH} className="flex h-11 w-full items-center justify-center rounded-input bg-brand-600 text-[15px] font-semibold text-white hover:bg-brand-700" data-testid="invite-app">{done === 'android' || APPSTORE_URL ? '앱 받기' : '홈 화면에 추가하는 방법'}</a>
          {/* 가입 직후라 화면을 통째로 새로 읽는다(로그인 상태 반영) — 예전의 location.href 와 같게 */}
          <button type="button" onClick={() => { location.href = '/'; }} className="flex h-11 w-full items-center justify-center rounded-input border border-line bg-white text-sm font-semibold text-ink-2" data-testid="invite-web">웹으로 계속하기</button>
        </div>
      )}
      {!done && !info && !err && <p className="text-sm">확인 중…</p>}
      {!done && !info && err && <p className="text-sm text-red-600" role="alert">{err}</p>}
      {!done && info && (
        <form onSubmit={submit} className="space-y-3">
          <p className="text-sm text-slate-700"><b>{info.invitedBy}</b>님이 <b>{info.name}</b>({info.email})님을 <b>{info.roleLabel}</b> 권한으로 초대했습니다.{social > 0 ? ' 소셜 계정으로 바로 합류하거나 비밀번호를 정하세요.' : ' 사용할 비밀번호를 정하세요.'}</p>
          <SocialButtons verb="합류" invite={token} onReady={setSocial} />
          {social > 0 && <OrDivider text="또는 비밀번호로" />}
          <Field label="비밀번호 (8자 이상)"><PasswordInput autoComplete="new-password" minLength={8} value={pw} onChange={setPw} /></Field>
          <Field label="비밀번호 확인"><PasswordInput autoComplete="new-password" value={pw2} onChange={setPw2} /></Field>
          {err && <p className="text-sm text-red-600" role="alert">{err}</p>}
          <Button type="submit" className="w-full">가입하고 시작하기</Button>
        </form>
      )}
    </AuthCard>
  );
}
