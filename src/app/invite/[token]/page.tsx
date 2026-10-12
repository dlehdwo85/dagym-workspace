'use client';
import { use, useEffect, useState } from 'react';
import { AuthCard } from '@/components/AuthCard';
import { Button, Field, inputCls } from '@/components/ui';
import { api } from '@/components/client';

export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [info, setInfo] = useState<any>(null);
  const [err, setErr] = useState('');
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('');
  useEffect(() => { api(`/api/invitations/${token}`).then(setInfo).catch((e) => setErr(e.message)); }, [token]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pw !== pw2) return setErr('비밀번호가 서로 다릅니다');
    try { await api(`/api/invitations/${token}/accept`, { body: { password: pw } }); location.href = '/'; } catch (e: any) { setErr(e.message); }
  }
  return (
    <AuthCard title="초대 수락">
      {!info && !err && <p className="text-sm">확인 중…</p>}
      {!info && err && <p className="text-sm text-red-600" role="alert">{err}</p>}
      {info && (
        <form onSubmit={submit} className="space-y-3">
          <p className="text-sm text-slate-700"><b>{info.invitedBy}</b>님이 <b>{info.name}</b>({info.email})님을 <b>{info.roleLabel}</b> 권한으로 초대했습니다. 사용할 비밀번호를 정하세요.</p>
          <Field label="비밀번호 (8자 이상)"><input className={inputCls} type="password" autoComplete="new-password" minLength={8} value={pw} onChange={(e) => setPw(e.target.value)} required /></Field>
          <Field label="비밀번호 확인"><input className={inputCls} type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required /></Field>
          {err && <p className="text-sm text-red-600" role="alert">{err}</p>}
          <Button type="submit" className="w-full">가입하고 시작하기</Button>
        </form>
      )}
    </AuthCard>
  );
}
