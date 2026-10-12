'use client';
import { useState } from 'react';
import { Bell, Flag, Plus, Trash2, UserRound, Workflow, Zap, CornerDownRight } from 'lucide-react';
import { api, useApi } from './client';
import { useSession } from './session';
import { Button, Empty, Field, Modal, cx, fmtDateTime, inputCls, toast } from './ui';
import { STATUS_LABEL, STATUSES, PRIORITY_LABEL } from '@/lib/types';

export const TRIGGER_LABEL: Record<string, string> = {
  task_created: '업무가 만들어지면', status_changed: '상태가 바뀌면', task_completed: '업무가 완료되면', section_moved: '섹션이 바뀌면', due_soon: '마감이 다가오면',
};
const NOTIFY_TO: Record<string, string> = { assignee: '담당자', creator: '만든 사람', unit_managers: '현장 관리자', user: '지정한 사람' };

export function describeAction(a: any, userName: (id: string) => string) {
  switch (a.type) {
    case 'notify': return `${a.to === 'user' ? userName(a.userId) : NOTIFY_TO[a.to]}에게 알림${a.message ? ` “${a.message}”` : ''}`;
    case 'set_assignee': return `담당자를 ${userName(a.userId)}(으)로`;
    case 'set_priority': return `우선순위를 ${PRIORITY_LABEL[a.priority as keyof typeof PRIORITY_LABEL]}(으)로`;
    case 'create_follow_up': return `후속 업무 “${a.title}” 만들기${a.dueInDays !== undefined ? ` (${a.dueInDays}일 뒤 마감)` : ''}`;
    default: return a.type;
  }
}
const ACTION_ICON: Record<string, typeof Bell> = { notify: Bell, set_assignee: UserRound, set_priority: Flag, create_follow_up: CornerDownRight };

/** B-10 자동화 규칙 목록·추가. scope: 프로젝트 또는 조직(없으면 전사) */
export function AutomationRules({ projectId, orgUnitId, canEdit }: { projectId?: string; orgUnitId?: string; canEdit: boolean }) {
  const { dir } = useSession();
  const { data, reload } = useApi<{ rules: any[]; runs: any[] }>('/api/automations');
  const [open, setOpen] = useState(false);
  const userName = (id: string) => dir.users.find((u) => u.id === id)?.name ?? '알 수 없음';
  const rules = (data?.rules ?? []).filter((r) => (projectId ? r.project_id === projectId : orgUnitId ? r.org_unit_id === orgUnitId : true));
  async function toggle(r: any) {
    try { await api(`/api/automations/${r.id}`, { method: 'PATCH', body: { name: r.name, orgUnitId: r.org_unit_id, projectId: r.project_id, trigger: r.trigger, conditions: r.conditions, actions: r.actions, enabled: !r.enabled } }); reload(); } catch (e: any) { toast.error(e.message); }
  }
  async function remove(r: any) {
    if (!confirm(`'${r.name}' 규칙을 삭제할까요?`)) return;
    try { await api(`/api/automations/${r.id}`, { method: 'DELETE' }); reload(); } catch (e: any) { toast.error(e.message); }
  }
  return (
    <div className="space-y-3" data-testid="automation-rules">
      <div className="flex items-center justify-between">
        <p className="text-sm text-ink-2">조건이 맞으면 알림·배정·후속 업무를 자동으로 처리합니다. 규칙이 만든 변경은 다시 규칙을 부르지 않습니다.</p>
        {canEdit && <Button size="sm" onClick={() => setOpen(true)}><Plus />규칙 추가</Button>}
      </div>
      {!rules.length ? <Empty title="자동화 규칙이 없습니다" icon={Workflow}>예: “검토 요청이 되면 현장 관리자에게 알림”, “완료되면 비용 정산 후속 업무 만들기”</Empty> : (
        <ul className="space-y-2">
          {rules.map((r) => (
            <li key={r.id} className={cx('rounded-card border border-line bg-white p-4 shadow-card', !r.enabled && 'opacity-60')}>
              <div className="flex items-center gap-2">
                <Zap className={cx('size-4', r.enabled ? 'text-amber-500' : 'text-ink-3')} />
                <span className="flex-1 font-semibold">{r.name}</span>
                <span className="text-xs text-ink-3">실행 {r.run_count}회{r.last_run ? ` · 최근 ${fmtDateTime(r.last_run)}` : ''}</span>
                {canEdit && <label className="ml-2 inline-flex items-center gap-1.5 text-xs"><input type="checkbox" className="accent-brand-600" checked={r.enabled} onChange={() => toggle(r)} />사용</label>}
                {canEdit && <button className="rounded p-1 text-ink-3 hover:bg-red-50 hover:text-red-600" onClick={() => remove(r)} aria-label={`${r.name} 삭제`}><Trash2 className="size-4" /></button>}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-sm">
                <span className="rounded-md bg-accent-50 px-2 py-0.5 font-medium text-accent-700">{TRIGGER_LABEL[r.trigger]}{r.conditions?.toStatus ? ` (→ ${STATUS_LABEL[r.conditions.toStatus as keyof typeof STATUS_LABEL]})` : ''}{r.conditions?.hoursBefore ? ` (${r.conditions.hoursBefore}시간 전)` : ''}</span>
                {r.actions.map((a: any, i: number) => {
                  const I = ACTION_ICON[a.type] ?? Bell;
                  return <span key={i} className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-ink"><I className="size-3.5 text-ink-2" />{describeAction(a, userName)}</span>;
                })}
              </div>
            </li>
          ))}
        </ul>
      )}
      <RuleModal open={open} onClose={() => setOpen(false)} projectId={projectId} orgUnitId={orgUnitId} onSaved={() => { setOpen(false); reload(); }} />
    </div>
  );
}

function RuleModal({ open, onClose, projectId, orgUnitId, onSaved }: { open: boolean; onClose: () => void; projectId?: string; orgUnitId?: string; onSaved: () => void }) {
  const { dir } = useSession();
  const [f, setF] = useState<any>({ name: '', trigger: 'status_changed', toStatus: 'review', hoursBefore: 24, action: 'notify', to: 'unit_managers', message: '', userId: '', priority: 'high', title: '', dueInDays: 3 });
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const action = f.action === 'notify' ? { type: 'notify', to: f.to, ...(f.to === 'user' ? { userId: f.userId } : {}), ...(f.message ? { message: f.message } : {}) }
      : f.action === 'set_assignee' ? { type: 'set_assignee', userId: f.userId }
      : f.action === 'set_priority' ? { type: 'set_priority', priority: f.priority }
      : { type: 'create_follow_up', title: f.title, dueInDays: Number(f.dueInDays), assignTo: 'same' };
    const conditions = f.trigger === 'status_changed' && f.toStatus ? { toStatus: f.toStatus } : f.trigger === 'due_soon' ? { hoursBefore: Number(f.hoursBefore) } : {};
    try {
      await api('/api/automations', { body: { name: f.name || TRIGGER_LABEL[f.trigger], projectId: projectId ?? null, orgUnitId: orgUnitId ?? null, trigger: f.trigger, conditions, actions: [action] } });
      toast.ok('규칙을 추가했습니다'); onSaved();
    } catch (er: any) { toast.error(er.message); }
  }
  return (
    <Modal open={open} onClose={onClose} title="자동화 규칙 추가">
      <form onSubmit={save} className="space-y-3">
        <Field label="규칙 이름"><input className={inputCls} value={f.name} onChange={set('name')} placeholder="예: 검토 요청 알림" /></Field>
        <div className="rounded-input border border-line p-3">
          <div className="mb-2 text-xs font-semibold text-ink-2">언제</div>
          <div className="grid grid-cols-2 gap-2">
            <select className={inputCls} value={f.trigger} onChange={set('trigger')} aria-label="실행 조건">{Object.entries(TRIGGER_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            {f.trigger === 'status_changed' && <select className={inputCls} value={f.toStatus} onChange={set('toStatus')} aria-label="바뀐 상태">{STATUSES.map((s) => <option key={s} value={s}>→ {STATUS_LABEL[s]}</option>)}</select>}
            {f.trigger === 'due_soon' && <select className={inputCls} value={f.hoursBefore} onChange={set('hoursBefore')} aria-label="알림 시점">{[2, 6, 24, 48, 72].map((h) => <option key={h} value={h}>{h}시간 전</option>)}</select>}
          </div>
        </div>
        <div className="rounded-input border border-line p-3">
          <div className="mb-2 text-xs font-semibold text-ink-2">무엇을</div>
          <select className={inputCls} value={f.action} onChange={set('action')} aria-label="동작">
            <option value="notify">알림 보내기</option><option value="set_assignee">담당자 지정</option><option value="set_priority">우선순위 바꾸기</option><option value="create_follow_up">후속 업무 만들기</option>
          </select>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {f.action === 'notify' && <>
              <select className={inputCls} value={f.to} onChange={set('to')} aria-label="받는 사람">{Object.entries(NOTIFY_TO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              {f.to === 'user' && <select className={inputCls} value={f.userId} onChange={set('userId')} aria-label="지정한 사람" required><option value="">선택</option>{dir.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>}
              <input className={cx(inputCls, 'col-span-2')} value={f.message} onChange={set('message')} placeholder="알림 문구 (선택)" aria-label="알림 문구" />
            </>}
            {f.action === 'set_assignee' && <select className={inputCls} value={f.userId} onChange={set('userId')} aria-label="담당자" required><option value="">선택</option>{dir.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>}
            {f.action === 'set_priority' && <select className={inputCls} value={f.priority} onChange={set('priority')} aria-label="우선순위">{Object.entries(PRIORITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>}
            {f.action === 'create_follow_up' && <>
              <input className={inputCls} value={f.title} onChange={set('title')} placeholder="후속 업무 제목" aria-label="후속 업무 제목" required />
              <select className={inputCls} value={f.dueInDays} onChange={set('dueInDays')} aria-label="마감까지 일수">{[0, 1, 2, 3, 5, 7, 14, 30].map((d) => <option key={d} value={d}>{d ? `${d}일 뒤 마감` : '당일 마감'}</option>)}</select>
            </>}
          </div>
        </div>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>취소</Button><Button type="submit">추가</Button></div>
      </form>
    </Modal>
  );
}
