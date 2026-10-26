'use client';
// #429 (대표 10/22 23:15) 결재 설정 한 화면: 결재선 | 양식 | 팀별 배정 — 결재 화면 [결재 설정]·사이드바 관리 '결재 설정'에서 들어오고, '← 이전 화면'·경로(결재 › 결재 설정 › 결재선)
// 결재선 단계는 1차·2차·3차로 자동 표시, 끌어서(또는 ↑↓) 순서 바꾸기, 소속 장(팀장·본부장)·조건 단계(n일·n원 이상일 때만)
import { useState } from 'react';
import { ArrowDown, ArrowUp, ChevronRight, GripVertical, Plus, Save, Stamp, Trash2 } from 'lucide-react';
import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { api, useApi } from './client';
import { useSession } from './session';
import { BackBar } from './BackBar';
import { Button, Empty, Field, Modal, PageHeader, Skeleton, cx, inputCls, toast } from './ui';
import { UnitSelect } from './pickers';
import { ROLE_LABEL } from '@/lib/types';

export type SettingsTab = 'lines' | 'forms' | 'assign';
const TABS: [SettingsTab, string][] = [['lines', '결재선'], ['forms', '양식'], ['assign', '팀별 배정']];
const KIND_LABEL: Record<string, string> = { '*': '모든 양식', leave: '휴가', expense: '지출결의', general: '품의', trip: '출장', purchase: '구매', family: '경조사' };
const KINDS = ['leave', 'expense', 'general', 'trip', 'purchase', 'family'];

type Step = { label: string; type: 'role' | 'user' | 'lead'; role?: string; userId?: string; up?: number; when?: { minDays?: number; minAmount?: number } };
type EStep = Step & { key: string };
type Line = { id: string; name: string; org_unit_id: string | null; org_unit_name: string | null; steps: Step[]; active: boolean; assigned: number };
const ROLES = ['site_manager', 'dept_lead', 'admin', 'owner'] as const;
const LEAD_UP = ['소속 부서·팀의 장(팀장)', '한 단계 위 부서의 장(본부장)', '두 단계 위 부서의 장', '세 단계 위 부서의 장'];
const LEAD_SHORT = ['소속 팀장', '상위 부서장', '2단계 위 부서장', '3단계 위 부서장'];
const whenText = (w?: Step['when']) => (!w ? '' : [w.minDays !== undefined ? `${w.minDays}일 이상` : '', w.minAmount !== undefined ? `${Number(w.minAmount).toLocaleString('ko-KR')}원 이상` : ''].filter(Boolean).join(' 또는 ') + '일 때만');
let seq = 0;
const key = () => `s${Date.now().toString(36)}${(seq++).toString(36)}`;

export function ApprovalSettings({ initialTab }: { initialTab: SettingsTab }) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  // 탭을 바꾸면 주소도(새로 고침·공유해도 같은 탭) — 기록은 쌓지 않음(이전 화면 = 들어오기 전 화면)
  const go = (t: SettingsTab) => { setTab(t); try { window.history.replaceState(window.history.state, '', `/admin/approval-settings?tab=${t}`); } catch { /* 주소만 못 바꿈 */ } };
  const cur = TABS.find(([k]) => k === tab)?.[1] ?? '결재선';
  return (
    <div className="space-y-4" data-testid="approval-settings">
      <BackBar fallback="/approvals" crumbs={[{ label: '결재', href: '/approvals' }, { label: '결재 설정', href: '/admin/approval-settings' }, { label: cur }]} />
      <PageHeader title="결재 설정" icon={Stamp} sub="결재선(1차·2차·3차 단계)을 만들고, 양식 칸을 고치고, 부서·팀마다 양식별로 어떤 결재선을 쓸지 정합니다." />
      <div role="tablist" aria-label="결재 설정" className="flex flex-wrap gap-1 border-b border-line" data-testid="aps-tabs">
        {TABS.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => go(k)} data-testid={`aps-tab-${k}`}
            className={cx('-mb-px border-b-2 px-3 py-2 text-sm font-medium', tab === k ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-2 hover:text-ink')}>{l}</button>
        ))}
      </div>
      {tab === 'lines' && <LinesTab />}
      {tab === 'forms' && <FormsTab />}
      {tab === 'assign' && <AssignTab />}
    </div>
  );
}

/** 결재선 단계 칩: 1차 팀장 → 2차 본부장 → 3차 대표(3일 이상일 때만) */
function StepChips({ steps, who }: { steps: Step[]; who: (s: Step) => string }) {
  return (
    <ol className="mt-2 flex flex-wrap items-center gap-1 text-sm">
      {steps.map((s, i) => (
        <li key={i} className="flex items-center gap-1">
          <span className={cx('rounded-md px-2 py-0.5 font-medium', s.when ? 'border border-dashed border-amber-300 bg-white text-amber-800' : 'bg-amber-50 text-amber-800')} title={who(s)}>
            {i + 1}차 {s.label}{s.when && <span className="ml-1 text-[11px] font-normal text-ink-3">({whenText(s.when)})</span>}
          </span>
          {i < steps.length - 1 && <ChevronRight className="size-3.5 text-ink-3" />}
        </li>
      ))}
    </ol>
  );
}

function LinesTab() {
  const { dir } = useSession();
  const { data, reload } = useApi<{ lines: Line[] }>('/api/approval-lines');
  const [edit, setEdit] = useState<{ id?: string; name: string; orgUnitId: string; steps: EStep[]; active: boolean } | null>(null);
  const userName = (id?: string) => dir.users.find((u) => u.id === id)?.name ?? '';
  const who = (s: Step) => (s.type === 'user' ? userName(s.userId) : s.type === 'lead' ? LEAD_SHORT[s.up ?? 0] : ROLE_LABEL[s.role as keyof typeof ROLE_LABEL] ?? '');
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!edit) return;
    const body = { name: edit.name, orgUnitId: edit.orgUnitId || null, active: edit.active,
      steps: edit.steps.map((s) => ({ label: s.label.trim() || who(s), type: s.type, ...(s.type === 'role' ? { role: s.role } : s.type === 'user' ? { userId: s.userId } : { up: s.up ?? 0 }), ...(s.when ? { when: s.when } : {}) })) };
    try {
      await api(edit.id ? `/api/approval-lines/${edit.id}` : '/api/approval-lines', { method: edit.id ? 'PATCH' : 'POST', body });
      toast.ok('결재선을 저장했습니다'); setEdit(null); reload();
    } catch (er: any) { toast.error(er.message); }
  }
  async function template(preset: string) {
    try { await api('/api/approval-lines/templates', { body: { preset } }); toast.ok('예시 결재선을 만들었습니다 — 팀별 배정 탭에서 부서·팀에 연결하세요'); reload(); } catch (er: any) { toast.error(er.message); }
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setEdit({ name: '', orgUnitId: '', steps: [{ key: key(), label: '현장 관리자', type: 'role', role: 'site_manager' }, { key: key(), label: '대표', type: 'role', role: 'owner' }], active: true })}><Plus />결재선 만들기</Button>
        <span className="text-xs text-ink-3">예시로 시작:</span>
        <Button size="sm" variant="secondary" onClick={() => template('two')} data-testid="tpl-two">2단계 · 팀장 → 대표</Button>
        <Button size="sm" variant="secondary" onClick={() => template('three')} data-testid="tpl-three">3단계 · 팀장 → 본부장 → 대표</Button>
        <Button size="sm" variant="secondary" onClick={() => template('leave3')} data-testid="tpl-leave3">휴가 · 3일 이상이면 대표 추가</Button>
      </div>
      {!data ? <Skeleton rows={3} /> : !data.lines.length ? <Empty title="결재선이 없습니다" icon={Stamp}>위 예시 버튼으로 2단계·3단계 결재선을 바로 만들 수 있습니다. 예: 팀장 → 본부장 → 대표</Empty> : (
        <ul className="space-y-2" data-testid="approval-lines">
          {data.lines.map((l) => (
            <li key={l.id} className={cx('flex flex-wrap items-center gap-3 rounded-card border border-line bg-white p-4 shadow-card', !l.active && 'opacity-60')} data-testid="approval-line-card">
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{l.name} {!l.active && <span className="text-xs font-normal text-ink-3">(사용 안 함)</span>}</div>
                <div className="text-xs text-ink-2">{l.org_unit_name ?? '전사 공통'}{l.assigned > 0 ? ` · 팀별 배정 ${l.assigned}곳` : ''}</div>
                <StepChips steps={l.steps} who={who} />
              </div>
              <Button size="sm" variant="secondary" onClick={() => setEdit({ id: l.id, name: l.name, orgUnitId: l.org_unit_id ?? '', steps: l.steps.map((s) => ({ ...s, key: key() })), active: l.active })}>편집</Button>
            </li>
          ))}
        </ul>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? '결재선 편집' : '결재선 만들기'} wide>
        {edit && (
          <form onSubmit={save} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="이름"><input className={inputCls} required value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="예: 영업팀 휴가 3단계" /></Field>
              <Field label="사용 범위" hint="부서·팀마다 다르게 쓰려면 '팀별 배정' 탭에서 연결하세요"><UnitSelect value={edit.orgUnitId} onChange={(v) => setEdit({ ...edit, orgUnitId: v })} allowEmpty="전사 공통" /></Field>
            </div>
            <div>
              <div className="mb-1.5 text-xs font-medium text-ink-2">결재 단계 — 위에서부터 1차·2차·3차 순서. 손잡이(⋮⋮)를 끌거나 ↑↓로 순서를 바꿉니다</div>
              <StepsEditor steps={edit.steps} onChange={(steps) => setEdit({ ...edit, steps })} users={dir.users} />
              {edit.steps.length < 6 && <Button type="button" size="sm" variant="ghost" className="mt-1" onClick={() => setEdit({ ...edit, steps: [...edit.steps, { key: key(), label: '', type: 'role', role: 'admin' }] })} data-testid="step-add"><Plus />단계 추가</Button>}
            </div>
            {edit.id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} />사용</label>}
            <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setEdit(null)}>취소</Button><Button type="submit">저장</Button></div>
          </form>
        )}
      </Modal>
    </div>
  );
}

function StepsEditor({ steps, onChange, users }: { steps: EStep[]; onChange: (s: EStep[]) => void; users: { id: string; name: string; title: string | null }[] }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const end = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = steps.findIndex((s) => s.key === e.active.id), to = steps.findIndex((s) => s.key === e.over!.id);
    if (from >= 0 && to >= 0) onChange(arrayMove(steps, from, to));
  };
  const set = (i: number, p: Partial<EStep>) => onChange(steps.map((s, j) => (j === i ? { ...s, ...p } : s)));
  const move = (i: number, d: number) => { const j = i + d; if (j < 0 || j >= steps.length) return; onChange(arrayMove(steps, i, j)); };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={end}>
      <SortableContext items={steps.map((s) => s.key)} strategy={verticalListSortingStrategy}>
        <ol className="space-y-2" data-testid="step-list">
          {steps.map((s, i) => <StepRow key={s.key} s={s} i={i} total={steps.length} users={users} set={(p) => set(i, p)} move={(d) => move(i, d)} remove={() => onChange(steps.filter((_, j) => j !== i))} />)}
        </ol>
      </SortableContext>
    </DndContext>
  );
}

function StepRow({ s, i, total, users, set, move, remove }: { s: EStep; i: number; total: number; users: { id: string; name: string; title: string | null }[]; set: (p: Partial<EStep>) => void; move: (d: number) => void; remove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: s.key });
  const n = `${i + 1}차`;
  const cond = s.when?.minAmount !== undefined ? 'amount' : s.when?.minDays !== undefined ? 'days' : '';
  const setType = (type: EStep['type']) => set({ type, ...(type === 'role' ? { role: s.role ?? 'owner' } : type === 'lead' ? { up: s.up ?? 0, label: s.label || '팀장' } : {}) });
  return (
    <li ref={setNodeRef} style={{ transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined, transition }}
      className={cx('rounded-input border border-line bg-white p-2', isDragging && 'relative z-10 shadow-pop ring-2 ring-accent-500/40')} data-testid="step-row">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" {...attributes} {...listeners} className="cursor-grab touch-none rounded p-0.5 text-slate-400 hover:text-slate-600" aria-label={`${n} 단계 끌어서 순서 바꾸기`}><GripVertical className="size-4" /></button>
        <span className="flex h-6 min-w-9 items-center justify-center rounded-full bg-amber-100 px-1.5 text-xs font-bold text-amber-800" data-testid="step-order">{n}</span>
        <input className={inputCls + ' h-9 !w-32'} value={s.label} onChange={(e) => set({ label: e.target.value })} placeholder="단계 이름" aria-label={`${n} 이름`} />
        <select className={inputCls + ' h-9 !w-28'} value={s.type} onChange={(e) => setType(e.target.value as EStep['type'])} aria-label={`${n} 결재자 방식`}>
          <option value="lead">소속 장</option><option value="role">역할</option><option value="user">지정 사람</option>
        </select>
        {s.type === 'role' && <select className={inputCls + ' h-9 min-w-40 flex-1'} value={s.role} onChange={(e) => set({ role: e.target.value })} aria-label={`${n} 역할`}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}{r === 'site_manager' || r === 'dept_lead' ? ' (업무 소속·상위 조직)' : ''}</option>)}</select>}
        {s.type === 'user' && <select className={inputCls + ' h-9 min-w-40 flex-1'} value={s.userId ?? ''} onChange={(e) => set({ userId: e.target.value })} aria-label={`${n} 사람`} required><option value="">선택(본부장처럼 역할에 없는 직책)</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}{u.title ? ` · ${u.title}` : ''}</option>)}</select>}
        {s.type === 'lead' && <select className={inputCls + ' h-9 min-w-40 flex-1'} value={s.up ?? 0} onChange={(e) => set({ up: Number(e.target.value) })} aria-label={`${n} 소속 장`}>{LEAD_UP.map((l, k) => <option key={k} value={k}>{l}</option>)}</select>}
        <span className="flex items-center gap-0.5">
          <button type="button" className="rounded p-1 text-ink-3 hover:bg-slate-100 disabled:opacity-30" onClick={() => move(-1)} disabled={i === 0} aria-label={`${n} 위로`}><ArrowUp className="size-4" /></button>
          <button type="button" className="rounded p-1 text-ink-3 hover:bg-slate-100 disabled:opacity-30" onClick={() => move(1)} disabled={i === total - 1} aria-label={`${n} 아래로`}><ArrowDown className="size-4" /></button>
          <button type="button" className="rounded p-1 text-ink-3 hover:bg-red-50 hover:text-red-600 disabled:opacity-30" disabled={total <= 1} onClick={remove} aria-label={`${n} 단계 삭제`}><Trash2 className="size-4" /></button>
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-9 text-xs">
        <span className="text-ink-3">조건</span>
        <select className={cx(inputCls, 'h-7 !w-auto py-0 pr-7 text-xs')} value={cond} aria-label={`${n} 조건`}
          onChange={(e) => set({ when: e.target.value === 'days' ? { minDays: 3 } : e.target.value === 'amount' ? { minAmount: 1000000 } : undefined })}>
          <option value="">항상 거침</option><option value="days">기간이 n일 이상일 때만(휴가·출장)</option><option value="amount">금액이 n원 이상일 때만(지출·구매)</option>
        </select>
        {cond === 'days' && <><input className={cx(inputCls, 'h-7 !w-16 py-0 text-xs')} type="number" min={0.5} step={0.5} value={s.when?.minDays ?? 3} onChange={(e) => set({ when: { minDays: Math.max(0.5, Number(e.target.value) || 0.5) } })} aria-label={`${n} 일수`} />일 이상(주말 제외)</>}
        {cond === 'amount' && <><input className={cx(inputCls, 'h-7 !w-32 py-0 text-xs')} type="number" min={1} step={10000} value={s.when?.minAmount ?? 1000000} onChange={(e) => set({ when: { minAmount: Math.max(1, Math.round(Number(e.target.value) || 1)) } })} aria-label={`${n} 금액`} />원 이상</>}
      </div>
    </li>
  );
}

// ───────── 양식 ─────────
type F = { key: string; label: string; type: 'text' | 'number' | 'date' | 'daterange' | 'select' | 'textarea' | 'file'; required?: boolean; options?: string[]; hint?: string };
type Form = { id: string | null; kind: 'leave' | 'expense' | 'general' | 'trip' | 'purchase' | 'family'; name: string; fields: F[]; lineId: string | null; isDefault: boolean };
const TYPES: [F['type'], string][] = [['text', '글'], ['textarea', '긴 글'], ['number', '숫자'], ['date', '날짜'], ['daterange', '기간'], ['select', '선택'], ['file', '파일(결재 업무 첨부)']];

function FormsTab() {
  const st = useApi<{ forms: Form[]; lines: { id: string; name: string }[]; canEdit: boolean }>('/api/approvals/forms');
  if (!st.data) return <Skeleton rows={6} />;
  return (
    <div className="space-y-4" data-testid="approval-forms-admin">
      <p className="text-sm text-ink-2">휴가·지출결의·품의·출장·구매·경조사 양식의 칸을 회사에 맞게 고칩니다. 오른쪽 <b>기본 결재선</b>은 이 양식을 회사 전체에 쓸 결재선이고, 부서·팀마다 다르게 하려면 <b>팀별 배정</b> 탭에서 정합니다(팀 배정이 기본보다 먼저).</p>
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
      setF({ ...f, id: r.id, isDefault: false }); toast.ok(`${KIND_LABEL[f.kind]} 양식을 저장했습니다`); onSaved();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <section className="rounded-card border border-line bg-white p-4 shadow-card" data-testid={`approval-form-${f.kind}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold">{KIND_LABEL[f.kind]}</span>
        <input className={cx(inputCls, 'w-56')} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} disabled={!canEdit} aria-label="양식 이름" />
        {f.isDefault && <span className="text-xs text-ink-3">기본 양식(저장하면 회사 양식이 됩니다)</span>}
        <select className={cx(inputCls, 'ml-auto w-auto')} value={f.lineId ?? ''} onChange={(e) => setF({ ...f, lineId: e.target.value || null })} disabled={!canEdit} aria-label="기본 결재선"><option value="">기본 결재선: 팀 배정·회사 기본 따름</option>{lines.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
      </div>
      <ul className="mt-3 space-y-1.5">
        {f.fields.map((x, i) => (
          <li key={i} className="grid grid-cols-[1fr_110px_1fr_auto] items-center gap-1.5 text-sm sm:grid-cols-[160px_130px_1fr_auto]" data-testid="af-field">
            <input className={cx(inputCls, 'py-1')} value={x.label} onChange={(e) => upd(i, { label: e.target.value })} disabled={!canEdit} aria-label="칸 이름" />
            <select className={cx(inputCls, 'py-1')} value={x.type} onChange={(e) => upd(i, { type: e.target.value as F['type'] })} disabled={!canEdit} aria-label="칸 종류">{TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            <div className="flex min-w-0 items-center gap-1.5">
              <label className="flex shrink-0 items-center gap-1 text-xs"><input type="checkbox" checked={!!x.required} onChange={(e) => upd(i, { required: e.target.checked })} disabled={!canEdit} />필수</label>
              {x.type === 'select' ? <input className={cx(inputCls, 'min-w-0 py-1 text-xs')} value={(x.options ?? []).join(', ')} onChange={(e) => upd(i, { options: e.target.value.split(',').map((t) => t.trim()) })} placeholder="선택지(쉼표)" disabled={!canEdit} aria-label="선택지" />
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

// ───────── 팀별 배정 ─────────
type Assign = { id: string; kind: string; team_id: string | null; team_name: string | null; line_id: string; line_name: string; steps: Step[]; active: boolean };
type TeamRow = { id: string; name: string; path: string; kind: 'hq' | 'division' | 'dept' | 'team'; depth: number; lead_name: string | null; members: number };
type Resolved = { user: { id: string; name: string }; path: string | null; results: { kind: string; lineId: string | null; lineName: string | null; sourceLabel: string | null; via: string | null; steps: { label: string; names: string[]; cond: string | null }[] }[] };

function AssignTab() {
  const { dir } = useSession();
  const a = useApi<{ assignments: Assign[]; teams: TeamRow[] }>('/api/approval-lines/assignments');
  const lines = useApi<{ lines: Line[] }>('/api/approval-lines');
  const [nf, setNf] = useState({ teamId: '', kind: 'leave', lineId: '' });
  const [checkUser, setCheckUser] = useState('');
  const check = useApi<Resolved>(checkUser ? `/api/approval-lines/resolve?userId=${checkUser}` : null);
  const activeLines = (lines.data?.lines ?? []).filter((l) => l.active);
  const save = async (body: { kind: string; teamId: string | null; lineId: string | null }, msg: string) => {
    try { await api('/api/approval-lines/assignments', { method: 'PUT', body }); toast.ok(msg); a.reload(); lines.reload(); if (checkUser) check.reload(); } catch (e: any) { toast.error(e.message); }
  };
  if (!a.data || !lines.data) return <Skeleton rows={5} />;
  const teamPath = (id: string | null) => (id ? a.data!.teams.find((t) => t.id === id)?.path ?? '(보관된 부서·팀)' : '회사 전체');
  const rows = [...a.data.assignments].sort((x, y) => teamPath(x.team_id).localeCompare(teamPath(y.team_id), 'ko') || KINDS.indexOf(x.kind) - KINDS.indexOf(y.kind));
  return (
    <div className="space-y-4">
      <div className="rounded-card border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900" data-testid="assign-order">
        <b>어떤 결재선을 쓰나</b> — 위에서 먼저 맞는 것: ① 작성자가 직접 고른 결재선 ② <b>양식 × 작성자 부서·팀</b>(없으면 상위 부서) ③ 양식 기본(양식 × 회사 전체) ④ 팀 기본(모든 양식 × 부서·팀) ⑤ 회사 기본(모든 양식 × 회사 전체).
        예: 휴가 × 영업부 = 팀장 → 본부장 → 대표, 휴가 × 운영팀 = 현장관리자 → 대표, 지출결의 × 회사 전체 = 팀장 → 대표.
      </div>
      <section className="rounded-card border border-line bg-white p-3 shadow-card">
        <h2 className="mb-2 text-sm font-semibold">배정 추가</h2>
        <div className="grid gap-2 sm:grid-cols-[1fr_140px_1fr_auto]">
          <select className={inputCls} value={nf.teamId} onChange={(e) => setNf({ ...nf, teamId: e.target.value })} aria-label="부서·팀" data-testid="assign-team">
            <option value="">회사 전체</option>
            {a.data.teams.map((t) => <option key={t.id} value={t.id}>{'  '.repeat(t.depth)}{t.name}{t.lead_name ? ` (장 ${t.lead_name})` : ''}</option>)}
          </select>
          <select className={inputCls} value={nf.kind} onChange={(e) => setNf({ ...nf, kind: e.target.value })} aria-label="양식" data-testid="assign-kind">
            {['*', ...KINDS].map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
          <select className={inputCls} value={nf.lineId} onChange={(e) => setNf({ ...nf, lineId: e.target.value })} aria-label="결재선" data-testid="assign-line">
            <option value="">결재선 고르기</option>{activeLines.map((l) => <option key={l.id} value={l.id}>{l.name} · {l.steps.length}단계</option>)}
          </select>
          <Button onClick={() => save({ kind: nf.kind, teamId: nf.teamId || null, lineId: nf.lineId }, `${teamPath(nf.teamId || null)} · ${KIND_LABEL[nf.kind]} 결재선을 정했습니다`)} disabled={!nf.lineId} data-testid="assign-add"><Plus />배정</Button>
        </div>
        {!activeLines.length && <p className="mt-2 text-xs text-ink-3">결재선이 없습니다 — 결재선 탭에서 예시(2단계·3단계)로 먼저 만드세요.</p>}
      </section>
      <section className="rounded-card border border-line bg-white shadow-card">
        <h2 className="border-b border-line px-3 py-2 text-sm font-semibold">배정 표 <span className="font-normal text-ink-3">{rows.length}건</span></h2>
        {!rows.length ? <p className="p-4 text-sm text-ink-3" data-testid="assign-empty">아직 배정이 없습니다 — 지금은 양식 기본 결재선이나 조직 결재선을 씁니다.</p> : (
          <ul className="divide-y divide-line" data-testid="assign-table">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5" data-testid="assign-row" data-kind={r.kind}>
                <span className="min-w-0 text-sm font-medium" data-testid="assign-row-team">{teamPath(r.team_id)}</span>
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold">{KIND_LABEL[r.kind] ?? r.kind}</span>
                <span className="text-ink-3">→</span>
                <div className="min-w-0 flex-1 basis-60">
                  <div className="text-sm">{r.line_name}</div>
                  <div className="text-xs text-ink-2">{r.steps.map((s, i) => `${i + 1}차 ${s.label}${s.when ? `(${whenText(s.when)})` : ''}`).join(' → ')}</div>
                </div>
                <select className={cx(inputCls, 'h-8 !w-auto max-w-[200px] py-0 text-xs')} value={r.line_id} onChange={(e) => save({ kind: r.kind, teamId: r.team_id, lineId: e.target.value }, '결재선을 바꿨습니다')} aria-label="결재선 바꾸기">
                  {activeLines.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
                <button type="button" onClick={() => save({ kind: r.kind, teamId: r.team_id, lineId: null }, '배정을 지웠습니다')} className="rounded p-1.5 text-ink-3 hover:bg-red-50 hover:text-red-600" aria-label="배정 지우기" data-testid="assign-remove"><Trash2 className="size-4" /></button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="rounded-card border border-line bg-white p-3 shadow-card" data-testid="assign-check">
        <h2 className="text-sm font-semibold">누구에게 어떻게 적용되나</h2>
        <p className="mt-0.5 text-xs text-ink-3">사람을 고르면 그 사람이 양식마다 올릴 때 1차·2차·3차 결재자가 누구인지 보여 줍니다.</p>
        <select className={cx(inputCls, 'mt-2 max-w-xs')} value={checkUser} onChange={(e) => setCheckUser(e.target.value)} aria-label="확인할 사람" data-testid="assign-check-user">
          <option value="">사람 고르기</option>{dir.users.map((u) => <option key={u.id} value={u.id}>{u.name}{u.title ? ` · ${u.title}` : ''}</option>)}
        </select>
        {check.data && (
          <div className="mt-2 overflow-x-auto">
            <p className="text-xs text-ink-2">{check.data.user.name} · 소속 {check.data.path ?? '없음(부서·팀 배정 없이 조직 결재선)'}</p>
            <table className="mt-1 w-full min-w-[560px] text-xs" data-testid="assign-check-result">
              <thead className="text-left text-ink-3"><tr><th className="p-1">양식</th><th className="p-1">결재선 · 정해진 곳</th><th className="p-1">단계</th></tr></thead>
              <tbody>
                {check.data.results.map((r) => (
                  <tr key={r.kind} className="border-t border-line align-top" data-testid="assign-check-row" data-kind={r.kind}>
                    <td className="p-1 font-medium">{KIND_LABEL[r.kind]}</td>
                    <td className="p-1">{r.lineName ? <>{r.lineName}<div className="text-ink-3">{r.sourceLabel}{r.via ? ` · ${r.via}` : ''}</div></> : <span className="text-red-600">결재선 없음</span>}</td>
                    <td className="p-1">{r.steps.map((s, i) => <span key={i} className={cx('mr-1 inline-block', !s.names.length && 'text-red-600')}>{i + 1}차 {s.label}: {s.names.join(', ') || '결재자 없음'}{s.cond ? ` (${s.cond})` : ''}{i < r.steps.length - 1 ? ' →' : ''}</span>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
