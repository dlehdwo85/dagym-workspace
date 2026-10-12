'use client';
import { useState } from 'react';
import { api, useApi } from '@/components/client';
import { useSession } from '@/components/session';
import { Button, ErrorBox, Field, Loading, Modal, cx, fmtDateTime, inputCls, toast } from '@/components/ui';
import { ROLE_LABEL, type Role } from '@/lib/types';

const STATUS: Record<string, string> = { invited: '초대됨', active: '사용 중', disabled: '사용 중지', left: '퇴사' };

function UnitChecks({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const { dir } = useSession();
  return (
    <div className="max-h-48 space-y-1 overflow-y-auto rounded border p-2">
      {dir.orgUnits.map((o) => (
        <label key={o.id} className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={value.includes(o.id)} onChange={(e) => onChange(e.target.checked ? [...value, o.id] : value.filter((x) => x !== o.id))} />{o.name}
        </label>
      ))}
    </div>
  );
}

export default function Users() {
  const { user, dir } = useSession();
  const { data, error, loading, reload } = useApi<{ users: any[] }>('/api/admin/users');
  const [inv, setInv] = useState<any>(null);
  const [link, setLink] = useState('');
  const [edit, setEdit] = useState<any>(null);
  const roles = (Object.keys(ROLE_LABEL) as Role[]).filter((r) => r !== 'owner' || user.role === 'owner');

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    try { const r = await api('/api/admin/users', { body: inv }); setLink(location.origin + r.path); setInv(null); reload(); } catch (er: any) { toast.error(er.message); }
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    try { await api(`/api/admin/users/${edit.id}`, { method: 'PATCH', body: { name: edit.name, title: edit.title, role: edit.role, status: edit.status === 'invited' ? undefined : edit.status, orgUnitIds: edit.org_unit_ids } }); toast.ok('저장했습니다'); setEdit(null); reload(); } catch (er: any) { toast.error(er.message); }
  }
  async function reset(u: any) {
    try { const r = await api(`/api/admin/users/${u.id}/reset-password`, { body: {} }); setLink(location.origin + r.path); } catch (er: any) { toast.error(er.message); }
  }
  async function reinvite(u: any) {
    try { const r = await api('/api/admin/users', { body: { email: u.email, name: u.name, role: u.role, orgUnitIds: u.org_unit_ids, title: u.title ?? undefined } }); setLink(location.origin + r.path); reload(); } catch (er: any) { toast.error(er.message); }
  }
  const unitName = (id: string) => dir.orgUnits.find((o) => o.id === id)?.name ?? '';
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">사용자·권한</h1>
        <Button onClick={() => setInv({ email: '', name: '', role: 'staff', orgUnitIds: [] })}>+ 직원 초대</Button>
      </div>
      {error ? <ErrorBox error={error} retry={reload} /> : loading && !data ? <Loading /> : (
        <div className="overflow-x-auto rounded-lg border bg-white">
          <table className="w-full text-sm" data-testid="users">
            <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="p-2">이름</th><th className="p-2">권한</th><th className="p-2">소속</th><th className="p-2">상태</th><th className="p-2">최근 로그인</th><th className="p-2"></th></tr></thead>
            <tbody className="divide-y">{data!.users.map((u) => (
              <tr key={u.id} className={cx(u.status !== 'active' && u.status !== 'invited' && 'text-slate-400')}>
                <td className="p-2"><div className="font-medium">{u.name}</div><div className="text-xs text-slate-500">{u.email}{u.title ? ` · ${u.title}` : ''}</div></td>
                <td className="p-2">{ROLE_LABEL[u.role as Role]}</td>
                <td className="p-2 text-xs">{u.org_unit_ids.map(unitName).join(', ') || '-'}</td>
                <td className="p-2">{STATUS[u.status]}{u.status === 'invited' && u.invite_expires_at && <div className="text-xs text-slate-400">만료 {fmtDateTime(u.invite_expires_at)}</div>}</td>
                <td className="p-2 text-xs">{u.last_login_at ? fmtDateTime(u.last_login_at) : '-'}</td>
                <td className="p-2 text-right whitespace-nowrap">
                  <Button size="sm" variant="ghost" onClick={() => setEdit({ ...u })}>편집</Button>
                  {u.status === 'active' && <Button size="sm" variant="ghost" onClick={() => reset(u)}>비번 재설정 링크</Button>}
                  {u.status === 'invited' && <Button size="sm" variant="ghost" onClick={() => reinvite(u)}>초대 링크 재발급</Button>}
                </td>
              </tr>))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={!!inv} onClose={() => setInv(null)} title="직원 초대">
        {inv && <form onSubmit={invite} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="이름"><input className={inputCls} required value={inv.name} onChange={(e) => setInv({ ...inv, name: e.target.value })} /></Field>
            <Field label="회사 이메일"><input type="email" className={inputCls} required value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })} /></Field>
            <Field label="권한"><select className={inputCls} value={inv.role} onChange={(e) => setInv({ ...inv, role: e.target.value })}>{roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></Field>
            <Field label="직책 (선택)"><input className={inputCls} value={inv.title ?? ''} onChange={(e) => setInv({ ...inv, title: e.target.value })} /></Field>
          </div>
          <Field label="소속 (접근 가능한 조직)" hint="선택한 조직과 그 하위 조직의 업무·일정만 볼 수 있습니다. 대표·본사 관리자는 전체를 봅니다."><UnitChecks value={inv.orgUnitIds} onChange={(v) => setInv({ ...inv, orgUnitIds: v })} /></Field>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setInv(null)}>취소</Button><Button type="submit">초대 링크 만들기</Button></div>
        </form>}
      </Modal>
      <Modal open={!!link} onClose={() => setLink('')} title="링크를 전달하세요">
        <p className="text-sm text-slate-600">아래 링크를 카카오톡·문자·메일로 본인에게만 전달하세요. 링크는 1회용이며 초대 7일·재설정 24시간 후 만료됩니다.</p>
        <input readOnly className={cx(inputCls, 'mt-2 font-mono text-xs')} value={link} onFocus={(e) => e.target.select()} data-testid="invite-link" />
        <div className="mt-3 flex justify-end"><Button onClick={() => { navigator.clipboard?.writeText(link); toast.ok('복사했습니다'); }}>복사</Button></div>
      </Modal>
      <Modal open={!!edit} onClose={() => setEdit(null)} title="사용자 편집">
        {edit && <form onSubmit={save} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="이름"><input className={inputCls} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="직책"><input className={inputCls} value={edit.title ?? ''} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></Field>
            <Field label="권한"><select className={inputCls} value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })}>{roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></Field>
            <Field label="상태"><select className={inputCls} value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })} disabled={edit.status === 'invited'}>
              {edit.status === 'invited' && <option value="invited">초대됨</option>}<option value="active">사용 중</option><option value="disabled">사용 중지</option><option value="left">퇴사</option></select></Field>
          </div>
          <Field label="소속"><UnitChecks value={edit.org_unit_ids} onChange={(v) => setEdit({ ...edit, org_unit_ids: v })} /></Field>
          <p className="text-xs text-slate-500">사용 중지·퇴사로 바꾸면 모든 기기에서 즉시 로그아웃되고 푸시·Google 동기화도 멈춥니다. 작성한 업무 기록은 남습니다.</p>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setEdit(null)}>취소</Button><Button type="submit">저장</Button></div>
        </form>}
      </Modal>
    </div>
  );
}
