'use client';
// V30 ④ 결재 양식 편집(간단 필드 빌더): 종류별 칸(이름·종류·필수·선택지)·기본 결재선 — 운영 상태 편집 권한
import { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Save, Stamp, Trash2 } from 'lucide-react';
import { api, useApi } from '@/components/client';
import { Button, Field, PageHeader, Skeleton, cx, inputCls, toast } from '@/components/ui';

type F = { key: string; label: string; type: 'text' | 'number' | 'date' | 'daterange' | 'select' | 'textarea' | 'file'; required?: boolean; options?: string[]; hint?: string };
type Form = { id: string | null; kind: 'leave' | 'expense' | 'general' | 'trip' | 'purchase' | 'family'; name: string; fields: F[]; lineId: string | null; isDefault: boolean };
const TYPES: [F['type'], string][] = [['text', '글'], ['textarea', '긴 글'], ['number', '숫자'], ['date', '날짜'], ['daterange', '기간'], ['select', '선택'], ['file', '파일(결재 업무 첨부)']];
const KIND: Record<string, string> = { leave: '휴가', expense: '지출결의', general: '품의', trip: '출장', purchase: '구매', family: '경조사' }; // #114 ⑤

export default function ApprovalFormsPage() {
  const st = useApi<{ forms: Form[]; lines: { id: string; name: string }[]; canEdit: boolean }>('/api/approvals/forms');
  if (!st.data) return <Skeleton rows={6} />;
  return (
    <div className="space-y-4" data-testid="approval-forms-admin">
      <PageHeader title="결재 양식" icon={Stamp} sub="휴가·지출결의·품의·출장·구매·경조사 양식의 칸을 회사에 맞게 고칩니다. 결재선은 운영 상태 › 결재선에서, 양식마다 기본 결재선을 고를 수 있습니다(요청자가 올릴 때 바꿀 수도 있습니다)." />
      {st.data.forms.map((f) => <FormEditor key={f.kind} form={f} lines={st.data!.lines} canEdit={st.data!.canEdit} onSaved={st.reload} />)}
    </div>
  );
}

function FormEditor({ form, lines, canEdit, onSaved }: { form: Form; lines: { id: string; name: string }[]; canEdit: boolean; onSaved: () => void }) {
  const [f, setF] = useState<Form>(form);
  const [busy, setBusy] = useState(false);
  const upd = (i: number, patch: Partial<F>) => setF({ ...f, fields: f.fields.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const move = (i: number, d: number) => { const a = [...f.fields]; const j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; setF({ ...f, fields: a }); };
  const save = async () => {
    setBusy(true);
    try {
      const body = { kind: f.kind, name: f.name, fields: f.fields.map((x) => ({ ...x, options: x.type === 'select' ? (x.options ?? []).filter(Boolean) : undefined, hint: x.hint || undefined })), lineId: f.lineId };
      const r = f.id ? await api(`/api/approvals/forms/${f.id}`, { method: 'PATCH', body }) : await api('/api/approvals/forms', { body });
      setF({ ...f, id: r.id, isDefault: false }); toast.ok(`${KIND[f.kind]} 양식을 저장했습니다`); onSaved();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <section className="rounded-card border border-line bg-white p-4 shadow-card" data-testid={`approval-form-${f.kind}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold">{KIND[f.kind]}</span>
        <input className={cx(inputCls, 'w-56')} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} disabled={!canEdit} aria-label="양식 이름" />
        {f.isDefault && <span className="text-xs text-ink-3">기본 양식(저장하면 회사 양식이 됩니다)</span>}
        <select className={cx(inputCls, 'ml-auto w-auto')} value={f.lineId ?? ''} onChange={(e) => setF({ ...f, lineId: e.target.value || null })} disabled={!canEdit} aria-label="기본 결재선"><option value="">결재선: 요청자 조직 기준</option>{lines.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
      </div>
      <ul className="mt-3 space-y-1.5">
        {f.fields.map((x, i) => (
          <li key={i} className="grid grid-cols-[1fr_110px_1fr_auto] items-center gap-1.5 text-sm sm:grid-cols-[160px_130px_1fr_auto]" data-testid="af-field">
            <input className={cx(inputCls, 'py-1')} value={x.label} onChange={(e) => upd(i, { label: e.target.value })} disabled={!canEdit} aria-label="칸 이름" />
            <select className={cx(inputCls, 'py-1')} value={x.type} onChange={(e) => upd(i, { type: e.target.value as F['type'] })} disabled={!canEdit} aria-label="칸 종류">{TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            <div className="flex min-w-0 items-center gap-1.5">
              <label className="flex shrink-0 items-center gap-1 text-xs"><input type="checkbox" checked={!!x.required} onChange={(e) => upd(i, { required: e.target.checked })} disabled={!canEdit} />필수</label>
              {x.type === 'select' ? <input className={cx(inputCls, 'min-w-0 py-1 text-xs')} value={(x.options ?? []).join(', ')} onChange={(e) => upd(i, { options: e.target.value.split(',').map((s) => s.trim()) })} placeholder="선택지(쉼표)" disabled={!canEdit} aria-label="선택지" />
                : <input className={cx(inputCls, 'min-w-0 py-1 text-xs')} value={x.hint ?? ''} onChange={(e) => upd(i, { hint: e.target.value })} placeholder="도움말(선택)" disabled={!canEdit} aria-label="도움말" />}
            </div>
            {canEdit && <span className="flex gap-0.5"><button onClick={() => move(i, -1)} className="rounded p-1 text-ink-3 hover:bg-slate-100" aria-label="위로"><ArrowUp className="size-3.5" /></button><button onClick={() => move(i, 1)} className="rounded p-1 text-ink-3 hover:bg-slate-100" aria-label="아래로"><ArrowDown className="size-3.5" /></button><button onClick={() => setF({ ...f, fields: f.fields.filter((_, j) => j !== i) })} className="rounded p-1 text-red-600 hover:bg-red-50" aria-label="칸 지우기"><Trash2 className="size-3.5" /></button></span>}
          </li>
        ))}
      </ul>
      {canEdit && <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={() => setF({ ...f, fields: [...f.fields, { key: `f${Date.now().toString(36)}`, label: '새 칸', type: 'text' }] })} data-testid={`af-add-${f.kind}`}><Plus />칸 추가</Button>
        <Button size="sm" onClick={save} disabled={busy || !f.name.trim() || !f.fields.length} data-testid={`af-save-${f.kind}`}><Save />저장</Button>
      </div>}
    </section>
  );
}
