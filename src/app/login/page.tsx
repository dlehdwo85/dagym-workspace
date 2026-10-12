'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AlertCircle, ArrowRight, Loader2, ServerCrash, WifiOff } from 'lucide-react';
import { AuthCard, PasswordInput } from '@/components/AuthCard';
import { Button, Field, inputCls } from '@/components/ui';
import { ApiError, api } from '@/components/client';
import { Capacitor } from '@capacitor/core';

function LoginForm() {
  const sp = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<{ text: string; network: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [down, setDown] = useState<string | null>(null);
  // 서버·DB 상태를 먼저 확인해 운영 설정 미완료면 원인을 바로 보여 준다
  useEffect(() => {
    fetch('/api/health', { cache: 'no-store' }).then(async (r) => {
      if (r.ok) return;
      const j = await r.json().catch(() => ({}));
      setDown(/DATABASE_URL/.test(j?.error ?? '') ? '운영 설정이 아직 끝나지 않았습니다: 데이터베이스가 연결되지 않아 로그인할 수 없습니다. 관리자에게 문의하세요.'
        : '데이터베이스에 연결할 수 없어 지금은 로그인할 수 없습니다. 잠시 후 다시 시도하고, 계속되면 관리자에게 알려 주세요.');
    }).catch(() => {});
  }, []);
  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true); setErr(null);
    try {
      const client = Capacitor.isNativePlatform() ? Capacitor.getPlatform() : 'web';
      await api('/api/auth/login', { body: { email, password, client } });
      const next = sp.get('next');
      location.href = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
    } catch (e) {
      // U-0c 연결 실패는 영어 원문 대신 한국어 안내 + 다시 시도
      const network = !(e instanceof ApiError) || e.status === 0 || (e.status >= 500 && e.code !== 'not_configured');
      setErr({ text: e instanceof ApiError ? e.message : '서버에 연결할 수 없습니다. 인터넷 연결을 확인하고 잠시 후 다시 시도하세요.', network });
    } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="space-y-4" noValidate={false}>
      {down && (
        <div className="flex gap-2.5 rounded-input border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="alert" data-testid="server-not-ready">
          <ServerCrash className="mt-0.5 size-4 shrink-0" /><p>{down}</p>
        </div>
      )}
      <Field label="회사 이메일"><input className={inputCls + ' h-11'} type="email" inputMode="email" autoComplete="username" placeholder="name@company.co.kr" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></Field>
      <Field label="비밀번호"><PasswordInput value={password} onChange={setPassword} /></Field>
      {err && (
        <div className={err.network ? 'flex gap-2.5 rounded-input border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900' : 'flex gap-2.5 rounded-input border border-red-200 bg-red-50 p-3 text-sm text-red-800'} role="alert">
          {err.network ? <WifiOff className="mt-0.5 size-4 shrink-0" /> : <AlertCircle className="mt-0.5 size-4 shrink-0" />}
          <div className="flex-1">
            <p>{err.text}</p>
            {err.network && <button type="button" onClick={() => submit()} className="mt-1.5 font-semibold underline">다시 시도</button>}
          </div>
        </div>
      )}
      <Button type="submit" className="h-11 w-full text-[15px]" disabled={busy}>{busy ? <><Loader2 className="animate-spin" />확인 중…</> : <>로그인<ArrowRight /></>}</Button>
      <p className="text-center text-xs leading-relaxed text-ink-2">계정은 관리자 초대로만 만들 수 있습니다.<br />비밀번호를 잊었다면 관리자에게 재설정 링크를 요청하세요.</p>
    </form>
  );
}
export default function LoginPage() {
  return <AuthCard title="로그인" sub="회사 계정으로 로그인하세요"><Suspense><LoginForm /></Suspense></AuthCard>;
}
