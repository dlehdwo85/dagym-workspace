'use client';
import { useEffect, useState } from 'react';
import { AuthCard } from '@/components/AuthCard';
import { Button, Field, inputCls } from '@/components/ui';
import { api } from '@/components/client';

export default function SetupPage() {
  const [needs, setNeeds] = useState<boolean | null>(null);
  const [f, setF] = useState({ secret: '', email: '', name: '', password: '' });
  const [err, setErr] = useState('');
  useEffect(() => { api('/api/setup').then((r) => setNeeds(r.needsSetup)).catch(() => setNeeds(false)); }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    try { await api('/api/setup', { body: f }); location.href = '/admin/org'; } catch (e: any) { setErr(e.message); }
  }
  if (needs === null) return <AuthCard title="초기 설정">확인 중…</AuthCard>;
  if (!needs) return <AuthCard title="초기 설정"><p className="text-sm">이미 설정이 끝났습니다. <a className="underline" href="/login">로그인</a></p></AuthCard>;
  return (
    <AuthCard title="대표 계정 만들기 (최초 1회)">
      <form onSubmit={submit} className="space-y-3">
        <Field label="설정 비밀값 (SETUP_SECRET)"><input className={inputCls} type="password" value={f.secret} onChange={(e) => setF({ ...f, secret: e.target.value })} required /></Field>
        <Field label="이름"><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
        <Field label="이메일"><input className={inputCls} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></Field>
        <Field label="비밀번호 (10자 이상)"><input className={inputCls} type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required minLength={10} /></Field>
        {err && <p className="text-sm text-red-600">{err}</p>}
        <Button type="submit" className="w-full">대표 계정 생성</Button>
      </form>
    </AuthCard>
  );
}
