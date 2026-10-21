'use client';
// #116 전자계약서 서명 화면(로그인 없음): 접속 코드 → 본문 읽기 → 동의 → 서명(그리기·도장) → 완료(PDF). 거절도 가능.
import { use, useEffect, useState } from 'react';
import { CheckCircle2, Loader2, ShieldCheck } from 'lucide-react';
import { SignaturePad } from '@/components/SignaturePad';
import { Button, Field, cx, inputCls } from '@/components/ui';

type Info = { company: string; title: string; docNo: string | null; signerName: string; role: string; status: string; myStatus: string; codeBy: string; locked: boolean; expiresAt: string | null };
type View = { company: string; title: string; docNo: string | null; body: string; status: string; myStatus: string; myTurn: boolean; me: { id: string; name: string; role: string; roleLabel: string }; signers: { ord: number; role: string; roleLabel: string; name: string; status: string; signedAt: string | null; me: boolean }[]; pdfReady: boolean; completedAt: string | null };
async function call(path: string, body?: unknown) {
  const r = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j?.error?.message ?? '오류가 났습니다'), { status: r.status });
  return j;
}
const fmt = (d: string | null) => (d ? new Date(d).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' }) : '');

export default function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [info, setInfo] = useState<Info | null>(null);
  const [err, setErr] = useState('');
  const [code, setCode] = useState('');
  const [view, setView] = useState<View | null>(null);
  const [busy, setBusy] = useState(false);
  const [agree, setAgree] = useState(false);
  const [sig, setSig] = useState<{ png: string; method: 'draw' | 'stamp' } | null>(null);
  const [done, setDone] = useState<'signed' | 'declined' | null>(null);
  const [declining, setDeclining] = useState(false); const [reason, setReason] = useState('');
  useEffect(() => { call(`/api/sign/${token}`).then(setInfo).catch((e) => setErr(e.message)); }, [token]);
  const open = async (e?: React.FormEvent) => {
    e?.preventDefault(); setBusy(true); setErr('');
    try { setView(await call(`/api/sign/${token}/view`, { code })); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const sign = async () => {
    if (!sig || !agree) return; setBusy(true); setErr('');
    try { await call(`/api/sign/${token}/sign`, { code, image: sig.png, method: sig.method, agree: true }); setDone('signed'); setView(await call(`/api/sign/${token}/view`, { code })); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const decline = async () => {
    if (!reason.trim()) return; setBusy(true); setErr('');
    try { await call(`/api/sign/${token}/decline`, { code, reason }); setDone('declined'); setDeclining(false); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <main className="mx-auto min-h-dvh max-w-2xl bg-white px-4 py-8 text-ink" data-testid="sign-page">
      <p className="text-xs font-semibold tracking-wide text-brand-700">워크인 전자계약</p>
      {!info && !err && <p className="mt-3 text-sm text-ink-2">확인 중…</p>}
      {!info && err && <p className="mt-3 rounded-input bg-red-50 p-3 text-sm text-red-700" role="alert" data-testid="sign-error">{err}</p>}
      {info && !view && (
        <form onSubmit={open} className="mt-2 space-y-4">
          <h1 className="text-xl font-bold" data-testid="sign-title">{info.title}</h1>
          <p className="text-sm text-ink-2">{info.company}에서 <b>{info.signerName}</b>님께 보낸 전자계약서입니다. {info.docNo && <span className="font-mono text-xs text-ink-3">{info.docNo}</span>}</p>
          {info.locked ? <p className="rounded-input bg-red-50 p-3 text-sm text-red-700" data-testid="sign-locked">접속 코드를 5회 틀려 잠겼습니다. 담당자에게 다시 보내 달라고 하세요.</p> : (
            <>
              <Field label="접속 코드 (6자리)" hint={info.codeBy === 'mail' ? '메일로 받은 접속 코드' : '담당자가 문자로 보낸 접속 코드'}>
                <input className={cx(inputCls, 'text-center text-lg tracking-[0.3em]')} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} data-testid="sign-code" />
              </Field>
              {err && <p className="text-sm text-red-600" role="alert" data-testid="sign-error">{err}</p>}
              <Button type="submit" disabled={busy || code.length < 6} className="w-full" data-testid="sign-open">{busy ? <Loader2 className="animate-spin" /> : <ShieldCheck />}계약서 열기</Button>
              <p className="text-[11px] text-ink-3">열람·서명 시각과 접속 IP·기기 정보가 감사 추적으로 기록됩니다. 본인만 열어 주세요.</p>
            </>
          )}
        </form>
      )}
      {view && (
        <div className="mt-2 space-y-4">
          <h1 className="text-xl font-bold" data-testid="sign-title">{view.title}</h1>
          <p className="text-xs text-ink-3">{view.company}{view.docNo ? ` · ${view.docNo}` : ''} · 나: {view.me.roleLabel} {view.me.name}</p>
          <ol className="flex flex-wrap gap-1.5 text-xs" data-testid="sign-signers">
            {view.signers.map((s, i) => <li key={i} className={cx('rounded-full border px-2 py-0.5', s.status === 'signed' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : s.status === 'declined' ? 'border-red-200 bg-red-50 text-red-700' : 'border-line bg-slate-50 text-ink-2', s.me && 'ring-1 ring-brand-300')}>{s.ord}. {s.roleLabel} {s.name} · {s.status === 'signed' ? `서명 ${fmt(s.signedAt)}` : s.status === 'declined' ? '거절' : '대기'}</li>)}
          </ol>
          <article className="max-h-[60vh] overflow-y-auto rounded-card border border-line bg-slate-50 p-4 text-sm leading-6" data-testid="sign-body">
            {view.body.split('\n').map((ln, i) => ln.startsWith('# ') ? <h2 key={i} className="mb-1 mt-3 text-base font-bold first:mt-0">{ln.slice(2)}</h2> : ln.trim() ? <p key={i} className="whitespace-pre-wrap">{ln}</p> : <div key={i} className="h-2" />)}
          </article>
          {done === 'signed' || view.myStatus === 'signed' ? (
            <div className="rounded-card border border-emerald-200 bg-emerald-50 p-4 text-sm" data-testid="sign-done">
              <p className="flex items-center gap-1.5 font-semibold text-emerald-800"><CheckCircle2 className="size-4" />서명이 완료되었습니다.</p>
              <p className="mt-1 text-emerald-900">{view.status === 'completed' ? `모든 서명이 끝났습니다 (${fmt(view.completedAt)}).` : '다른 서명자의 서명이 끝나면 완료본이 만들어집니다. 이 링크와 접속 코드로 다시 들어와 내려받을 수 있습니다.'}</p>
              {view.pdfReady && <a href={`/api/sign/${token}/pdf?code=${encodeURIComponent(code)}`} className="mt-2 inline-flex h-9 items-center rounded-input bg-brand-600 px-3 text-sm font-medium text-white" data-testid="sign-pdf">완료본 PDF 보기</a>}
            </div>
          ) : done === 'declined' || view.myStatus === 'declined' ? (
            <p className="rounded-card border border-red-200 bg-red-50 p-4 text-sm text-red-800" data-testid="sign-declined">서명을 거절했습니다. 담당자에게 알림이 갔습니다.</p>
          ) : view.status === 'completed' ? (
            <div className="rounded-card border border-emerald-200 bg-emerald-50 p-4 text-sm"><p className="font-semibold text-emerald-800">모든 서명이 끝났습니다.</p>{view.pdfReady && <a href={`/api/sign/${token}/pdf?code=${encodeURIComponent(code)}`} className="mt-2 inline-flex h-9 items-center rounded-input bg-brand-600 px-3 text-sm font-medium text-white" data-testid="sign-pdf">완료본 PDF 보기</a>}</div>
          ) : !view.myTurn ? (
            <p className="rounded-card border border-line bg-slate-50 p-4 text-sm text-ink-2" data-testid="sign-wait">앞 순서 서명자의 서명이 끝나면 서명할 수 있습니다. 차례가 오면 다시 안내해 드립니다.</p>
          ) : (
            <div className="space-y-3 rounded-card border border-line p-4">
              <h2 className="text-sm font-semibold">서명</h2>
              <SignaturePad onChange={(png, method) => setSig(png ? { png, method } : null)} />
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={agree} onChange={(e) => setAgree(e.target.checked)} data-testid="sign-agree" /><span>위 내용을 모두 읽고 이해했으며, 이 전자서명이 본인의 서명으로서 효력을 가짐에 동의합니다.</span></label>
              {err && <p className="text-sm text-red-600" role="alert" data-testid="sign-error">{err}</p>}
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="secondary" onClick={() => setDeclining(true)} disabled={busy} data-testid="sign-decline-open">서명 거절</Button>
                <Button onClick={sign} disabled={busy || !sig || !agree} data-testid="sign-submit">{busy && <Loader2 className="animate-spin" />}서명하기</Button>
              </div>
              {declining && (
                <div className="space-y-2 rounded-input bg-red-50 p-3" data-testid="sign-decline-box">
                  <Field label="거절 사유"><textarea className={cx(inputCls, 'min-h-16')} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="sign-decline-reason" /></Field>
                  <div className="flex justify-end gap-2"><Button size="sm" variant="secondary" onClick={() => setDeclining(false)}>취소</Button><Button size="sm" variant="danger" onClick={decline} disabled={busy || !reason.trim()} data-testid="sign-decline">거절 보내기</Button></div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      <p className="mt-8 text-[11px] text-ink-3">워크인 전자계약 · 서명 기록은 전자서명법에 따른 전자서명으로 보관됩니다.</p>
    </main>
  );
}
