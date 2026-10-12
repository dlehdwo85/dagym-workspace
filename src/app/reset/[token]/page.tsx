'use client';
import { use, useState } from 'react';
import { AuthCard } from '@/components/AuthCard';
import { Button, Field, inputCls } from '@/components/ui';
import { api } from '@/components/client';

export default function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [pw, setPw] = useState(''); const [msg, setMsg] = useState(''); const [ok, setOk] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try { await api(`/api/password-reset/${token}`, { body: { password: pw } }); setOk(true); } catch (e: any) { setMsg(e.message); }
  }
  return (
    <AuthCard title="비밀번호 재설정">
      {ok ? <p className="text-sm">변경되었습니다. <a className="underline" href="/login">로그인</a></p> : (
        <form onSubmit={submit} className="space-y-3">
          <Field label="새 비밀번호 (8자 이상)"><input className={inputCls} type="password" minLength={8} autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required /></Field>
          {msg && <p className="text-sm text-red-600">{msg}</p>}
          <Button type="submit" className="w-full">변경</Button>
        </form>
      )}
    </AuthCard>
  );
}
