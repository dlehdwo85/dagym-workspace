'use client';
import { use, useState } from 'react';
import { Archive, ArchiveRestore, Columns3, ListTodo, Plus, Star, Trash2, Workflow } from 'lucide-react';
import { api, useApi } from '@/components/client';
import { TaskViews } from '@/components/TaskViews';
import { AutomationRules } from '@/components/Automations';
import { Avatar, Button, Empty, ErrorBox, Field, Modal, Skeleton, cx, inputCls, toast } from '@/components/ui';
import { useSession, canManage } from '@/components/session';

const FIELD_TYPE: Record<string, string> = { select: '선택', number: '숫자', percent: '퍼센트', date: '날짜', person: '사람', text: '글자' };
const AGG: Record<string, string> = { none: '집계 안 함', sum: '합계', avg: '평균', min: '최소', max: '최대' };
const OPT_COLORS = ['#2563eb', '#16a34a', '#f59e0b', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#64748b'];

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useSession();
  const { data, error, loading, reload } = useApi<any>(`/api/projects/${id}`);
  const [tab, setTab] = useState<'tasks' | 'fields' | 'auto'>('tasks');
  if (error) return <ErrorBox error={error} />;
  if (loading && !data) return <Skeleton rows={6} />;
  const p = data.project;
  const editable = !p.limited && (canManage(user.role) || p.owner_id === user.id);
  async function fav() {
    try { await api(`/api/projects/${id}/favorite`, { method: p.favorite ? 'DELETE' : 'PUT' }); reload(); window.dispatchEvent(new Event('wos-favorites')); } catch (e: any) { toast.error(e.message); }
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-card text-white shadow-card" style={{ background: p.color }}><Columns3 className="size-6" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-xl font-bold tracking-tight">{p.name}</h1>
            <button onClick={fav} aria-label={p.favorite ? '즐겨찾기 해제' : '즐겨찾기'} aria-pressed={p.favorite} className={cx('rounded-md p-1 hover:bg-slate-100', p.favorite ? 'text-amber-400' : 'text-slate-300')}>
              <Star className="size-5" fill={p.favorite ? 'currentColor' : 'none'} />
            </button>
            {p.archived && <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium">보관됨</span>}
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-ink-2">
            <span>{p.org_unit_name}</span>·<span className="inline-flex items-center gap-1"><Avatar id={p.owner_id} name={p.owner_name} size={18} />{p.owner_name ?? '담당 없음'}</span>
            {p.limited && <span>· 내게 배정된 업무만 표시됩니다</span>}
          </p>
          {p.description && <p className="mt-1 text-sm text-ink-2">{p.description}</p>}
        </div>
        {editable && canManage(user.role) && (
          <Button size="sm" variant="secondary" onClick={async () => { try { await api(`/api/projects/${id}`, { method: 'PATCH', body: { archived: !p.archived } }); reload(); } catch (e: any) { toast.error(e.message); } }}>
            {p.archived ? <><ArchiveRestore />보관 해제</> : <><Archive />보관</>}
          </Button>
        )}
      </div>
      <div className="flex gap-1 border-b border-line" role="tablist">
        {([['tasks', '업무', ListTodo], ['fields', '사용자 지정 필드', Columns3], ['auto', '자동화', Workflow]] as const).map(([k, l, I]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={cx('-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium', tab === k ? 'border-brand-600 text-ink' : 'border-transparent text-ink-2 hover:text-ink')}>
            <I className="size-4" />{l}
          </button>
        ))}
      </div>
      {tab === 'tasks' && <TaskViews fixed={{ projectId: id }} title="프로젝트 업무" defaultMode="board" />}
      {tab === 'fields' && <FieldsManager projectId={id} canEdit={editable} />}
      {tab === 'auto' && <AutomationRules projectId={id} canEdit={editable && canManage(user.role)} />}
    </div>
  );
}

/** B-11 프로젝트 필드 관리 + 집계 (퍼센트는 평균이 기본) */
function FieldsManager({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const fields = useApi<{ fields: any[] }>(`/api/projects/${projectId}/fields`);
  const summary = useApi<{ summary: any[] }>(`/api/projects/${projectId}/field-summary`);
  const sections = useApi<{ sections: any[] }>(`/api/projects/${projectId}/sections`);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<any>({ name: '', type: 'select', aggregate: '', options: '' });
  async function create(e: React.FormEvent) {
    e.preventDefault();
    const options = f.type === 'select' ? f.options.split(',').map((s: string) => s.trim()).filter(Boolean).map((label: string, i: number) => ({ id: `o${i + 1}`, label, color: OPT_COLORS[i % OPT_COLORS.length] })) : undefined;
    if (f.type === 'select' && !options?.length) return toast.error('선택지를 쉼표로 구분해 입력하세요');
    try {
      await api(`/api/projects/${projectId}/fields`, { body: { name: f.name, type: f.type, options, aggregate: f.aggregate || undefined } });
      toast.ok('필드를 추가했습니다'); setOpen(false); setF({ name: '', type: 'select', aggregate: '', options: '' }); fields.reload(); summary.reload();
    } catch (er: any) { toast.error(er.message); }
  }
  async function remove(x: any) {
    if (!confirm(`'${x.name}' 필드와 입력된 값을 삭제할까요?`)) return;
    try { await api(`/api/fields/${x.id}`, { method: 'DELETE' }); fields.reload(); summary.reload(); } catch (er: any) { toast.error(er.message); }
  }
  async function setAgg(x: any, aggregate: string) {
    try { await api(`/api/fields/${x.id}`, { method: 'PATCH', body: { aggregate } }); fields.reload(); summary.reload(); } catch (er: any) { toast.error(er.message); }
  }
  const secName = (sid: string) => (sid === 'none' ? '섹션 없음' : sections.data?.sections.find((s) => s.id === sid)?.name ?? '');
  const fmt = (v: number | null, type: string) => (v === null ? '—' : type === 'percent' ? `${v}%` : v.toLocaleString('ko-KR'));
  return (
    <div className="space-y-4" data-testid="fields-manager">
      <div className="flex items-center justify-between">
        <p className="text-sm text-ink-2">업무마다 값(단계·비용·달성률 등)을 넣고 섹션·전체 합계를 봅니다. 값은 업무 상세에서 입력합니다.</p>
        {canEdit && <Button size="sm" onClick={() => setOpen(true)}><Plus />필드 추가</Button>}
      </div>
      {!fields.data?.fields.length ? <Empty title="사용자 지정 필드가 없습니다" icon={Columns3}>예: 단계(선택), 예산(숫자), 달성률(퍼센트)</Empty> : (
        <div className="overflow-hidden rounded-card border border-line bg-white shadow-card">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-ink-2"><tr><th className="px-4 py-2 font-medium">이름</th><th className="px-4 py-2 font-medium">형식</th><th className="px-4 py-2 font-medium">집계</th><th className="px-4 py-2 font-medium">선택지</th><th /></tr></thead>
            <tbody className="divide-y divide-line">
              {fields.data.fields.map((x) => (
                <tr key={x.id}>
                  <td className="px-4 py-2.5 font-medium">{x.name}</td>
                  <td className="px-4 py-2.5 text-ink-2">{FIELD_TYPE[x.type]}</td>
                  <td className="px-4 py-2.5">
                    {['number', 'percent'].includes(x.type) ? (
                      <select className="h-8 rounded-input border border-line bg-white px-2 text-sm" value={x.aggregate} disabled={!canEdit} onChange={(e) => setAgg(x, e.target.value)} aria-label={`${x.name} 집계`}>
                        {Object.entries(AGG).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    ) : <span className="text-ink-3">—</span>}
                  </td>
                  <td className="px-4 py-2.5"><span className="flex flex-wrap gap-1">{(x.options ?? []).map((o: any) => <span key={o.id} className="rounded-full px-2 py-0.5 text-xs font-medium text-white" style={{ background: o.color }}>{o.label}</span>)}</span></td>
                  <td className="px-2 text-right">{canEdit && <button className="rounded p-1 text-ink-3 hover:bg-red-50 hover:text-red-600" onClick={() => remove(x)} aria-label={`${x.name} 삭제`}><Trash2 className="size-4" /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!!summary.data?.summary.length && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="field-summary">
          {summary.data.summary.map((s) => (
            <div key={s.fieldId} className="rounded-card border border-line bg-white p-4 shadow-card">
              <div className="text-sm text-ink-2">{s.name} <span className="text-xs text-ink-3">· {AGG[s.aggregate]} · {s.count}건</span></div>
              <div className="mt-1 text-2xl font-bold tabular-nums">{fmt(s.total, s.type)}</div>
              <ul className="mt-2 space-y-0.5 text-xs text-ink-2">
                {Object.entries(s.bySection).map(([sid, v]) => <li key={sid} className="flex justify-between"><span>{secName(sid)}</span><span className="font-medium tabular-nums">{fmt(v as number | null, s.type)}</span></li>)}
              </ul>
            </div>
          ))}
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="필드 추가">
        <form onSubmit={create} className="space-y-3">
          <Field label="이름"><input className={inputCls} required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="예: 달성률" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="형식">
              <select className={inputCls} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{Object.entries(FIELD_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            </Field>
            {['number', 'percent'].includes(f.type) && (
              <Field label="집계" hint={f.type === 'percent' ? '퍼센트는 평균이 기본입니다' : '숫자는 합계가 기본입니다'}>
                <select className={inputCls} value={f.aggregate} onChange={(e) => setF({ ...f, aggregate: e.target.value })}><option value="">기본</option>{Object.entries(AGG).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              </Field>
            )}
          </div>
          {f.type === 'select' && <Field label="선택지 (쉼표로 구분)"><input className={inputCls} value={f.options} onChange={(e) => setF({ ...f, options: e.target.value })} placeholder="계획, 진행, 보고" /></Field>}
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setOpen(false)}>취소</Button><Button type="submit">추가</Button></div>
        </form>
      </Modal>
    </div>
  );
}
