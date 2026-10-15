'use client';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, CircleDashed, Clock, FlaskConical, Loader2, Plus, RotateCcw, XCircle } from 'lucide-react';
import { api, useApi } from './client';
import { launchNicepay } from './Billing';
import { Button, cx, fmtDateTime, inputCls, toast } from './ui';
import { won } from './usage';

/**
 * V32 1 결제 시험(플랫폼 운영자): 로그인 계정 없는 시험 회사 → 시험 상점 결제창(실 MID 안 씀) → 승인 뒤 자동 확인 → [시험 결제 취소]로 원복 확인.
 * 시험 카드 번호 입력은 대표가 직접. 시험 회사는 가입 퍼널·매출 집계·자동 결제에서 빠진다.
 */
type Check = { key: string; label: string; state: 'ok' | 'fail' | 'wait' | 'later'; detail?: string };
const ICON = { ok: <CheckCircle2 className="size-4 text-emerald-600" />, fail: <XCircle className="size-4 text-red-600" />, wait: <Clock className="size-4 text-ink-3" />, later: <CircleDashed className="size-4 text-ink-3" /> };
const ST: Record<string, string> = { pending: '대기', paid: '결제 완료', failed: '실패', canceled: '취소', partial_canceled: '부분 취소' };

export function PayTest() {
  const sp = useSearchParams();
  const list = useApi<{ tenants: any[]; plans: { code: string; name: string }[] }>('/api/platform/pay-test');
  const [checkId, setCheckId] = useState<string | null>(sp.get('check'));
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState<Record<string, { plan: string; kind: 'monthly' | 'annual'; pm: 'CARD' | 'BANK' | 'VBANK' }>>({});
  useEffect(() => {
    if (sp.get('tab') === 'paytest') document.getElementById('paytest')?.scrollIntoView({ block: 'start' });
    const f = sp.get('payfail'); if (f) toast.error(`결제 실패: ${f}`);
  }, [sp]);
  async function create() {
    setBusy(true);
    try { await api('/api/platform/pay-test', { body: {} }); list.reload(); toast.ok('결제 시험 회사를 만들었습니다'); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  async function pay(t: any) {
    const o = pick[t.id] ?? { plan: list.data?.plans[0]?.code ?? '', kind: 'monthly', pm: 'CARD' };
    if (!o.plan) return;
    setBusy(true);
    try {
      const r = await api(`/api/platform/pay-test/${t.id}/window`, { body: { kind: o.kind, planCode: o.plan, payMethod: o.pm } });
      if (r.mode !== 'test') throw new Error('시험 상점이 아닙니다 — 결제창을 열지 않습니다');
      await launchNicepay(r);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  return (
    <section id="paytest" className="rounded-card border border-line bg-white shadow-card" data-testid="pay-test">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold"><FlaskConical className="size-4 text-brand-600" />결제 시험</h2>
        <span className="rounded bg-amber-100 px-1.5 text-[11px] text-amber-800">늘 시험 상점 — 실제로 청구되지 않음</span>
        <Button size="sm" variant="secondary" className="ml-auto" onClick={create} disabled={busy} data-testid="pay-test-create"><Plus />결제 시험 회사 만들기</Button>
      </div>
      {checkId && <CheckPanel id={checkId} onClose={() => setCheckId(null)} onChanged={list.reload} />}
      <ul className="divide-y divide-line text-sm">
        {(list.data?.tenants ?? []).map((t) => {
          const o = pick[t.id] ?? { plan: list.data?.plans[0]?.code ?? '', kind: 'monthly' as const, pm: 'CARD' as const };
          const set = (p: Partial<typeof o>) => setPick({ ...pick, [t.id]: { ...o, ...p } });
          return (
            <li key={t.id} className="space-y-2 p-3" data-testid="pay-test-tenant">
              <div className="flex flex-wrap items-center gap-2">
                <b className="font-medium">{t.name}</b><span className="text-xs text-ink-3">{t.id} · 지금 {t.plan_code} · {t.status}{t.billing_cycle ? ` · ${t.billing_cycle}` : ''}</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <select className={cx(inputCls, 'h-8 w-auto py-0 text-xs')} value={o.plan} onChange={(e) => set({ plan: e.target.value })} aria-label="요금제">
                  {list.data?.plans.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
                </select>
                <select className={cx(inputCls, 'h-8 w-auto py-0 text-xs')} value={o.kind} onChange={(e) => set({ kind: e.target.value as never })} aria-label="주기"><option value="monthly">월</option><option value="annual">연간</option></select>
                <select className={cx(inputCls, 'h-8 w-auto py-0 text-xs')} value={o.pm} onChange={(e) => set({ pm: e.target.value as never })} aria-label="결제 수단"><option value="CARD">카드</option><option value="BANK">계좌이체</option><option value="VBANK">가상계좌</option></select>
                <Button size="sm" onClick={() => pay(t)} disabled={busy} data-testid="pay-test-open">이 회사로 결제창 열기</Button>
              </div>
              {(t.payments ?? []).length > 0 && (
                <ul className="space-y-0.5 text-xs">
                  {t.payments.map((p: any) => (
                    <li key={p.id} className="flex flex-wrap items-center gap-2">
                      <span className="text-ink-3">{fmtDateTime(p.paid_at ?? p.created_at)}</span><span>{p.plan_code ?? p.addon_code} · {won(p.amount)} · {ST[p.status] ?? p.status}</span>
                      <button type="button" className="text-brand-600 underline" onClick={() => setCheckId(p.id)}>확인</button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
        {list.data && !list.data.tenants.length && <li className="p-3 text-ink-3">시험 회사가 없습니다 — [결제 시험 회사 만들기]</li>}
      </ul>
    </section>
  );
}

function CheckPanel({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const c = useApi<{ payment: any; checks: Check[] }>(`/api/platform/pay-test/check?payment=${id}`, [id]);
  const [busy, setBusy] = useState(false);
  async function cancel() {
    if (!c.data || !confirm('이 시험 결제를 취소하고 요금제를 결제 전으로 되돌릴까요?')) return;
    setBusy(true);
    try { await api(`/api/platform/payments/${id}/refund`, { body: { reason: '시험 결제 취소', revertPlan: true } }); toast.ok('취소했습니다'); c.reload(); onChanged(); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  if (!c.data) return <div className="p-3 text-sm text-ink-3"><Loader2 className="inline size-4 animate-spin" /> 확인 중…</div>;
  const p = c.data.payment;
  return (
    <div className="space-y-2 border-b border-line bg-slate-50 p-3" data-testid="pay-test-check">
      <div className="flex flex-wrap items-center gap-2 text-sm"><b>{p.tenantName}</b><span className="text-ink-2">{p.plan} · {won(p.amount)} · {ST[p.status] ?? p.status}</span>
        <button type="button" className="ml-auto text-xs text-ink-3 underline" onClick={onClose}>닫기</button></div>
      {p.vbank && p.status === 'pending' && <p className="text-xs text-amber-800">가상계좌 {p.vbank.bank} {p.vbank.num} — 입금 통보가 오면 결제 완료로 바뀝니다</p>}
      <ul className="grid gap-1 sm:grid-cols-2">
        {c.data.checks.map((k) => (
          <li key={k.key} className="flex items-start gap-1.5 text-sm" data-testid={`check-${k.key}`} data-state={k.state}>{ICON[k.state]}<span><b className="font-medium">{k.label}</b>{k.detail && <span className="block text-xs text-ink-3">{k.detail}</span>}</span></li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" onClick={() => c.reload()}><RotateCcw />다시 확인</Button>
        {['paid', 'partial_canceled'].includes(p.status) && <Button size="sm" variant="danger" onClick={cancel} disabled={busy} data-testid="pay-test-cancel">시험 결제 취소(원복 확인)</Button>}
      </div>
    </div>
  );
}
