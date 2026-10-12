'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AuthCard } from '@/components/AuthCard';
import { Button, Field, inputCls } from '@/components/ui';
import { api } from '@/components/client';
import { Capacitor } from '@capacitor/core';

function LoginForm() {
  const sp = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const client = Capacitor.isNativePlatform() ? Capacitor.getPlatform() : 'web';
      await api('/api/auth/login', { body: { email, password, client } });
      const next = sp.get('next');
      location.href = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="회사 이메일"><input className={inputCls} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
      <Field label="비밀번호"><input className={inputCls} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
      {err && <p className="text-sm text-red-600" role="alert">{err}</p>}
      <Button type="submit" className="w-full" disabled={busy}>{busy ? '확인 중…' : '로그인'}</Button>
      <p className="text-center text-xs text-slate-500">계정은 관리자 초대로만 만들 수 있습니다. 비밀번호를 잊었다면 관리자에게 재설정 링크를 요청하세요.</p>
    </form>
  );
}
export default function LoginPage() {
  return <AuthCard title="업무·일정 관리 로그인"><Suspense><LoginForm /></Suspense></AuthCard>;
}
