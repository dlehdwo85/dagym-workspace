'use client';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, CheckCircle2, CircleDashed, Clock, FlaskConical, Loader2, RotateCcw, Settings2, XCircle } from 'lucide-react';
import { api, useApi } from './client';
import { launchNicepay } from './Billing';
import { Button, cx, fmtDateTime, inputCls, toast } from './ui';
import { won } from './usage';

/**
 * 결제 시험(플랫폼 운영자) — 192차(대표 10/27 "결제 시험회사 숨겨도 됩니다. 결제 모듈 상태가 정상인지만 표기하는 걸 냅두고 그 밑에 테스트만 냅둡니다.
 * 굳이 테스트 결제 회사를 추가해야 할 이유를 모르겠네요."): 위 = 결제 모듈 상태, 아래 = [시험 결제]만.
 * 시험 결제는 숨은 시험 계정 하나로 — 회사 목록·만들기·지우기 없음, 다음 시험 전에 지난 시험 결제는 자동 취소(요금제도 결제 전으로).
 * 승인 뒤 자동 확인·[시험 결제 취소](원복 확인)는 그대로. 시험 카드 번호 입력은 대표가 직접.
 */
type Check = { key: string; label: string; state: 'ok' | 'fail' | 'wait' | 'later'; detail?: string };
type Status = {
  state: 'ok' | 'warn' | 'setup'; mode: 'live' | 'test' | 'off'; liveKeys: boolean; reasons: string[]; ok7: number; fail7: number; lastPaid: string | null;
  lastFail: { msg: string | null; at: string } | null; lastTest: { id: string; status: string; at: string; msg: string | null; live: boolean } | null;
};
type Pay = { id: string; plan_code: string | null; addon_code: string | null; amount: number; status: string; live: boolean; result_msg: string | null; paid_at: string | null; created_at: string };
type Home = { status: Status; payments: Pay[]; plans: { code: string; name: string }[]; liveAvailable?: boolean };
const ICON = { ok: <CheckCircle2 className="size-4 text-emerald-600" />, fail: <XCircle className="size-4 text-red-600" />, wait: <Clock className="size-4 text-ink-3" />, later: <CircleDashed className="size-4 text-ink-3" /> };
const ST: Record<string, string> = { pending: '대기', paid: '결제 완료', failed: '실패', canceled: '취소', partial_canceled: '부분 취소' };
const STATE = {
  ok: { label: '정상', box: 'border-emerald-200 bg-emerald-50', title: 'text-emerald-800', icon: <CheckCircle2 className="size-5 shrink-0 text-emerald-600" /> },
  warn: { label: '확인 필요', box: 'border-amber-200 bg-amber-50', title: 'text-amber-900', icon: <AlertTriangle className="size-5 shrink-0 text-amber-600" /> },
  setup: { label: '설정 필요', box: 'border-red-200 bg-red-50', title: 'text-red-800', icon: <Settings2 className="size-5 shrink-0 text-red-600" /> },
} as const;
const MODE = { live: '실 상점 — 실제로 청구됩니다', test: '시험 상점 — 고객 결제도 실제로 청구되지 않습니다', off: '꺼짐' } as const;

export function PayTest() {
  const sp = useSearchParams();
  const home = useApi<Home>('/api/platform/pay-test');
  const [checkId, setCheckId] = useState<string | null>(sp.get('check'));
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState<{ plan: string; kind: 'monthly' | 'annual'; pm: 'CARD' | 'BANK' | 'VBANK' | 'naverpay' | 'kakaopay' | 'tosspay' }>({ plan: '', kind: 'monthly', pm: 'CARD' });
  // 200차 #706: 간편결제 바로 열기(나이스페이 결제창 생략) — 켜기(NICEPAY_EASY_PAY) 전에 상점이 그 간편결제를 쓸 수 있는지 시험
  const easy = pick.pm === 'naverpay' || pick.pm === 'kakaopay' || pick.pm === 'tosspay';
  // #413: PC 레이어(iframe)가 열리자마자 닫히는 환경 — 나이스페이 모바일 방식(MobileYN=Y)으로 같은 탭 이동. 바로 닫히면 자동으로 켠다
  const [pageMode, setPageMode] = useState(false);
  const [lastClose, setLastClose] = useState<{ code: string; message: string; quick: boolean; at: string } | null>(null);
  const launch = (r: any) => launchNicepay(r, { page: pageMode, onClose: (i) => { setLastClose({ ...i, at: new Date().toLocaleTimeString('ko-KR') }); if (i.quick) setPageMode(true); } });
  useEffect(() => {
    if (sp.get('tab') === 'paytest') document.getElementById('paytest')?.scrollIntoView({ block: 'start' });
    const f = sp.get('payfail'); if (f) toast.error(`결제 실패: ${f}`);
  }, [sp]);
  const plan = pick.plan || home.data?.plans[0]?.code || '';
  async function pay() {
    if (!plan) return;
    setBusy(true);
    try {
      const r = await api(`/api/platform/pay-test/tester/window`, { body: { kind: pick.kind, planCode: plan, ...(easy ? { payMethod: 'CARD', easyPay: pick.pm, agree: true } : { payMethod: pick.pm }) } });
      if (r.mode !== 'test') throw new Error('시험 상점이 아닙니다 — 결제창을 열지 않습니다');
      home.reload();
      await launch(r);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  /** V36 8 실결제 소액 시험(대표 승인) — 실 상점 100원, 1시간 뒤 자동 취소 */
  async function live() {
    const c = prompt('실제 카드로 100원이 결제됩니다(1시간 뒤 자동 취소, 하루 3번까지). 계속하려면 "실결제 100원" 을 입력하세요.');
    if (c === null) return;
    setBusy(true);
    try {
      const r = await api(`/api/platform/pay-test/tester/live`, { body: { confirm: c, ...(easy ? { easyPay: pick.pm } : pick.pm === 'BANK' ? { payMethod: 'BANK' } : {}) } });
      if (r.mode !== 'live' || Number(r.params.Amt) !== 100) throw new Error('실결제 소액 시험 조건이 아닙니다 — 결제창을 열지 않습니다');
      home.reload();
      await launch(r);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  const pays = home.data?.payments ?? [];
  return (
    <section id="paytest" className="rounded-card border border-line bg-white shadow-card" data-testid="pay-test">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold"><FlaskConical className="size-4 text-brand-600" />결제 모듈 · 시험</h2>
        <label className="ml-auto flex items-center gap-1 text-xs text-ink-3" title="결제창(레이어)이 열리자마자 닫히면 켜세요 — 이 탭이 나이스페이 결제 화면으로 이동했다가 결제 뒤 자동 확인 화면으로 돌아옵니다">
          <input type="checkbox" checked={pageMode} onChange={(e) => setPageMode(e.target.checked)} data-testid="pay-test-pagemode" />같은 탭에서 열기
        </label>
      </div>
      {home.data ? <StatusBox s={home.data.status} /> : <p className="p-3 text-sm text-ink-3"><Loader2 className="inline size-4 animate-spin" /> 결제 모듈 상태 확인 중…</p>}
      {lastClose && (
        <p className="border-y border-line bg-amber-50 px-3 py-1.5 text-xs text-amber-900" data-testid="pay-test-closed">
          {lastClose.at} 결제창이 닫혔습니다 — {lastClose.message || (lastClose.quick ? '나이스페이가 바로 닫음(사유 없음)' : '취소')}{lastClose.code ? ` (${lastClose.code})` : ''}
          {lastClose.quick && ' · 같은 탭에서 열기를 켰습니다. 다시 눌러 보세요'}
        </p>
      )}
      {checkId && <CheckPanel id={checkId} onClose={() => setCheckId(null)} onChanged={home.reload} />}
      <div className="space-y-2 border-t border-line p-3" data-testid="pay-test-run">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">시험 결제<span className="rounded bg-amber-100 px-1.5 text-[11px] font-normal text-amber-800">늘 시험 상점 — 실제로 청구되지 않음</span></p>
        <div className="flex flex-wrap items-center gap-1.5">
          <select className={cx(inputCls, 'h-8 !w-auto py-0 text-xs')} value={plan} onChange={(e) => setPick({ ...pick, plan: e.target.value })} aria-label="요금제">
            {home.data?.plans.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
          </select>
          <select className={cx(inputCls, 'h-8 !w-auto py-0 text-xs')} value={pick.kind} onChange={(e) => setPick({ ...pick, kind: e.target.value as never })} aria-label="주기"><option value="monthly">월</option><option value="annual">연간</option></select>
          <select className={cx(inputCls, 'h-8 !w-auto py-0 text-xs')} value={pick.pm} onChange={(e) => setPick({ ...pick, pm: e.target.value as never })} aria-label="결제 수단"><option value="CARD">카드</option><option value="BANK">계좌이체</option><option value="VBANK">가상계좌</option><option value="naverpay">네이버페이(바로)</option><option value="kakaopay">카카오페이(바로)</option><option value="tosspay">토스페이(바로)</option></select>
          <Button size="sm" onClick={pay} disabled={busy || !plan} data-testid="pay-test-open">시험 결제창 열기</Button>
          {home.data?.liveAvailable && <Button size="sm" variant="danger" onClick={live} disabled={busy} data-testid="pay-live-open">실결제 100원 시험</Button>}
        </div>
        <p className="text-xs text-ink-3">회사를 따로 만들지 않습니다 — 숨은 시험 계정 하나로 결제하고, 다음 시험 전에 지난 시험 결제는 자동으로 취소합니다(요금제도 결제 전으로). 승인 1시간 뒤에도 자동 취소됩니다.</p>
      </div>
      <div className="border-t border-line p-3" data-testid="pay-test-recent">
        <p className="mb-1 text-xs font-medium text-ink-2">최근 시험 결제</p>
        {pays.length ? (
          <ul className="space-y-0.5 text-xs">
            {pays.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2" data-testid="pay-test-row">
                <span className="text-ink-3">{fmtDateTime(p.paid_at ?? p.created_at)}</span>
                <span>{p.live ? <b className="text-red-700">실결제 100원</b> : p.plan_code ?? p.addon_code} · {won(p.amount)} · {ST[p.status] ?? p.status}{p.status === 'failed' && p.result_msg ? ` — ${p.result_msg}` : ''}</span>
                <button type="button" className="text-brand-600 underline" onClick={() => setCheckId(p.id)}>확인</button>
              </li>
            ))}
          </ul>
        ) : <p className="text-xs text-ink-3">{home.data ? '아직 시험 결제가 없습니다 — [시험 결제창 열기]' : ''}</p>}
      </div>
    </section>
  );
}

/** 결제 모듈 상태 — 정상·확인 필요·설정 필요 + 운영 결제 방식 · 최근 7일 실제 결제 · 마지막 승인 · 마지막 시험 */
function StatusBox({ s }: { s: Status }) {
  const st = STATE[s.state];
  return (
    <div className={cx('m-3 rounded-lg border p-3', st.box)} data-testid="pay-status" data-state={s.state} data-mode={s.mode}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {st.icon}<b className={cx('text-sm', st.title)}>결제 모듈 {st.label}</b>
        <span className="text-xs text-ink-2" data-testid="pay-status-mode">운영 결제: {MODE[s.mode]}</span>
      </div>
      {s.reasons.length > 0 && <ul className={cx('mt-1 list-disc space-y-0.5 pl-6 text-xs', st.title)} data-testid="pay-status-reasons">{s.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
      <dl className="mt-2 grid gap-x-4 gap-y-0.5 text-xs text-ink-2 sm:grid-cols-3">
        <div><dt className="inline text-ink-3">최근 7일 실제 결제 </dt><dd className="inline" data-testid="pay-status-week">승인 {s.ok7}건 · 실패 {s.fail7}건</dd></div>
        <div><dt className="inline text-ink-3">마지막 승인 </dt><dd className="inline">{s.lastPaid ? fmtDateTime(s.lastPaid) : '없음'}</dd></div>
        <div><dt className="inline text-ink-3">마지막 시험 </dt><dd className="inline" data-testid="pay-status-test">{s.lastTest ? `${fmtDateTime(s.lastTest.at)} · ${s.lastTest.live ? '실결제 100원 · ' : ''}${ST[s.lastTest.status] ?? s.lastTest.status}` : '없음'}</dd></div>
      </dl>
    </div>
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
  if (!c.data) return <div className="border-t border-line p-3 text-sm text-ink-3"><Loader2 className="inline size-4 animate-spin" /> 확인 중…</div>;
  const p = c.data.payment;
  return (
    <div className="space-y-2 border-t border-line bg-slate-50 p-3" data-testid="pay-test-check">
      <div className="flex flex-wrap items-center gap-2 text-sm"><b>시험 결제 자동 확인</b><span className="text-ink-2">{p.plan} · {won(p.amount)} · {ST[p.status] ?? p.status}</span>
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
