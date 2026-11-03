'use client';
import { useState } from 'react';
import { Check } from 'lucide-react';
import { readUtm } from './conversion';
import { cx } from './ui';

type Opt = { key: string; name: string };
/**
 * #949 입찰 공고 아침 메일 무료 구독 폼(소개 페이지) — 이메일 · 관심 지역(시·도, 비우면 전국) · 관심 분야(하나 이상) · 개인정보 동의 → [무료로 받기].
 * 로그인·회사 가입·카드 없음. 신청 때 브라우저가 기억한 utm(광고 출처)을 같이 보낸다(측정용, 개인정보 아님).
 */
export function BidAlertForm({ regions, fields, consent, button, done }: { regions: string[]; fields: Opt[]; consent: string; button: string; done: string }) {
  const [email, setEmail] = useState('');
  const [reg, setReg] = useState<string[]>([]);
  const [fld, setFld] = useState<string[]>([fields[0]?.key].filter(Boolean) as string[]);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<null | { resubscribed: boolean }>(null);
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setErr('이메일 주소를 확인해 주세요'); return; }
    if (!fld.length) { setErr('관심 분야를 하나 이상 골라 주세요'); return; }
    if (!agree) { setErr('개인정보 수집·이용에 동의해 주세요'); return; }
    setBusy(true);
    try {
      const r = await fetch('/api/public/bid-alerts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: email.trim(), regions: reg, fields: fld, agree: true, utm: readUtm() }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error?.message ?? '신청하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      setOk({ resubscribed: !!j.resubscribed });
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  if (ok) return (
    <div className="rounded-card border border-brand-200 bg-brand-50/60 p-5 text-left" data-testid="bid-alert-done" role="status">
      <p className="flex items-start gap-2 text-sm font-semibold text-brand-800"><Check className="mt-0.5 size-4 shrink-0" />{ok.resubscribed ? '받는 조건을 바꿨습니다. ' : ''}{done}</p>
      <p className="mt-1 text-xs text-ink-3">{email.trim()} 으로 보냅니다. 받는 조건: {reg.length ? reg.join('·') : '전국'} · {fields.filter((f) => fld.includes(f.key)).map((f) => f.name).join('·')}</p>
    </div>
  );
  const chip = (on: boolean) => cx('rounded-full border px-3 py-1.5 text-sm', on ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-white text-ink-2 hover:border-brand-400');
  return (
    <form onSubmit={submit} className="rounded-card border border-line bg-white p-5 text-left shadow-card" data-testid="bid-alert-form" noValidate>
      <label className="block text-sm font-semibold" htmlFor="bid-alert-email">이메일</label>
      <input id="bid-alert-email" type="email" inputMode="email" autoComplete="email" className="mt-1 h-11 w-full rounded-input border border-line px-3 text-base" placeholder="name@company.co.kr" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="bid-alert-email" />
      <div className="mt-4 text-sm font-semibold">관심 지역 <span className="font-normal text-ink-3">— 고르지 않으면 전국</span></div>
      <div className="mt-1.5 flex flex-wrap gap-1.5" data-testid="bid-alert-regions">{regions.map((r) => <button key={r} type="button" className={chip(reg.includes(r))} aria-pressed={reg.includes(r)} onClick={() => setReg(toggle(reg, r))}>{r}</button>)}</div>
      <div className="mt-4 text-sm font-semibold">관심 분야 <span className="font-normal text-ink-3">— 하나 이상</span></div>
      <div className="mt-1.5 flex flex-wrap gap-1.5" data-testid="bid-alert-fields">{fields.map((f) => <button key={f.key} type="button" className={chip(fld.includes(f.key))} aria-pressed={fld.includes(f.key)} onClick={() => setFld(toggle(fld, f.key))} data-testid={`bid-alert-field-${f.key}`}>{f.name}</button>)}</div>
      <label className="mt-4 flex items-start gap-2 text-xs text-ink-2"><input type="checkbox" className="mt-0.5" checked={agree} onChange={(e) => setAgree(e.target.checked)} data-testid="bid-alert-agree" />{consent}</label>
      {err && <p className="mt-2 text-sm text-red-700" role="alert" data-testid="bid-alert-error">{err}</p>}
      <button type="submit" disabled={busy} className="mt-4 inline-flex min-h-[48px] w-full items-center justify-center rounded-input bg-brand-600 px-6 py-3 text-base font-semibold text-white hover:bg-brand-700 disabled:opacity-60" data-testid="bid-alert-submit" data-track="bid-alert-subscribe">{busy ? '신청하는 중…' : button}</button>
      <p className="mt-2 text-center text-[11px] text-ink-3">회사 가입·카드 없음 · 새 공고가 있는 날만 아침 한 통 · 메일 맨 아래에서 한 번에 수신 거부</p>
    </form>
  );
}
