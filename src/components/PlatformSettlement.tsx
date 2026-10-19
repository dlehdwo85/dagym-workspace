'use client';
// V32 2 정산(플랫폼 운영): 월 선택 → 집계 카드(총결제·취소·순매출·VAT·PG 수수료 추정·입금 예정) · 수단별/요금제별 · 장부(정산 상태·직접 표시) · 엑셀 ·
// 입금 대사(나이스페이 정산 내역 엑셀/CSV 올리기 → 맞음/차이/장부에 없음) · 미수(던닝) · 세금계산서 요청(발행 체크)
import { useRef, useState } from 'react';
import { Download, FileSpreadsheet, Upload } from 'lucide-react';
import { api, useApi } from '@/components/client';
import { won } from '@/components/usage';
import { Button, cx, fmtDateTime, inputCls, toast } from '@/components/ui';

type Row = { id: string; tenant_name: string; what: string; pay_method_label: string; card_name: string | null; amount: number; canceled_amount: number; net: number; supply: number; vat: number; fee: number; feeEstimated: boolean; deposit: number; paid_at: string | null; created_at: string; expected_on: string | null; settled_on: string | null; settled_amount: number | null; settlement: string; s_note: string | null; test: boolean; tid: string | null };
type Agg = { count: number; gross: number; canceled: number; net: number; supply: number; vat: number; fee: number; deposit: number; settled: number; pending: number; mismatch: number; byMethod: { key: string; count: number; net: number; fee: number; deposit: number }[]; byPlan: { key: string; count: number; net: number; fee: number; deposit: number }[] };
type Data = { month: string; fee: { cardPct: number; bankPct: number; vbankKrw: number; settleDays: number }; summary: Agg; prev: Agg; daily: { day: string; count: number; net: number }[]; ledger: Row[]; late: { tenant: string; name: string; plan_code: string; unpaid: number; days: number; retry_count: number; next_retry_on: string | null; billing_lock: string | null; owner_email: string | null }[]; taxOpen: number };
const S: Record<string, [string, string]> = { pending: ['대기', 'bg-slate-100 text-ink-2'], settled: ['정산 완료', 'bg-emerald-50 text-emerald-700'], mismatch: ['차이', 'bg-red-50 text-red-700'], canceled: ['취소', 'bg-slate-100 text-ink-3'] };
const thisMonth = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
const shift = (m: string, n: number) => { const d = new Date(`${m}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 7); };
const diff = (a: number, b: number) => (b ? `${a >= b ? '+' : ''}${Math.round(((a - b) / b) * 100)}%` : a ? '신규' : '—');
const toBase64 = (f: File) => new Promise<string>((ok, fail) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] ?? ''); r.onerror = () => fail(r.error); r.readAsDataURL(f); });

export function PlatformSettlement() {
  const [month, setMonth] = useState(thisMonth());
  const [test, setTest] = useState(false);
  const [tab, setTab] = useState<'ledger' | 'late' | 'tax' | 'uploads'>('ledger');
  const st = useApi<Data>(`/api/platform/settlement?month=${month}${test ? '&test=1' : ''}`, [month, test]);
  const d = st.data;
  if (!d && !st.error) return null;
  if (!d) return null;
  const s = d.summary;
  const mark = async (r: Row, status: 'settled' | 'pending') => {
    try { await api(`/api/platform/settlement/${r.id}`, { method: 'PATCH', body: { status, settledOn: status === 'settled' ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date()) : null } }); toast.ok(status === 'settled' ? '정산 완료로 표시했습니다' : '대기로 되돌렸습니다'); st.reload(); } catch (e: any) { toast.error(e.message); }
  };
  return (
    <section className="rounded-card border border-line bg-white shadow-card" data-testid="platform-settlement">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <h2 className="text-sm font-semibold">정산</h2>
        <div className="inline-flex items-center gap-1 text-xs"><button className="rounded px-1.5 py-0.5 hover:bg-slate-100" onClick={() => setMonth(shift(month, -1))} aria-label="이전 달">‹</button><b data-testid="settle-month">{month}</b><button className="rounded px-1.5 py-0.5 hover:bg-slate-100" onClick={() => setMonth(shift(month, 1))} aria-label="다음 달">›</button></div>
        <label className="inline-flex items-center gap-1 text-xs text-ink-2"><input type="checkbox" checked={test} onChange={(e) => setTest(e.target.checked)} />시험 결제 포함</label>
        <span className="ml-auto text-[11px] text-ink-3">수수료 추정: 카드 {d.fee.cardPct}% · 계좌이체 {d.fee.bankPct}% · 가상계좌 {won(d.fee.vbankKrw)}/건 · 정산 D+{d.fee.settleDays} 영업일 — 실제 값은 대사 파일로 들어옵니다</span>
        <a href={`/api/platform/settlement/export?month=${month}${test ? '&test=1' : ''}`} className="inline-flex h-7 items-center gap-1 rounded-input border border-line bg-white px-2.5 text-xs hover:bg-slate-50" data-testid="settle-export"><Download className="size-3.5" />엑셀</a>
      </div>
      <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 lg:grid-cols-6" data-testid="settle-summary">
        {([['총결제', s.gross, d.prev.gross, `${s.count}건`], ['취소·환불', s.canceled, d.prev.canceled, ''], ['순매출', s.net, d.prev.net, `공급가 ${won(s.supply)}`], ['부가세', s.vat, d.prev.vat, ''], ['PG 수수료(추정)', s.fee, d.prev.fee, ''], ['입금 예정액', s.deposit, d.prev.deposit, `정산 완료 ${s.settled} · 대기 ${s.pending}${s.mismatch ? ` · 차이 ${s.mismatch}` : ''}`]] as [string, number, number, string][]).map(([t, v, pv, sub]) => (
          <div key={t} className="rounded-input border border-line p-2"><div className="text-[11px] text-ink-2">{t}</div><div className="text-base font-bold tabular-nums">{won(v)}</div><div className="text-[11px] text-ink-3">전월 {diff(v, pv)}{sub ? ` · ${sub}` : ''}</div></div>
        ))}
      </div>
      <div className="grid gap-3 px-3 pb-3 text-xs sm:grid-cols-2">
        {([['결제 수단별', s.byMethod], ['요금제별', s.byPlan]] as const).map(([t, list]) => (
          <div key={t}><h3 className="mb-1 font-semibold text-ink-2">{t}</h3>
            {!list.length ? <p className="text-ink-3">이 달 결제가 없습니다</p> : <table className="w-full"><thead><tr className="text-left text-ink-3"><th className="py-0.5">구분</th><th className="text-right">건수</th><th className="text-right">순매출</th><th className="text-right">수수료</th><th className="text-right">입금 예정</th></tr></thead>
              <tbody>{list.map((b) => <tr key={b.key} className="border-t border-line"><td className="py-0.5">{b.key}</td><td className="text-right tabular-nums">{b.count}</td><td className="text-right tabular-nums">{won(b.net)}</td><td className="text-right tabular-nums">{won(b.fee)}</td><td className="text-right tabular-nums">{won(b.deposit)}</td></tr>)}</tbody></table>}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 border-t border-line px-3 py-2" role="tablist">
        {([['ledger', `장부 ${d.ledger.length}`], ['late', `미수 ${d.late.length}`], ['tax', `세금계산서 ${d.taxOpen ? `요청 ${d.taxOpen}` : ''}`], ['uploads', '대사 기록']] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cx('rounded-full border px-3 py-1 text-xs font-medium', tab === k ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-white text-ink-2')} data-testid={`settle-tab-${k}`}>{l}</button>)}
        {tab === 'ledger' && <Reconcile onDone={() => st.reload()} />}
      </div>
      {tab === 'ledger' && (
        <div className="max-h-96 overflow-auto px-3 pb-3">
          <table className="w-full min-w-[900px] text-xs" data-testid="settle-ledger">
            <thead><tr className="text-left text-ink-3"><th className="py-1">결제일시</th><th>회사</th><th>내용</th><th>수단</th><th className="text-right">결제</th><th className="text-right">취소</th><th className="text-right">순매출</th><th className="text-right">VAT</th><th className="text-right">수수료</th><th className="text-right">입금 예정</th><th>정산 예정</th><th>정산</th><th></th></tr></thead>
            <tbody>
              {d.ledger.map((r) => { const [sl, cls] = S[r.settlement] ?? [r.settlement, '']; return (
                <tr key={r.id} className={cx('border-t border-line', r.test && 'text-ink-3')} data-testid="settle-row" data-settlement={r.settlement}>
                  <td className="py-1 whitespace-nowrap">{fmtDateTime(r.paid_at ?? r.created_at)}</td><td>{r.tenant_name}{r.test && ' (시험)'}</td><td>{r.what}</td><td>{r.pay_method_label}{r.card_name ? ` ${r.card_name}` : ''}</td>
                  <td className="text-right tabular-nums">{won(r.amount)}</td><td className="text-right tabular-nums">{r.canceled_amount ? won(r.canceled_amount) : ''}</td><td className="text-right tabular-nums">{won(r.net)}</td><td className="text-right tabular-nums">{won(r.vat)}</td>
                  <td className="text-right tabular-nums" title={r.feeEstimated ? '추정' : '실제(대사)'}>{won(r.fee)}{r.feeEstimated && <span className="text-ink-3">*</span>}</td><td className="text-right tabular-nums">{won(r.deposit)}</td>
                  <td className="whitespace-nowrap">{r.expected_on ?? ''}</td>
                  <td><span className={cx('rounded px-1.5 py-0.5', cls)} title={r.s_note ?? ''}>{sl}</span>{r.settled_on && <span className="ml-1 text-ink-3">{r.settled_on}</span>}</td>
                  <td className="whitespace-nowrap">{r.net > 0 && (r.settlement === 'settled' ? <button className="text-ink-3 underline" onClick={() => mark(r, 'pending')}>대기로</button> : <button className="text-brand-700 underline" onClick={() => mark(r, 'settled')} data-testid="settle-mark">정산 완료</button>)}</td>
                </tr>); })}
              {!d.ledger.length && <tr><td colSpan={13} className="py-3 text-center text-ink-3">이 달 결제가 없습니다</td></tr>}
            </tbody>
          </table>
          <p className="mt-1 text-[11px] text-ink-3">* 수수료 추정치. 입금 대사 파일을 올리면 실제 수수료·입금일로 바뀝니다.</p>
        </div>
      )}
      {tab === 'late' && (
        <ul className="divide-y divide-line px-3 pb-3 text-xs" data-testid="settle-late">
          {d.late.map((l) => <li key={l.tenant} className="flex flex-wrap items-center gap-2 py-1.5"><b>{l.name}</b><span>{l.plan_code}</span><span className="text-red-700">미납 {won(l.unpaid)} · {l.days}일</span><span className="text-ink-3">재시도 {l.retry_count}회{l.next_retry_on ? ` · 다음 ${l.next_retry_on}` : ''}{l.billing_lock ? ` · ${l.billing_lock === 'read_only' ? '읽기 전용' : '이용 중지'}` : ''}</span>{l.owner_email && <a href={`mailto:${l.owner_email}`} className="ml-auto text-brand-700 underline">{l.owner_email}</a>}</li>)}
          {!d.late.length && <li className="py-2 text-ink-3">미납 회사가 없습니다</li>}
        </ul>
      )}
      {tab === 'tax' && <TaxInvoices />}
      {tab === 'uploads' && <Uploads />}
    </section>
  );
}

function Reconcile({ onDone }: { onDone: () => void }) {
  const inp = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ counts: { rows: number; matched: number; mismatched: number; unmatched: number }; rows: { row: number; status: string; tid?: string; moid?: string; amount: number | null; settled: number | null; note?: string }[] } | null>(null);
  async function pick(f: File | undefined) {
    if (!f) return;
    setBusy(true);
    try { const r = await api('/api/platform/settlement/reconcile', { body: { fileName: f.name, data: await toBase64(f) } }); setRes(r); toast.ok(`맞음 ${r.counts.matched} · 차이 ${r.counts.mismatched} · 장부에 없음 ${r.counts.unmatched}`); onDone(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); if (inp.current) inp.current.value = ''; }
  }
  return (
    <span className="ml-auto inline-flex items-center gap-2">
      <input ref={inp} type="file" accept=".xlsx,.csv,.txt" className="hidden" onChange={(e) => pick(e.target.files?.[0])} data-testid="settle-file" />
      <Button size="sm" variant="secondary" onClick={() => inp.current?.click()} disabled={busy}><Upload />입금 내역 올리기(대사)</Button>
      {res && <span className="text-xs text-ink-2" data-testid="settle-recon-result">맞음 {res.counts.matched} · 차이 {res.counts.mismatched} · 장부에 없음 {res.counts.unmatched}{res.rows.filter((r) => r.status !== 'settled').slice(0, 3).map((r) => <span key={r.row} className="ml-1 text-amber-700">[{r.row}줄 {r.note}]</span>)}</span>}
    </span>
  );
}

function TaxInvoices() {
  const st = useApi<{ requests: any[] }>('/api/platform/tax-invoices');
  if (!st.data) return null;
  const mark = async (id: string, status: string) => { try { await api(`/api/platform/tax-invoices/${id}`, { method: 'PATCH', body: { status } }); toast.ok(status === 'issued' ? '발행 완료로 표시했습니다' : '되돌렸습니다'); st.reload(); } catch (e: any) { toast.error(e.message); } };
  return (
    <ul className="divide-y divide-line px-3 pb-3 text-xs" data-testid="settle-tax">
      {st.data.requests.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center gap-2 py-1.5" data-testid="tax-row" data-status={r.status}>
          <label className="inline-flex items-center gap-1"><input type="checkbox" checked={r.status === 'issued'} onChange={(e) => mark(r.id, e.target.checked ? 'issued' : 'requested')} aria-label="발행 완료" data-testid="tax-issued" />발행</label>
          <b>{r.tenant_name}</b><span>{r.company_name} · {r.biz_no}{r.ceo ? ` · ${r.ceo}` : ''}</span><span className="text-ink-2">{r.email}</span><span className="tabular-nums">{won(r.amount)}</span>
          <span className="text-ink-3">{r.plan_code ?? r.kind} · 결제 {r.paid_at ? fmtDateTime(r.paid_at) : ''} · 요청 {fmtDateTime(r.created_at)}{r.requested_by_name ? ` · ${r.requested_by_name}` : ''}{r.issued_at ? ` · 발행 ${fmtDateTime(r.issued_at)}` : ''}</span>
          {r.status !== 'canceled' && <button className="ml-auto text-ink-3 underline" onClick={() => mark(r.id, 'canceled')}>취소</button>}
        </li>
      ))}
      {!st.data.requests.length && <li className="py-2 text-ink-3">세금계산서 요청이 없습니다 — 고객이 사용량·요금제 › 결제 내역에서 요청하면 여기 쌓입니다. 발행은 홈택스에서 하고 여기서 체크합니다.</li>}
    </ul>
  );
}

function Uploads() {
  const st = useApi<{ uploads: any[] }>('/api/platform/settlement/uploads');
  if (!st.data) return null;
  return (
    <ul className="divide-y divide-line px-3 pb-3 text-xs" data-testid="settle-uploads">
      {st.data.uploads.map((u) => <li key={u.id} className="flex flex-wrap items-center gap-2 py-1.5"><FileSpreadsheet className="size-3.5 text-ink-3" /><span>{u.file_name}</span><span className="text-ink-2">{u.rows}줄 · 맞음 {u.matched} · 차이 {u.mismatched} · 장부에 없음 {u.unmatched}</span><span className="ml-auto text-ink-3">{u.by} · {fmtDateTime(u.created_at)}</span></li>)}
      {!st.data.uploads.length && <li className="py-2 text-ink-3">아직 올린 대사 파일이 없습니다</li>}
    </ul>
  );
}

/** 고객 화면(사용량·요금제 결제 내역): 결제 건에 세금계산서 요청 */
export function TaxInvoiceButton({ payment }: { payment: { id: string; status: string } }) {
  const ok = ['paid', 'partial_canceled'].includes(payment.status);
  const st = useApi<{ requests: { payment_id: string; status: string }[]; defaults: { companyName: string; bizNo: string | null; ceo: string | null; address: string | null; email: string } | null }>(ok ? '/api/billing/tax-invoice' : null);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<{ companyName: string; bizNo: string; ceo: string; address: string; email: string } | null>(null);
  if (!ok || !st.data?.defaults) return null; // 관리자(회사 정보 기본값이 오는 사람)만
  const mine = st.data?.requests.find((r) => r.payment_id === payment.id && r.status !== 'canceled');
  if (mine) return <span className="text-[11px] text-ink-3" data-testid="tax-state">{mine.status === 'issued' ? '세금계산서 발행됨' : '세금계산서 요청됨'}</span>;
  const start = () => { const d = st.data?.defaults; setF({ companyName: d?.companyName ?? '', bizNo: d?.bizNo ?? '', ceo: d?.ceo ?? '', address: d?.address ?? '', email: d?.email ?? '' }); setOpen(true); };
  const send = async () => { try { await api('/api/billing/tax-invoice', { body: { paymentId: payment.id, ...f, ceo: f?.ceo || undefined, address: f?.address || undefined } }); toast.ok('세금계산서를 요청했습니다 — 운영자가 발행 후 메일로 보내 드립니다'); setOpen(false); st.reload(); } catch (e: any) { toast.error(e.message); } };
  return (
    <>
      <button className="text-[11px] text-brand-700 underline" onClick={start} data-testid="tax-request">세금계산서</button>
      {open && f && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" role="dialog" aria-label="세금계산서 요청">
          <div className="w-full max-w-sm space-y-2 rounded-card bg-white p-4 text-sm shadow-xl" data-testid="tax-form">
            <h3 className="font-semibold">세금계산서 요청</h3>
            <input className={inputCls} value={f.companyName} onChange={(e) => setF({ ...f, companyName: e.target.value })} placeholder="상호" aria-label="상호" data-testid="tax-company" />
            <input className={inputCls} value={f.bizNo} onChange={(e) => setF({ ...f, bizNo: e.target.value })} placeholder="사업자등록번호 000-00-00000" aria-label="사업자등록번호" data-testid="tax-bizno" />
            <input className={inputCls} value={f.ceo} onChange={(e) => setF({ ...f, ceo: e.target.value })} placeholder="대표자(선택)" aria-label="대표자" />
            <input className={inputCls} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} placeholder="사업장 주소(선택)" aria-label="사업장 주소" />
            <input className={inputCls} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="받을 이메일" aria-label="받을 이메일" data-testid="tax-email" />
            <p className="text-[11px] text-ink-3">발행은 운영자가 홈택스에서 처리한 뒤 이 이메일로 보내 드립니다.</p>
            <div className="flex justify-end gap-2"><Button size="sm" variant="secondary" onClick={() => setOpen(false)}>취소</Button><Button size="sm" onClick={send} disabled={!f.companyName.trim() || !f.bizNo.trim() || !f.email.trim()} data-testid="tax-send">요청</Button></div>
          </div>
        </div>
      )}
    </>
  );
}
