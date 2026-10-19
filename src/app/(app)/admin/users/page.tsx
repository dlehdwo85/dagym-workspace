'use client';
import { useEffect, useState } from 'react';
import { SpacesTab } from '@/components/SpacesTab';
import { api, useApi } from '@/components/client';
import { useSession } from '@/components/session';
import { Button, ErrorBox, Field, Loading, Modal, cx, fmtDateTime, inputCls, refreshBadges, toast } from '@/components/ui';
import { ROLE_LABEL, type Role } from '@/lib/types';
import { MenuPermsTab } from '@/components/MenuPerms';
import { TeamsTab } from '@/components/Teams';

const STATUS: Record<string, string> = { invited: '초대됨', active: '사용 중', disabled: '사용 중지', left: '퇴사' };

function UnitChecks({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  // 관리자 화면: 앱 심사용 격리 조직도 포함한 전체 조직
  const all = useApi<{ units: any[] }>('/api/admin/org-units');
  return (
    <div className="max-h-48 space-y-1 overflow-y-auto rounded border p-2">
      {(all.data?.units ?? []).filter((o) => o.active).map((o) => (
        <label key={o.id} className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={value.includes(o.id)} onChange={(e) => onChange(e.target.checked ? [...value, o.id] : value.filter((x) => x !== o.id))} />{o.name}
          {o.is_demo && <span className="rounded bg-amber-100 px-1 text-[11px] text-amber-800">앱 심사용 격리</span>}
        </label>
      ))}
    </div>
  );
}

export default function UsersPage() {
  const { user } = useSession();
  const [tab, setTabState] = useState<'users' | 'teams' | 'menus' | 'spaces'>('users');
  // 탭을 주소(?tab=)에도 남김 → 팀 보드 등 하위 화면에서 뒤로 오면 그 탭이 다시 열림
  const setTab = (t: 'users' | 'teams' | 'menus' | 'spaces') => { setTabState(t); try { const u = new URL(window.location.href); if (t === 'users') u.searchParams.delete('tab'); else u.searchParams.set('tab', t); window.history.replaceState(window.history.state, '', u.toString()); } catch {} };
  // 대기열 ①(10/19): 팀 보드 뒤로가기 등 ?tab=teams 로 오면 그 탭
  useEffect(() => { const t = new URLSearchParams(window.location.search).get('tab'); if (t === 'teams' || t === 'menus' || t === 'spaces') setTabState(t); }, []);
  const list = useApi<{ users: any[] }>(user.role === 'owner' ? '/api/admin/users' : null);
  const tabs = [['users', '사용자'], ['teams', '부서·팀'], ...(user.role === 'owner' ? [['menus', '메뉴 권한']] : []), ...(['owner', 'admin'].includes(user.role) ? [['spaces', '공간']] : [])] as ['users' | 'teams' | 'menus' | 'spaces', string][];
  return (
    <div className="space-y-3">
      <div className="flex gap-1.5" role="tablist" aria-label="사용자 관리">
        {tabs.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} data-testid={`tab-${k}`}
            className={cx('rounded-full border px-3 py-1 text-sm', tab === k ? 'border-brand-600 bg-brand-50 font-semibold text-brand-700' : 'border-line bg-white text-ink-2')}>{l}</button>
        ))}
      </div>
      {tab === 'users' ? <Users /> : tab === 'teams' ? <TeamsTab /> : tab === 'spaces' ? <SpacesTab /> : <MenuPermsTab users={list.data?.users ?? []} />}
    </div>
  );
}

function Users() {
  const { user, dir, menus } = useSession();
  const canEdit = (menus?.admin_users ?? 'none') === 'edit'; // V14 7번: 조회만이면 읽기 전용
  const { data, error, loading, reload } = useApi<{ users: any[] }>('/api/admin/users');
  const [inv, setInv] = useState<any>(null);
  const [invKey, setInvKey] = useState(0); // 초대 창을 열 때마다 조직·팀 목록 새로 읽기(새로 만든 조직·팀이 바로 보이게)
  const teamsList = useApi<{ teams: any[] }>('/api/teams');
  const spaceInfo = useApi<{ spaces: string[] }>('/api/spaces');
  const [link, setLink] = useState('');
  const [edit, setEdit] = useState<any>(null);
  const [review, setReview] = useState<{ email: string; name: string } | null>(null);
  const [reviewMsg, setReviewMsg] = useState('');
  // 로컬 검수 10/17: 심사용 체험 계정은 직원 목록에 섞지 않고 접어 둠
  const [showDemo, setShowDemo] = useState(false);
  const demoN = data?.users.filter((u: any) => u.is_demo).length ?? 0;
  const allUnits = useApi<{ units: any[] }>('/api/admin/org-units');
  const roles = (Object.keys(ROLE_LABEL) as Role[]).filter((r) => r !== 'owner' || user.role === 'owner');

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    try { const r = await api('/api/admin/users', { body: inv }); setLink(location.origin + r.path); setInv(null); reload(); } catch (er: any) { toast.error(er.message); }
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    try { await api(`/api/admin/users/${edit.id}`, { method: 'PATCH', body: { name: edit.name, title: edit.title, titleShort: edit.title_short ?? null, role: edit.role, status: edit.status === 'invited' ? undefined : edit.status, orgUnitIds: edit.org_unit_ids } }); toast.ok('저장했습니다'); setEdit(null); reload(); refreshBadges(); } catch (er: any) { toast.error(er.message); }
  }
  async function reset(u: any) {
    try { const r = await api(`/api/admin/users/${u.id}/reset-password`, { body: {} }); setLink(location.origin + r.path); } catch (er: any) { toast.error(er.message); }
  }
  async function reinvite(u: any) {
    try { const r = await api('/api/admin/users', { body: { email: u.email, name: u.name, role: u.role, orgUnitIds: u.org_unit_ids, title: u.title ?? undefined } }); setLink(location.origin + r.path); reload(); } catch (er: any) { toast.error(er.message); }
  }
  const unitName = (id: string) => allUnits.data?.units.find((o) => o.id === id)?.name ?? dir.orgUnits.find((o) => o.id === id)?.name ?? '';
  async function setupReview(e: React.FormEvent) {
    e.preventDefault();
    try {
      const r = await api('/api/admin/review-account', { body: review });
      setReview(null); reload(); allUnits.reload();
      setReviewMsg(r.alreadyActive ? '이미 비밀번호를 정한 심사용 계정입니다. 예시 데이터만 새로 만들었습니다.' : '초대 링크에서 비밀번호를 직접 정하세요. 그 아이디·비밀번호를 TestFlight "베타 앱 심사 정보"에 입력합니다.');
      if (r.invitePath) setLink(location.origin + r.invitePath); else toast.ok('예시 데이터를 새로 만들었습니다');
    } catch (er: any) { toast.error(er.message); }
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">사용자·권한</h1>
        <span className="flex flex-wrap gap-2">
          {user.role === 'owner' && <Button variant="secondary" onClick={() => setReview({ email: '', name: '앱 심사 담당자' })} data-testid="review-account">심사용 체험 계정</Button>}
          {canEdit ? <Button onClick={() => { setInvKey((k) => k + 1); allUnits.reload(); teamsList.reload(); setInv({ email: '', name: '', role: 'staff', orgUnitIds: [], teamIds: [] }); }} data-testid="invite-open">+ 직원 초대</Button> : <span className="text-xs text-ink-3" data-testid="users-readonly">조회 권한 — 바꾸려면 대표에게 &ldquo;편집&rdquo;을 요청하세요</span>}
        </span>
      </div>
      {demoN > 0 && <button type="button" className="text-xs text-ink-2 underline" onClick={() => setShowDemo((x) => !x)} data-testid="demo-toggle">{showDemo ? '심사용 체험 계정 숨기기' : `심사용 체험 계정 ${demoN}개 보기`}</button>}
      {error ? <ErrorBox error={error} retry={reload} /> : loading && !data ? <Loading /> : (
        <div className="overflow-x-auto rounded-lg border bg-white">
          <table className="w-full text-sm" data-testid="users">
            <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="p-2">이름</th><th className="p-2">권한</th><th className="p-2">소속</th><th className="p-2">상태</th><th className="p-2">최근 로그인</th><th className="p-2"></th></tr></thead>
            <tbody className="divide-y">{data!.users.filter((u: any) => showDemo || !u.is_demo).map((u) => (
              <tr key={u.id} className={cx(u.status !== 'active' && u.status !== 'invited' && 'text-slate-400')}>
                <td className="p-2"><div className="font-medium">{u.name}{u.is_demo && <span className="ml-1.5 rounded bg-amber-100 px-1.5 text-[11px] font-medium text-amber-800">심사용</span>}</div><div className="text-xs text-slate-500">{u.email}{u.title ? ` · ${u.title}` : ''}{u.title_short ? ` (${u.title_short})` : ''}</div></td>
                <td className="p-2">{ROLE_LABEL[u.role as Role]}</td>
                <td className="p-2 text-xs">{u.org_unit_ids.map(unitName).join(', ') || '-'}</td>
                <td className="p-2">{STATUS[u.status]}{u.status === 'invited' && u.invite_expires_at && <div className="text-xs text-slate-400">만료 {fmtDateTime(u.invite_expires_at)}</div>}</td>
                <td className="p-2 text-xs">{u.last_login_at ? fmtDateTime(u.last_login_at) : '-'}</td>
                <td className="p-2 text-right whitespace-nowrap">{canEdit && <>
                  <Button size="sm" variant="ghost" onClick={() => setEdit({ ...u })}>편집</Button>
                  {u.status === 'active' && <Button size="sm" variant="ghost" onClick={() => reset(u)}>비번 재설정 링크</Button>}
                  {u.status === 'invited' && <Button size="sm" variant="ghost" onClick={() => reinvite(u)}>초대 링크 재발급</Button>}
                </>}</td>
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
          <fieldset><legend className="mb-1 text-xs font-medium text-slate-600">소속 (접근 가능한 조직)</legend><UnitChecks key={invKey} value={inv.orgUnitIds} onChange={(v) => setInv({ ...inv, orgUnitIds: v })} />
            <p className="mt-1 text-xs text-slate-500">선택한 조직과 그 하위 조직의 업무·일정만 볼 수 있습니다. 대표·본사 관리자는 전체를 봅니다.</p></fieldset>
          {/* 대기열 ①(10/19): 부서·팀에 넣기(팀원으로) + 그 부서·팀 기본 공간을 제안 */}
          <fieldset data-testid="invite-teams"><legend className="mb-1 text-xs font-medium text-slate-600">부서·팀</legend>
            <div className="max-h-36 space-y-1 overflow-y-auto rounded border p-2">
              {(teamsList.data?.teams ?? []).map((t: any) => <label key={t.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={(inv.teamIds ?? []).includes(t.id)}
                onChange={(e) => { const teamIds = e.target.checked ? [...(inv.teamIds ?? []), t.id] : (inv.teamIds ?? []).filter((x: string) => x !== t.id); const chosen = (teamsList.data?.teams ?? []).filter((x: any) => teamIds.includes(x.id));
                  setInv({ ...inv, teamIds, spaces: chosen.length ? [...new Set<string>(chosen.flatMap((x: any) => x.default_spaces ?? ['work']))] : inv.spaces }); }} data-testid="invite-team" />
                {t.kind === 'team' && t.parent_name ? <span className="text-ink-3">{t.parent_name} / </span> : null}{t.name}<span className="text-[11px] text-ink-3">{t.kind === 'dept' ? '부서' : '팀'}{t.isolated ? ' · 격리' : ''}</span></label>)}
              {!(teamsList.data?.teams ?? []).length && <p className="text-xs text-ink-3">아직 부서·팀이 없습니다 — 팀 탭에서 만들 수 있습니다</p>}
            </div></fieldset>
          <fieldset data-testid="invite-spaces"><legend className="mb-1 text-xs font-medium text-slate-600">공간 {inv.teamIds?.length ? <span className="font-normal text-ink-3">(고른 부서·팀의 기본 공간을 제안)</span> : null}</legend>
            <div className="flex gap-3 text-sm">{([['work', '업무'], ['sales', '영업'], ['marketing', '마케팅']] as const).filter(([k]) => k === 'work' || (spaceInfo.data?.spaces ?? []).includes(k)).map(([k, l]) => (
              <label key={k} className="flex items-center gap-1.5"><input type="checkbox" checked={(inv.spaces ?? ['work']).includes(k)} onChange={(e) => { const cur = inv.spaces ?? ['work']; setInv({ ...inv, spaces: e.target.checked ? [...cur, k] : cur.filter((x: string) => x !== k) }); }} data-testid={`invite-space-${k}`} />{l}</label>))}</div></fieldset>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setInv(null)}>취소</Button><Button type="submit">초대 링크 만들기</Button></div>
        </form>}
      </Modal>
      <Modal open={!!review} onClose={() => setReview(null)} title="심사용 체험 계정">
        {review && <form onSubmit={setupReview} className="space-y-3">
          <p className="text-sm text-ink-2">App Store·Play 심사 담당자가 로그인해 볼 계정입니다. <b>격리된 “체험 조직(심사용)”</b>과 예시 업무·일정을 만들고, 이 이메일로 초대 링크를 만듭니다. 이 계정은 회사 업무·사람을 전혀 볼 수 없고, 대표 화면에도 체험 데이터가 섞이지 않습니다. 다시 누르면 예시 데이터를 새로 만듭니다.</p>
          <Field label="심사용 이메일 (회사 계정과 다른 주소)"><input type="email" required className={inputCls} value={review.email} onChange={(e) => setReview({ ...review, email: e.target.value })} placeholder="review@회사도메인" /></Field>
          <Field label="표시 이름"><input className={inputCls} value={review.name} onChange={(e) => setReview({ ...review, name: e.target.value })} /></Field>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setReview(null)}>취소</Button><Button type="submit">만들기</Button></div>
        </form>}
      </Modal>
      <Modal open={!!link} onClose={() => { setLink(''); setReviewMsg(''); }} title="링크를 전달하세요">
        {reviewMsg && <p className="mb-2 rounded-input bg-amber-50 p-2 text-sm text-amber-900" data-testid="review-msg">{reviewMsg}</p>}
        <p className="text-sm text-slate-600">아래 링크를 카카오톡·문자·메일로 본인에게만 전달하세요. 링크는 1회용이며 초대 7일·재설정 24시간 후 만료됩니다.</p>
        <input readOnly className={cx(inputCls, 'mt-2 font-mono text-xs')} value={link} onFocus={(e) => e.target.select()} data-testid="invite-link" />
        <div className="mt-3 flex justify-end"><Button onClick={() => { navigator.clipboard?.writeText(link); toast.ok('복사했습니다'); }}>복사</Button></div>
      </Modal>
      <Modal open={!!edit} onClose={() => setEdit(null)} title="사용자 편집">
        {edit && <form onSubmit={save} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="이름"><input className={inputCls} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="직책"><input className={inputCls} value={edit.title ?? ''} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></Field>
            <Field label="직책 약칭 (예: CEO·CPO, 아바타 옆에 표시 — 비우면 직책)"><input className={inputCls} maxLength={12} value={edit.title_short ?? ''} onChange={(e) => setEdit({ ...edit, title_short: e.target.value })} aria-label="직책 약칭" /></Field>
            <Field label="권한"><select className={inputCls} value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })}>{roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></Field>
            <Field label="상태"><select className={inputCls} value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })} disabled={edit.status === 'invited'}>
              {edit.status === 'invited' && <option value="invited">초대됨</option>}<option value="active">사용 중</option><option value="disabled">사용 중지</option><option value="left">퇴사</option></select></Field>
          </div>
          <fieldset><legend className="mb-1 text-xs font-medium text-slate-600">소속</legend><UnitChecks value={edit.org_unit_ids} onChange={(v) => setEdit({ ...edit, org_unit_ids: v })} /></fieldset>
          <p className="text-xs text-slate-500">사용 중지·퇴사로 바꾸면 모든 기기에서 즉시 로그아웃되고 푸시·Google 동기화도 멈춥니다. 작성한 업무 기록은 남습니다.</p>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setEdit(null)}>취소</Button><Button type="submit">저장</Button></div>
        </form>}
      </Modal>
    </div>
  );
}
