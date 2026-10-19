'use client';
// V30 ④ 결재: 휴가·지출결의·품의 요청(회사 양식) = 결재 업무(기존 결재선) · 내 요청·내가 결재할 것·관리자 전체, 승인 건 엑셀
import { useState } from 'react';
import Link from 'next/link';
import { Download, Plus, Stamp } from 'lucide-react';
import { api, useApi } from '@/components/client';
import { Button, ErrorBox, Field, Modal, PageHeader, Skeleton, cx, fmtDateTime, inputCls, toast } from '@/components/ui';

type Field_ = { key: string; label: string; type: 'text' | 'number' | 'date' | 'daterange' | 'select' | 'textarea' | 'file'; required?: boolean; options?: string[]; hint?: string };
type Form = { id: string | null; kind: 'leave' | 'expense' | 'general'; name: string; fields: Field_[]; lineId: string | null; lineName: string | null; isDefault: boolean };
type Req = { id: string; kind: string; data: Record<string, any>; amount: string | null; status: string; created_at: string; task_id: string; event_id: string | null; requester_name: string; title: string; steps: { label: string; status: string; by: string | null }[] | null };
const KIND: Record<string, string> = { leave: '휴가', expense: '지출결의', general: '품의' };
const STATUS: Record<string, [string, string]> = { pending: ['진행 중', 'bg-amber-100 text-amber-800'], approved: ['승인', 'bg-emerald-100 text-emerald-700'], rejected: ['반려', 'bg-red-100 text-red-700'], cancelled: ['취소', 'bg-slate-100 text-ink-2'] };
const todayKst = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

export default function ApprovalsPage() {
  const [kind, setKind] = useState('');
  const list = useApi<{ requests: Req[]; isAdmin: boolean }>(`/api/approvals/requests${kind ? `?kind=${kind}` : ''}`);
  const forms = useApi<{ forms: Form[]; canEdit: boolean }>('/api/approvals/forms');
  const [open, setOpen] = useState<Form | null>(null);
  const month = todayKst().slice(0, 7);
  return (
    <div className="mx-auto max-w-4xl space-y-3 p-3 sm:p-4" data-testid="approvals-page">
      <PageHeader title="결재" icon={Stamp} sub="휴가·지출결의·품의를 회사 양식으로 올리면 결재선을 따라 승인됩니다. 휴가가 승인되면 연차·반차가 캘린더에 자동 등록됩니다."
        actions={<div className="flex flex-wrap gap-1.5">{forms.data?.forms.map((f) => <Button key={f.kind} size="sm" variant={f.kind === 'leave' ? 'primary' : 'secondary'} onClick={() => setOpen(f)} data-testid={`approval-new-${f.kind}`}><Plus />{f.name}</Button>)}</div>} />
      <div className="flex flex-wrap items-center gap-1.5" role="tablist">
        {[['', '전체'], ['leave', '휴가'], ['expense', '지출결의'], ['general', '품의']].map(([k, l]) => <button key={k} role="tab" aria-selected={kind === k} onClick={() => setKind(k)} className={cx('rounded-full border px-3 py-1 text-xs font-medium', kind === k ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-white text-ink-2')}>{l}</button>)}
        {list.data?.isAdmin && <a href={`/api/approvals/requests/export?kind=${kind || 'expense'}&month=${month}`} className="ml-auto inline-flex h-7 items-center gap-1 rounded-input border border-line bg-white px-2.5 text-xs hover:bg-slate-50" data-testid="approvals-export"><Download className="size-3.5" />{month} {KIND[kind] ?? '지출결의'} 엑셀</a>}
        {forms.data?.canEdit && <Link href="/admin/approval-forms" className="text-xs text-ink-2 underline">양식 고치기</Link>}
      </div>
      {list.error && <ErrorBox error={list.error} retry={list.reload} />}
      {!list.data && !list.error && <Skeleton rows={5} />}
      {list.data && (
        <ul className="divide-y divide-line rounded-card border border-line bg-white shadow-card" data-testid="approval-list">
          {!list.data.requests.length && <li className="p-6 text-center text-sm text-ink-3">결재 요청이 없습니다 — 위 버튼으로 올려 보세요</li>}
          {list.data.requests.map((r) => {
            const [sl, cls] = STATUS[r.status] ?? [r.status, ''];
            return (
              <li key={r.id}>
                <Link href={`/tasks/${r.task_id}`} className="flex items-start gap-3 px-3 py-2.5 hover:bg-slate-50" data-testid="approval-row" data-status={r.status}>
                  <span className={cx('mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold', cls)}>{sl}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{r.title}</div>
                    <div className="text-xs text-ink-3">{r.requester_name} · {fmtDateTime(r.created_at)}{r.steps?.length ? ` · ${r.steps.map((s) => `${s.label} ${s.status === 'approved' ? '✓' : s.status === 'rejected' ? '✗' : s.status === 'pending' ? '…' : '·'}`).join(' → ')}` : ''}{r.event_id && ' · 📅 캘린더 등록됨'}</div>
                  </div>
                  {r.amount && <span className="shrink-0 text-sm font-semibold tabular-nums">{Number(r.amount).toLocaleString('ko-KR')}원</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {open && <RequestModal form={open} onClose={() => setOpen(null)} onMade={() => { setOpen(null); list.reload(); }} />}
    </div>
  );
}

function RequestModal({ form, onClose, onMade }: { form: Form; onClose: () => void; onMade: () => void }) {
  const [data, setData] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => setData((d) => ({ ...d, [k]: v }));
  const submit = async () => {
    setBusy(true);
    try {
      const r = await api('/api/approvals/requests', { body: { kind: form.kind, formId: form.id ?? undefined, data } });
      toast.ok(r.needsFile ? '결재 요청을 올렸습니다 — 결재 업무에 사진·파일을 붙여 주세요' : '결재 요청을 올렸습니다 — 결재자에게 알림이 갔습니다', { label: '열기', run: () => { location.href = r.link; } });
      onMade();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={form.name}>
      <div className="space-y-2" data-testid="approval-form">
        {form.fields.map((f) => (
          <Field key={f.key} label={`${f.label}${f.required ? ' *' : ''}`} hint={f.hint}>
            {f.type === 'select' ? <select className={inputCls} value={data[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} aria-label={f.label} data-testid={`af-${f.key}`}><option value="">선택</option>{(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}</select>
              : f.type === 'textarea' ? <textarea className={cx(inputCls, 'min-h-20')} value={data[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} aria-label={f.label} data-testid={`af-${f.key}`} />
              : f.type === 'daterange' ? <div className="flex items-center gap-2"><input type="date" className={inputCls} value={data[f.key]?.from ?? ''} onChange={(e) => set(f.key, { ...(data[f.key] ?? {}), from: e.target.value, to: data[f.key]?.to || e.target.value })} aria-label={`${f.label} 시작`} data-testid={`af-${f.key}-from`} /><span className="text-ink-3">~</span><input type="date" className={inputCls} value={data[f.key]?.to ?? ''} onChange={(e) => set(f.key, { ...(data[f.key] ?? {}), to: e.target.value })} aria-label={`${f.label} 끝`} data-testid={`af-${f.key}-to`} /></div>
              : f.type === 'date' ? <input type="date" className={inputCls} value={data[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} aria-label={f.label} data-testid={`af-${f.key}`} />
              : f.type === 'number' ? <input className={inputCls} inputMode="numeric" value={data[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} aria-label={f.label} data-testid={`af-${f.key}`} />
              : f.type === 'file' ? <p className="text-xs text-ink-2">요청을 올린 뒤 열리는 결재 업무의 첨부 칸에 올려 주세요(사진·파일).</p>
              : <input className={inputCls} value={data[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} aria-label={f.label} data-testid={`af-${f.key}`} />}
          </Field>
        ))}
        <p className="text-[11px] text-ink-3">결재선: {form.lineName ?? '요청자 조직의 결재선(관리자가 운영 상태 › 결재선에서 정함)'}</p>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>취소</Button><Button onClick={submit} disabled={busy} data-testid="approval-submit">결재 올리기</Button></div>
      </div>
    </Modal>
  );
}
