'use client';
// V19 2장 견적서 목록 + 직접 만들기(AI 비서 "○○에 견적서 만들어줘"도 같은 API). 금액은 서버가 계산, A4 1페이지 고정.
import { useState } from 'react';
import Link from 'next/link';
import { FileText, Plus, Trash2 } from 'lucide-react';
import { api, useApi } from '@/components/client';
import { Button, ErrorBox, Field, Modal, PageHeader, Skeleton, cx, fmtDateTime, inputCls, toast } from '@/components/ui';

type Q = { id: string; company_key: string; company_name: string; quote_no: string; to_name: string; total: string; valid_until: string; status: string; sent_via: string | null; sent_at: string | null; created_at: string; task_id: string | null; task_title: string | null; created_by_name: string };
type Item = { name: string; spec: string; qty: string; unitPrice: string };
const won = (n: number | string) => Number(n).toLocaleString('ko-KR');
const VIA: Record<string, string> = { share: '공유', mail: '메일', sms: '문자', download: '내려받기', kakao: '카카오톡' };

export default function QuotesPage() {
  const [company, setCompany] = useState('');
  const list = useApi<{ quotes: Q[]; canSend: boolean }>(`/api/quotes${company ? `?company=${company}` : ''}`);
  const tpl = useApi<{ templates: { id: string; company: string; name: string; isDefault: boolean }[]; companies: { key: string; name: string; isDefault: boolean }[] }>('/api/quotes/templates');
  const [open, setOpen] = useState(false);
  return (
    <div className="mx-auto max-w-5xl space-y-3" data-testid="quotes-page">
      <PageHeader title="견적서" icon={FileText} sub="AI 비서에게 “○○에 견적서 만들어줘”라고 하거나 여기서 직접 만듭니다. 금액은 서버가 계산하고 A4 한 장으로 고정됩니다."
        actions={<Button onClick={() => setOpen(true)} data-testid="quote-new"><Plus />새 견적서</Button>} />
      {tpl.data && tpl.data.companies.length > 1 && (
        <div className="flex flex-wrap gap-1.5" role="tablist">
          <button role="tab" aria-selected={!company} onClick={() => setCompany('')} className={cx('rounded-full border px-3 py-1 text-xs font-medium', !company ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-white text-ink-2')}>전체</button>
          {tpl.data.companies.map((c) => <button key={c.key} role="tab" aria-selected={company === c.key} onClick={() => setCompany(c.key)} className={cx('rounded-full border px-3 py-1 text-xs font-medium', company === c.key ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-white text-ink-2')}>{c.name}</button>)}
        </div>
      )}
      {list.error && <ErrorBox error={list.error} retry={list.reload} />}
      {!list.data && !list.error && <Skeleton rows={5} />}
      {list.data && (
        <ul className="divide-y divide-line rounded-card border border-line bg-white shadow-card" data-testid="quote-list">
          {!list.data.quotes.length && <li className="p-6 text-center text-sm text-ink-3">아직 견적서가 없습니다{tpl.data && !tpl.data.companies.length && <> — 먼저 <Link href="/admin/company" className="underline">회사 정보·디자인</Link>에서 상호·사업자번호·주소를 등록하세요</>}</li>}
          {list.data.quotes.map((q) => (
            <li key={q.id}>
              <Link href={`/quotes/${q.id}`} className="flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50" data-testid="quote-row">
                <FileText className="size-5 shrink-0 text-emerald-600" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium"><span className="truncate">{q.to_name}</span><span className="text-xs font-normal text-ink-3">{q.quote_no}</span>
                    <span className={cx('rounded px-1.5 text-[11px] font-semibold', q.status === 'sent' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-ink-2')}>{q.status === 'sent' ? `보냄 · ${VIA[q.sent_via ?? ''] ?? q.sent_via}` : '초안'}</span></div>
                  <div className="truncate text-xs text-ink-3">{q.company_name} · 유효 {q.valid_until} · {q.created_by_name} · {fmtDateTime(q.created_at)}{q.task_title && ` · 업무: ${q.task_title}`}</div>
                </div>
                <div className="text-right text-sm font-semibold tabular-nums">{won(q.total)}원</div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {open && tpl.data && <NewQuote companies={tpl.data.companies} templates={tpl.data.templates} onClose={() => setOpen(false)} onMade={() => { setOpen(false); list.reload(); }} />}
    </div>
  );
}

function NewQuote({ companies, templates, onClose, onMade }: { companies: { key: string; name: string; isDefault: boolean }[]; templates: { id: string; company: string; name: string; isDefault: boolean }[]; onClose: () => void; onMade: (id: string) => void }) {
  const [company, setCompany] = useState(companies.find((c) => c.isDefault)?.key ?? companies[0]?.key ?? '');
  const [to, setTo] = useState({ name: '', contact: '', phone: '', email: '' });
  const [items, setItems] = useState<Item[]>([{ name: '', spec: '', qty: '1', unitPrice: '' }]);
  const [validDays, setValidDays] = useState('30');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [pv, setPv] = useState<{ supply: number; vat: number; total: number; overflow: boolean } | null>(null);
  const body = () => ({ company, to: { name: to.name.trim(), contact: to.contact.trim() || undefined, phone: to.phone.trim() || undefined, email: to.email.trim() || undefined },
    items: items.filter((it) => it.name.trim()).map((it) => ({ name: it.name.trim(), spec: it.spec.trim() || undefined, qty: Number(it.qty) || 1, unitPrice: Number(String(it.unitPrice).replace(/[^0-9.]/g, '')) || 0 })), validDays: Number(validDays) || 30, note: note.trim() || undefined });
  const preview = async () => { try { setPv(await api('/api/quotes/preview?json=1', { body: body() })); } catch (e: any) { toast.error(e.message); } };
  const create = async () => {
    setBusy(true);
    try { const r = await api('/api/quotes', { body: body() }); toast.ok(`견적서 ${r.no} 를 만들었습니다 — 자료실 "견적서" 폴더에 저장`); onMade(r.id); location.href = r.link; } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  const set = (i: number, k: keyof Item, v: string) => setItems((x) => x.map((it, j) => (j === i ? { ...it, [k]: v } : it)));
  const sum = items.reduce((n, it) => n + Math.round((Number(it.qty) || 0) * (Number(String(it.unitPrice).replace(/[^0-9.]/g, '')) || 0)), 0);
  return (
    <Modal open onClose={onClose} title="새 견적서" wide>
      {!companies.length ? <p className="text-sm text-ink-2">공급자로 쓸 회사 정보가 없습니다. <Link href="/admin/company" className="underline">회사 정보·디자인</Link>에서 상호·사업자번호·주소·전화를 먼저 등록하세요.</p> : (
        <div className="space-y-3" data-testid="quote-form">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="공급자(우리 회사)"><select className={inputCls} value={company} onChange={(e) => setCompany(e.target.value)} aria-label="공급자">{companies.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}</select>
              {templates.filter((t) => t.company === company).length > 0 && <p className="mt-0.5 text-[11px] text-ink-3">양식: {templates.filter((t) => t.company === company).find((t) => t.isDefault)?.name ?? templates.filter((t) => t.company === company)[0].name}</p>}</Field>
            <Field label="받는 곳"><input className={inputCls} value={to.name} onChange={(e) => setTo({ ...to, name: e.target.value })} placeholder="회사·고객 이름" aria-label="받는 곳" data-testid="quote-to" /></Field>
            <Field label="담당자(선택)"><input className={inputCls} value={to.contact} onChange={(e) => setTo({ ...to, contact: e.target.value })} aria-label="담당자" /></Field>
            <div className="grid grid-cols-2 gap-2"><Field label="전화(선택)"><input className={inputCls} value={to.phone} onChange={(e) => setTo({ ...to, phone: e.target.value })} aria-label="전화" /></Field><Field label="이메일(선택)"><input className={inputCls} value={to.email} onChange={(e) => setTo({ ...to, email: e.target.value })} aria-label="이메일" /></Field></div>
          </div>
          <div>
            <div className="mb-1 grid grid-cols-[1fr_90px_60px_110px_28px] gap-1 text-[11px] text-ink-3 sm:grid-cols-[1fr_120px_70px_130px_28px]"><span>품목</span><span>규격</span><span>수량</span><span>단가(원)</span><span /></div>
            {items.map((it, i) => (
              <div key={i} className="mb-1 grid grid-cols-[1fr_90px_60px_110px_28px] gap-1 sm:grid-cols-[1fr_120px_70px_130px_28px]" data-testid="quote-item">
                <input className={cx(inputCls, 'py-1')} value={it.name} onChange={(e) => set(i, 'name', e.target.value)} aria-label={`품목 ${i + 1}`} />
                <input className={cx(inputCls, 'py-1')} value={it.spec} onChange={(e) => set(i, 'spec', e.target.value)} aria-label={`규격 ${i + 1}`} />
                <input className={cx(inputCls, 'py-1 text-right')} value={it.qty} onChange={(e) => set(i, 'qty', e.target.value)} inputMode="decimal" aria-label={`수량 ${i + 1}`} />
                <input className={cx(inputCls, 'py-1 text-right')} value={it.unitPrice} onChange={(e) => set(i, 'unitPrice', e.target.value)} inputMode="numeric" aria-label={`단가 ${i + 1}`} />
                <button type="button" onClick={() => setItems((x) => (x.length > 1 ? x.filter((_, j) => j !== i) : x))} className="inline-flex items-center justify-center rounded-input text-ink-3 hover:bg-slate-100" aria-label="품목 지우기"><Trash2 className="size-4" /></button>
              </div>
            ))}
            <div className="flex items-center justify-between"><Button size="sm" variant="secondary" onClick={() => setItems((x) => [...x, { name: '', spec: '', qty: '1', unitPrice: '' }])} data-testid="quote-item-add"><Plus />품목 추가</Button>
              <span className="text-xs text-ink-2">공급가액 {won(sum)} · 부가세 {won(Math.round(sum * 0.1))} · <b className="text-sm text-ink">합계 {won(sum + Math.round(sum * 0.1))}원</b></span></div>
          </div>
          <div className="grid gap-2 sm:grid-cols-[120px_1fr]">
            <Field label="유효기간(일)"><input className={inputCls} value={validDays} onChange={(e) => setValidDays(e.target.value)} inputMode="numeric" aria-label="유효기간" /></Field>
            <Field label="비고(선택)"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="결제 조건·납기 등" aria-label="비고" /></Field>
          </div>
          {pv && <p className={cx('text-xs', pv.overflow ? 'text-red-700' : 'text-emerald-700')} data-testid="quote-preview-result">{pv.overflow ? '⚠ 1페이지 초과 — 품목을 묶어 주세요' : `서버 계산: 합계 ${won(pv.total)}원(VAT 포함) · A4 1페이지 OK`}</p>}
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={preview} disabled={busy}>미리 계산</Button><Button onClick={create} disabled={busy || !to.name.trim() || !items.some((it) => it.name.trim())} data-testid="quote-create">만들기</Button></div>
        </div>
      )}
    </Modal>
  );
}
