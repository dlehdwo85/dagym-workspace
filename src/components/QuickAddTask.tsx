'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, broadcastRefresh, useApi } from './client';
import { Button, Field, Modal, inputCls, toast, todayStr } from './ui';
import { UnitSelect, UserSelect, BrandSelect, RecurSelect } from './pickers';
import { useSession } from './session';

export interface QuickDefaults { projectId?: string; orgUnitId?: string; dueDate?: string; parentId?: string; assigneeId?: string }

export function QuickAddTask({ open, onClose, defaults, onCreated }: { open: boolean; onClose: () => void; defaults?: QuickDefaults; onCreated?: (id: string) => void }) {
  const { user, dir } = useSession();
  const router = useRouter();
  const templates = useApi<{ templates: any[] }>(open ? '/api/templates' : null);
  const projects = useApi<{ projects: any[] }>(open ? '/api/projects' : null);
  const [f, setF] = useState<any>({});
  const [busy, setBusy] = useState(false);
  const [tpl, setTpl] = useState('');

  useEffect(() => {
    if (open) {
      const mine = dir.users.find((u) => u.id === user.id)?.org_unit_ids?.[0];
      setF({ title: '', description: '', priority: 'normal', assigneeId: defaults?.assigneeId ?? user.id, dueDate: defaults?.dueDate ?? '', dueTime: '',
        startDate: '', orgUnitId: defaults?.orgUnitId ?? mine ?? dir.orgUnits[0]?.id, projectId: defaults?.projectId ?? '', brandId: undefined,
        approvalRequired: true, recurrenceRule: null, tags: '' });
      setTpl('');
    }
  }, [open, defaults, user.id, dir]);

  const set = (k: string) => (v: any) => setF((x: any) => ({ ...x, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!f.title.trim()) return toast.error('제목을 입력하세요');
    setBusy(true);
    try {
      let r: { id: string };
      if (tpl) {
        r = await api(`/api/templates/${tpl}/apply`, { body: { title: f.title, orgUnitId: f.orgUnitId, projectId: f.projectId || null, assigneeId: f.assigneeId, dueDate: f.dueDate || undefined, brandId: f.brandId } });
      } else {
        r = await api('/api/tasks', {
          queueOffline: `업무 등록: ${f.title}`,
          body: {
            title: f.title, description: f.description, priority: f.priority, assigneeId: f.assigneeId, orgUnitId: f.orgUnitId,
            projectId: f.projectId || null, parentId: defaults?.parentId, dueDate: f.dueDate || null, dueTime: f.dueTime || null,
            startDate: f.startDate || null, approvalRequired: f.approvalRequired, recurrenceRule: f.recurrenceRule, brandId: f.brandId,
            tags: f.tags ? f.tags.split(',').map((t: string) => t.trim()).filter(Boolean) : [],
          },
        });
      }
      toast.ok('업무를 등록했습니다');
      broadcastRefresh();
      onClose();
      if (onCreated) onCreated(r.id); else router.push(`/tasks/${r.id}`);
    } catch (err: any) {
      if (err.code === 'queued') { toast.info(err.message); onClose(); } else toast.error(err.message);
    } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title={defaults?.parentId ? '하위 업무 추가' : '업무 등록'}>
      <form onSubmit={submit} className="space-y-3">
        {!defaults?.parentId && (
          <Field label="템플릿에서 시작 (선택)">
            <select className={inputCls} value={tpl} onChange={(e) => {
              setTpl(e.target.value);
              const t = templates.data?.templates.find((x) => x.id === e.target.value);
              if (t) setF((x: any) => ({ ...x, title: t.payload.title ?? x.title, priority: t.payload.priority ?? x.priority, dueDate: x.dueDate || (t.payload.dueInDays !== undefined ? addDaysStr(todayStr(), t.payload.dueInDays) : '') }));
            }}>
              <option value="">빈 업무</option>
              {templates.data?.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="제목"><input autoFocus className={inputCls} value={f.title ?? ''} onChange={(e) => set('title')(e.target.value)} placeholder="무엇을 해야 하나요?" maxLength={200} /></Field>
        {!tpl && <Field label="설명"><textarea className={inputCls} rows={3} value={f.description ?? ''} onChange={(e) => set('description')(e.target.value)} /></Field>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="담당자"><UserSelect value={f.assigneeId} onChange={set('assigneeId')} /></Field>
          <Field label="마감일"><input type="date" className={inputCls} value={f.dueDate ?? ''} onChange={(e) => set('dueDate')(e.target.value)} /></Field>
          {!tpl && <Field label="마감 시각 (선택)"><input type="time" className={inputCls} value={f.dueTime ?? ''} onChange={(e) => set('dueTime')(e.target.value)} /></Field>}
          {!tpl && <Field label="시작일 (선택)"><input type="date" className={inputCls} value={f.startDate ?? ''} onChange={(e) => set('startDate')(e.target.value)} /></Field>}
          {!tpl && (
            <Field label="우선순위">
              <select className={inputCls} value={f.priority} onChange={(e) => set('priority')(e.target.value)}>
                <option value="low">낮음</option><option value="normal">보통</option><option value="high">높음</option><option value="urgent">긴급</option>
              </select>
            </Field>
          )}
          <Field label="브랜드"><BrandSelect value={f.brandId} onChange={set('brandId')} /></Field>
        </div>
        {!defaults?.parentId && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="소속 (현장·부서)"><UnitSelect value={f.orgUnitId} onChange={set('orgUnitId')} /></Field>
            <Field label="프로젝트">
              <select className={inputCls} value={f.projectId ?? ''} onChange={(e) => set('projectId')(e.target.value)}>
                <option value="">없음</option>
                {projects.data?.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
          </div>
        )}
        {!tpl && (
          <div className="grid grid-cols-2 gap-3">
            <div><div className="mb-1 text-xs font-medium text-slate-600">반복 (마감일 기준)</div><RecurSelect value={f.recurrenceRule} onChange={set('recurrenceRule')} anchorDate={f.dueDate} /></div>
            <Field label="태그 (쉼표 구분)"><input className={inputCls} value={f.tags ?? ''} onChange={(e) => set('tags')(e.target.value)} /></Field>
          </div>
        )}
        {!tpl && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.approvalRequired ?? true} onChange={(e) => set('approvalRequired')(e.target.checked)} />
            완료 시 관리자 최종 확인 필요 (검토 요청 → 확인)
          </label>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>취소</Button>
          <Button type="submit" disabled={busy}>{busy ? '등록 중…' : '등록'}</Button>
        </div>
      </form>
    </Modal>
  );
}

function addDaysStr(d: string, n: number) {
  const t = new Date(d + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
