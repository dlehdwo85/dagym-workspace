'use client';
import { useState } from 'react';
import { ArrowDown, ArrowUp, ChevronRight, Plus, Stamp, Trash2 } from 'lucide-react';
import { api, useApi } from '@/components/client';
import { useSession } from '@/components/session';
import { Button, Empty, Field, Modal, PageHeader, cx, inputCls, toast } from '@/components/ui';
import { UnitSelect } from '@/components/pickers';
import { ROLE_LABEL } from '@/lib/types';

type Step = { label: string; type: 'role' | 'user'; role?: string; userId?: string };
const ROLES = ['site_manager', 'dept_lead', 'admin', 'owner'] as const;

/** B-9 결재선 관리 (대표·본사 관리자) */
export default function ApprovalLinesPage() {
  const { dir } = useSession();
  const { data, reload } = useApi<{ lines: any[] }>('/api/approval-lines');
  const [edit, setEdit] = useState<{ id?: string; name: string; orgUnitId: string; steps: Step[]; active: boolean } | null>(null);
  const userName = (id?: string) => dir.users.find((u) => u.id === id)?.name ?? '';
  const stepText = (s: Step) => (s.type === 'user' ? userName(s.userId) : `${ROLE_LABEL[s.role as keyof typeof ROLE_LABEL]}`);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!edit) return;
    const body = { name: edit.name, orgUnitId: edit.orgUnitId || null, steps: edit.steps.map((s) => ({ label: s.label || stepText(s), type: s.type, ...(s.type === 'role' ? { role: s.role } : { userId: s.userId }) })), active: edit.active };
    try {
      await api(edit.id ? `/api/approval-lines/${edit.id}` : '/api/approval-lines', { method: edit.id ? 'PATCH' : 'POST', body });
      toast.ok('결재선을 저장했습니다'); setEdit(null); reload();
    } catch (er: any) { toast.error(er.message); }
  }
  const setStep = (i: number, p: Partial<Step>) => setEdit((x) => x && { ...x, steps: x.steps.map((s, j) => (j === i ? { ...s, ...p } : s)) });
  const move = (i: number, d: number) => setEdit((x) => { if (!x) return x; const s = [...x.steps]; const j = i + d; if (j < 0 || j >= s.length) return x; [s[i], s[j]] = [s[j], s[i]]; return { ...x, steps: s }; });
  return (
    <div className="space-y-4">
      <PageHeader title="결재선" icon={Stamp} sub="계약·지출처럼 여러 단계 승인이 필요한 업무에 지정합니다. 단계 순서대로 결재 요청이 가고, 반려하면 사유와 함께 담당자에게 돌아갑니다."
        actions={<Button onClick={() => setEdit({ name: '', orgUnitId: '', steps: [{ label: '현장 관리자', type: 'role', role: 'site_manager' }, { label: '대표', type: 'role', role: 'owner' }], active: true })}><Plus />결재선 만들기</Button>} />
      {!data?.lines.length ? <Empty title="결재선이 없습니다" icon={Stamp}>예: 현장 관리자 → 본사 관리자 → 대표</Empty> : (
        <ul className="space-y-2" data-testid="approval-lines">
          {data.lines.map((l) => (
            <li key={l.id} className={cx('flex flex-wrap items-center gap-3 rounded-card border border-line bg-white p-4 shadow-card', !l.active && 'opacity-60')}>
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{l.name} {!l.active && <span className="text-xs font-normal text-ink-3">(사용 안 함)</span>}</div>
                <div className="text-xs text-ink-2">{l.org_unit_name ?? '전사 공통'}</div>
                <ol className="mt-2 flex flex-wrap items-center gap-1 text-sm">
                  {l.steps.map((s: Step, i: number) => <li key={i} className="flex items-center gap-1"><span className="rounded-md bg-amber-50 px-2 py-0.5 font-medium text-amber-800">{i + 1}. {s.label}</span>{i < l.steps.length - 1 && <ChevronRight className="size-3.5 text-ink-3" />}</li>)}
                </ol>
              </div>
              <Button size="sm" variant="secondary" onClick={() => setEdit({ id: l.id, name: l.name, orgUnitId: l.org_unit_id ?? '', steps: l.steps, active: l.active })}>편집</Button>
            </li>
          ))}
        </ul>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? '결재선 편집' : '결재선 만들기'} wide>
        {edit && (
          <form onSubmit={save} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="이름"><input className={inputCls} required value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="예: 강사 계약 결재" /></Field>
              <Field label="사용 범위"><UnitSelect value={edit.orgUnitId} onChange={(v) => setEdit({ ...edit, orgUnitId: v })} allowEmpty="전사 공통" /></Field>
            </div>
            <div>
              <div className="mb-1.5 text-xs font-medium text-ink-2">결재 단계 (위에서부터 순서대로)</div>
              <ol className="space-y-2">
                {edit.steps.map((s, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2 rounded-input border border-line p-2">
                    <span className="flex size-6 items-center justify-center rounded-full bg-amber-100 text-xs font-bold text-amber-800">{i + 1}</span>
                    <input className={inputCls + ' h-9 w-36'} value={s.label} onChange={(e) => setStep(i, { label: e.target.value })} placeholder="단계 이름" aria-label={`${i + 1}단계 이름`} />
                    <select className={inputCls + ' h-9 w-28'} value={s.type} onChange={(e) => setStep(i, { type: e.target.value as Step['type'] })} aria-label={`${i + 1}단계 결재자 방식`}><option value="role">역할</option><option value="user">지정 사람</option></select>
                    {s.type === 'role'
                      ? <select className={inputCls + ' h-9 flex-1'} value={s.role} onChange={(e) => setStep(i, { role: e.target.value })} aria-label={`${i + 1}단계 역할`}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}{r === 'site_manager' || r === 'dept_lead' ? ' (업무 소속·상위 조직)' : ''}</option>)}</select>
                      : <select className={inputCls + ' h-9 flex-1'} value={s.userId ?? ''} onChange={(e) => setStep(i, { userId: e.target.value })} aria-label={`${i + 1}단계 사람`} required><option value="">선택</option>{dir.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>}
                    <button type="button" className="rounded p-1 text-ink-3 hover:bg-slate-100" onClick={() => move(i, -1)} aria-label="위로"><ArrowUp className="size-4" /></button>
                    <button type="button" className="rounded p-1 text-ink-3 hover:bg-slate-100" onClick={() => move(i, 1)} aria-label="아래로"><ArrowDown className="size-4" /></button>
                    <button type="button" className="rounded p-1 text-ink-3 hover:bg-red-50 hover:text-red-600 disabled:opacity-30" disabled={edit.steps.length <= 1} onClick={() => setEdit({ ...edit, steps: edit.steps.filter((_, j) => j !== i) })} aria-label="단계 삭제"><Trash2 className="size-4" /></button>
                  </li>
                ))}
              </ol>
              {edit.steps.length < 6 && <Button type="button" size="sm" variant="ghost" className="mt-1" onClick={() => setEdit({ ...edit, steps: [...edit.steps, { label: '', type: 'role', role: 'admin' }] })}><Plus />단계 추가</Button>}
            </div>
            {edit.id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} />사용</label>}
            <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setEdit(null)}>취소</Button><Button type="submit">저장</Button></div>
          </form>
        )}
      </Modal>
    </div>
  );
}
