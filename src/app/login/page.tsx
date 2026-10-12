'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AlertCircle, ArrowRight, Loader2, WifiOff } from 'lucide-react';
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
      const network = !(e instanceof ApiError) || e.status === 0 || e.status >= 500;
      setErr({ text: e instanceof ApiError ? e.message : '서버에 연결할 수 없습니다. 인터넷 연결을 확인하고 잠시 후 다시 시도하세요.', network });
    } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="space-y-4" noValidate={false}>
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
