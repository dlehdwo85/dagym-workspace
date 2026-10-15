'use client';
import { useEffect, useState } from 'react';
import { CreditCard } from 'lucide-react';
import { api, useApi } from './client';
import { Button, Field, cx, fmtDateTime, inputCls, toast } from './ui';

const won = (n: number | null | undefined) => (n == null ? '-' : `${n.toLocaleString('ko-KR')}원`);
const STATUS: Record<string, string> = { pending: '대기', paid: '결제 완료', failed: '실패', canceled: '환불', partial_canceled: '부분 환불' };
const KIND: Record<string, string> = { subscription: '월 구독', annual: '연간', addon: '팩' };

declare global { interface Window { goPay?: (f: HTMLFormElement) => void; nicepaySubmit?: () => void } }

/** 18차: 결제 — 카드(빌키) 등록 · 월 구독 · 연간·팩(결제창) · 영수증 · 해지 */
/** 나이스페이 결제창 띄우기(서버가 만든 서명된 파라미터) — 회사 결제·V32 1 플랫폼 결제 시험 공용 */
export async function launchNicepay(r: { script: string; params: Record<string, string | number> }) {
  await new Promise<void>((res, rej) => { if (window.goPay) return res(); const s = document.createElement('script'); s.src = r.script; s.onload = () => res(); s.onerror = () => rej(new Error('결제창을 불러오지 못했습니다')); document.head.appendChild(s); });
  const f = document.createElement('form');
  f.method = 'post'; f.action = String(r.params.ReturnURL); f.acceptCharset = 'euc-kr'; f.style.display = 'none';
  for (const [k, v] of Object.entries(r.params)) { const i = document.createElement('input'); i.type = 'hidden'; i.name = k; i.value = String(v); f.appendChild(i); }
  document.body.appendChild(f);
  window.nicepaySubmit = () => f.submit();
  window.goPay!(f);
}

export function BillingSection() {
  const { data, error, reload } = useApi<any>('/api/billing');
  const [card, setCard] = useState({ cardNo: '', exp: '', idNo: '', cardPw: '' });
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState('');
  const [pm, setPm] = useState<'CARD' | 'BANK' | 'VBANK'>('CARD'); // V29 결제창 결제 수단
  useEffect(() => {
    const sp = new URLSearchParams(location.search);
    if (sp.get('paid')) toast.ok('결제했습니다'); else if (sp.get('vbank')) toast.ok(`가상계좌를 만들었습니다 — ${sp.get('vbank')}`); else if (sp.get('payfail')) toast.error(`결제하지 못했습니다: ${sp.get('payfail')}`);
  }, []);
  if (error) return null; // 내부 공간(우리 회사)·권한 없는 사람은 결제 칸 없음
  if (!data || data.internal) return null;
  const sub = data.sub ?? {};
  const monthly = data.quotes.filter((q: any) => q.cycle === 'monthly');
  const annual = data.quotes.filter((q: any) => q.cycle === 'annual');
  async function saveCard(e: React.FormEvent) {
    e.preventDefault();
    const m = /^(\d{2})\s*\/?\s*(\d{2})$/.exec(card.exp.trim());
    if (!m) return toast.error('유효기간은 MM/YY 로 적어 주세요');
    setBusy(true);
    try { await api('/api/billing/card', { body: { cardNo: card.cardNo.replace(/\D/g, ''), expMonth: m[1], expYear: m[2], ...(card.idNo ? { idNo: card.idNo.replace(/\D/g, '') } : {}), ...(card.cardPw ? { cardPw: card.cardPw } : {}) } });
      setCard({ cardNo: '', exp: '', idNo: '', cardPw: '' }); toast.ok('카드를 등록했습니다'); reload(); }
    catch (er: any) { toast.error(er.message); } finally { setBusy(false); }
  }
  async function subscribe(code: string) {
    const q = monthly.find((x: any) => x.planCode === code);
    if (!q || !confirm(`${q.name} 월 ${won(q.amount)}(VAT 포함, ${q.seats}인 기준)을 등록한 카드로 결제하고 매달 자동 결제할까요?`)) return;
    setBusy(true);
    try { await api('/api/billing/subscribe', { body: { planCode: code } }); toast.ok('구독을 시작했습니다'); location.reload(); } catch (er: any) { toast.error(er.message); } finally { setBusy(false); }
  }
  async function openWindow(body: any) {
    setBusy(true);
    try {
      await launchNicepay(await api('/api/billing/window', { body: { ...body, payMethod: pm } }));
    } catch (er: any) { toast.error(er.message); } finally { setBusy(false); }
  }
  return (
    <section className="rounded-card border border-line bg-white p-4 shadow-card" data-testid="billing">
      <h2 className="flex items-center gap-2 text-sm font-semibold"><CreditCard className="size-4 text-brand-600" />결제 {data.mode === 'test' && <span className="rounded bg-amber-100 px-1.5 text-[11px] text-amber-800">시험 모드 — 실제로 청구되지 않습니다</span>}</h2>
      {!data.enabled ? <p className="mt-2 text-sm text-ink-3">결제가 아직 열리지 않았습니다. 요금제 신청은 위 &ldquo;요금제 변경 요청&rdquo;으로 해 주세요.</p> : (
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            <div className="rounded-input bg-slate-50 p-3 text-sm" data-testid="billing-status">
              <div>현재: <b>{sub.plan_code ?? '-'}</b> {sub.billing_cycle ? `· ${sub.billing_cycle === 'annual' ? '연간' : '월'} 자동 결제` : ''}</div>
              {sub.past_due_since && <div className="rounded-input bg-red-50 px-2 py-1 text-red-700" data-testid="billing-past-due">결제 실패(미납) {String(sub.past_due_since).slice(0, 10)}부터{sub.next_retry_on ? ` · ${String(sub.next_retry_on).slice(0, 10)}에 다시 시도` : ''}{sub.billing_lock === 'suspended' ? ' · 이용 중지됨' : sub.billing_lock === 'read_only' ? ' · 읽기 전용' : ' · 7일 지나면 읽기 전용, 30일 지나면 이용 중지'} — 카드를 바꾸거나 아래에서 바로 결제하면 즉시 복구됩니다.</div>}
              {sub.next_billing_on && <div className="text-ink-2">다음 결제: {String(sub.next_billing_on).slice(0, 10)} · {won(sub.billing_amount)}{sub.cancel_at_period_end && <b className="ml-1 text-red-600">해지 예약 — 이날 끝납니다</b>}</div>}
              {sub.past_due_since && <div className="font-medium text-red-600">결제 실패 — {sub.next_retry_on ? `${String(sub.next_retry_on).slice(0, 10)}에 다시 시도` : ''} (첫 실패 7일 뒤 읽기 전용)</div>}
              <div className="mt-1 text-ink-2">카드: {data.card ? `${data.card.card_name ?? ''} ····${data.card.card_last4}` : '없음'}</div>
              {sub.billing_cycle && <div className="mt-2">{sub.cancel_at_period_end
                ? <Button size="sm" variant="secondary" onClick={async () => { await api('/api/billing/autorenew', { body: { renew: true } }); reload(); }}>해지 취소</Button>
                : <Button size="sm" variant="ghost" onClick={async () => { if (confirm('다음 결제일에 구독을 끝낼까요? 그 뒤에는 읽기 전용이 됩니다(데이터는 남음).')) { await api('/api/billing/autorenew', { body: { renew: false } }); reload(); } }} data-testid="billing-cancel">구독 해지(다음 결제일에 종료)</Button>}</div>}
            </div>
            <form onSubmit={saveCard} className="space-y-2" data-testid="billing-card-form">
              <p className="text-xs font-semibold text-ink-2">{data.card ? '카드 바꾸기' : '카드 등록(정기 결제)'} <span className="font-normal text-ink-3">— 카드번호는 저장하지 않고 결제사(나이스페이) 빌키로만 씁니다</span></p>
              <div className="grid grid-cols-2 gap-2">
                <Field label="카드번호"><input className={inputCls} inputMode="numeric" autoComplete="cc-number" value={card.cardNo} onChange={(e) => setCard({ ...card, cardNo: e.target.value })} required /></Field>
                <Field label="유효기간 (MM/YY)"><input className={inputCls} inputMode="numeric" autoComplete="cc-exp" value={card.exp} onChange={(e) => setCard({ ...card, exp: e.target.value })} required /></Field>
                <Field label="생년월일 6자리 / 사업자번호"><input className={inputCls} inputMode="numeric" value={card.idNo} onChange={(e) => setCard({ ...card, idNo: e.target.value })} /></Field>
                <Field label="비밀번호 앞 2자리"><input className={inputCls} type="password" inputMode="numeric" maxLength={2} value={card.cardPw} onChange={(e) => setCard({ ...card, cardPw: e.target.value })} /></Field>
              </div>
              <Button size="sm" type="submit" disabled={busy}>{data.card ? '카드 바꾸기' : '카드 등록'}</Button>
            </form>
          </div>
          <div className="space-y-3 text-sm">
            <div>
              <p className="text-xs font-semibold text-ink-2">월 구독 (VAT 포함, 현재 인원 기준)</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <select className={cx(inputCls, 'w-auto')} value={plan} onChange={(e) => setPlan(e.target.value)} aria-label="구독할 요금제">
                  <option value="">요금제 선택</option>{monthly.map((q: any) => <option key={q.planCode} value={q.planCode}>{q.name} · 월 {won(q.amount)} ({q.seats}인)</option>)}
                </select>
                <Button size="sm" disabled={!plan || !data.card || busy} onClick={() => subscribe(plan)} data-testid="billing-subscribe">{data.card ? '등록 카드로 결제·자동 결제' : '카드를 먼저 등록하세요'}</Button>
                <Button size="sm" variant="secondary" disabled={!plan || busy} onClick={() => openWindow({ kind: 'monthly', planCode: plan })} data-testid="billing-window-monthly">결제창으로 1개월</Button>
              </div>
              <p className="mt-1 text-[11px] text-ink-3">결제창 결제는 카드 등록 없이 이번 1개월만 — 다음 달부터 자동 결제하려면 카드를 등록하세요.</p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-xs" role="radiogroup" aria-label="결제창 결제 수단" data-testid="billing-paymethod">
              <span className="font-semibold text-ink-2">결제창 결제 수단</span>
              {([['CARD', '카드'], ['BANK', '계좌이체'], ['VBANK', '가상계좌(무통장)']] as const).map(([k, l]) => (
                <button key={k} type="button" role="radio" aria-checked={pm === k} onClick={() => setPm(k)} className={cx('rounded-full border px-2.5 py-0.5', pm === k ? 'border-brand-600 bg-brand-50 font-semibold text-brand-700' : 'border-line text-ink-2')}>{l}</button>
              ))}
              {pm === 'VBANK' && <span className="text-ink-3">계좌를 받은 뒤 3일 안에 입금하면 자동 적용</span>}
            </div>
            <div>
              <p className="text-xs font-semibold text-ink-2">연간 결제 (결제창, 할인가)</p>
              <div className="mt-1 flex flex-wrap gap-1.5">{annual.map((q: any) => <Button key={q.planCode} size="sm" variant="secondary" disabled={busy} onClick={() => openWindow({ kind: 'annual', planCode: q.planCode })}>{q.name} 1년 {won(q.amount)}</Button>)}</div>
            </div>
            <div>
              <p className="text-xs font-semibold text-ink-2">추가 팩 (결제창)</p>
              <div className="mt-1 flex flex-wrap gap-1.5">{data.addons.map((a: any) => <Button key={a.code} size="sm" variant="secondary" disabled={busy} onClick={() => openWindow({ kind: 'addon', addonCode: a.code })}>{a.name} {won(a.amount)}</Button>)}</div>
            </div>
            <div>
              <p className="text-xs font-semibold text-ink-2">결제 내역·영수증</p>
              <ul className="mt-1 divide-y divide-line rounded-input border border-line text-xs" data-testid="billing-payments">
                {data.payments.map((p: any) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-2 px-2 py-1.5">
                    <span className="w-28 shrink-0 text-ink-3">{fmtDateTime(p.paid_at ?? p.created_at)}</span>
                    <span className="flex-1">{KIND[p.kind]} {p.plan_code ?? p.addon_code ?? ''} · {won(p.amount)}{p.pay_method && p.pay_method !== 'CARD' ? ` · ${p.pay_method === 'BANK' ? '계좌이체' : '가상계좌'}` : ''}{p.card_no ? ` · ${p.card_name ?? ''} ${p.card_no}` : ''}
                      {p.status === 'pending' && p.vbank && <span className="block text-amber-700" data-testid="billing-vbank">입금 대기: {p.vbank.bank} {p.vbank.num}{p.vbank.exp ? ` · ${String(p.vbank.exp).slice(0, 4)}-${String(p.vbank.exp).slice(4, 6)}-${String(p.vbank.exp).slice(6, 8)}까지` : ''}</span>}
                      {p.status === 'paid' && p.tid && <a className="ml-1 text-brand-700 underline" href={`https://npg.nicepay.co.kr/issue/IssueLoader.do?TID=${encodeURIComponent(p.tid)}&type=0`} target="_blank" rel="noreferrer">영수증</a>}</span>
                    <span className={cx('rounded-full px-1.5', p.status === 'paid' ? 'bg-green-50 text-green-700' : p.status === 'failed' ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-ink-2')} title={p.result_msg ?? ''}>{STATUS[p.status]}</span>
                  </li>
                ))}
                {!data.payments.length && <li className="px-2 py-2 text-ink-3">아직 결제 내역이 없습니다</li>}
              </ul>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/** 플랫폼 운영: 결제 내역·환불 */
export function PlatformPayments() {
  const { data, reload } = useApi<any>('/api/platform/payments');
  if (!data) return null;
  async function refund(p: any) {
    const left = p.amount - p.canceled_amount;
    const amt = prompt(`환불 금액(원) — 최대 ${left}`, String(left)); if (!amt) return;
    const reason = prompt('환불 사유', '고객 요청'); if (!reason) return;
    try { await api(`/api/platform/payments/${p.id}/refund`, { body: { amount: Number(amt), reason } }); toast.ok('환불했습니다'); reload(); } catch (e: any) { toast.error(e.message); }
  }
  return (
    <section className="rounded-card border border-line bg-white shadow-card" data-testid="platform-payments">
      <h2 className="border-b border-line px-3 py-2 text-sm font-semibold">결제 내역 {data.mode && <span className="text-xs font-normal text-ink-3">나이스페이 {data.mode === 'test' ? '시험' : '실결제'} 모드</span>}{!data.enabled && <span className="text-xs font-normal text-ink-3">결제 미설정</span>}</h2>
      <ul className="max-h-80 divide-y divide-line overflow-y-auto text-xs">
        {data.payments.map((p: any) => (
          <li key={p.id} className="flex flex-wrap items-center gap-2 px-3 py-1.5">
            <span className="w-28 shrink-0 text-ink-3">{fmtDateTime(p.paid_at ?? p.created_at)}</span>
            <span className="min-w-0 flex-1">{p.tenant_name} · {KIND[p.kind]} {p.plan_code ?? p.addon_code ?? ''} · {won(p.amount)}{p.canceled_amount ? ` (환불 ${won(p.canceled_amount)})` : ''}</span>
            <span>{STATUS[p.status]}</span>
            {['paid', 'partial_canceled'].includes(p.status) && <Button size="sm" variant="ghost" onClick={() => refund(p)}>환불</Button>}
          </li>
        ))}
        {!data.payments.length && <li className="px-3 py-2 text-ink-3">결제 내역이 없습니다</li>}
      </ul>
    </section>
  );
}
