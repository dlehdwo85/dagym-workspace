'use client';
import { useState } from 'react';
import { api } from './client';
import { Button, Field, inputCls } from './ui';

/** 계정 삭제 요청 폼(로그인 없이) — 응답은 항상 같은 안내 */
export function DeletionRequestForm() {
  const [f, setF] = useState({ email: '', name: '', reason: '' });
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(null); setBusy(true);
    try { setDone((await api('/api/public/account-deletion', { body: f })).message); } catch (er: any) { setErr(er.message); } finally { setBusy(false); }
  }
  if (done) return <p className="rounded-lg border border-green-200 bg-green-50 p-3 text-green-900" data-testid="deletion-done">{done}</p>;
  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border p-4" data-testid="deletion-form">
      <Field label="가입한 이메일"><input className={inputCls} type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} aria-label="가입한 이메일" /></Field>
      <Field label="이름 (선택)"><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={50} aria-label="이름" /></Field>
      <Field label="사유 (선택)"><textarea className={inputCls} rows={3} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} maxLength={1000} aria-label="사유" /></Field>
      {err && <p className="text-sm text-red-700" role="alert">{err}</p>}
      <Button type="submit" disabled={busy}>{busy ? '보내는 중…' : '삭제 요청 보내기'}</Button>
    </form>
  );
}
