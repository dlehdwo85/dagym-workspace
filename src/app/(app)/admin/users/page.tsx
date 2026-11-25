'use client';
import { dtf } from '@/lib/dtf';
import { RoleBadge } from '@/components/RoleBadge';
import { useEffect, useState } from 'react';
import { SpacesTab } from '@/components/SpacesTab';
import { api, useApi } from '@/components/client';
import { useMultiSite, useSession, useTerms } from '@/components/session';
import { Button, ErrorBox, Field, Loading, Modal, askConfirm, cx, fmtDateTime, inputCls, refreshBadges, toast } from '@/components/ui';
import { TeamPath, TeamPicker } from '@/components/TeamPicker';
import { type Role } from '@/lib/types';
import { ROLES } from '@/lib/terms';
import { MenuPermsTab } from '@/components/MenuPerms';
import { APP_GET_URL, inviteGuideText } from '@/lib/storeLinks';
import { LeadChip, TeamsTab } from '@/components/Teams';
import { iGa, leadTitle } from '@/lib/orgKinds';
import { AlertTriangle } from 'lucide-react';
import { OffboardModal } from '@/components/admin/Offboard';
import { AssigneeRulesTab } from '@/components/admin/AssigneeRules';
import { ContractsTab, SendContractModal, type ContractPreset } from '@/components/admin/Contracts'; // #116 전자계약서
import { JoinLinkPanel } from '@/components/admin/JoinLinkPanel';

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
  const [tab, setTabState] = useState<'users' | 'teams' | 'menus' | 'spaces' | 'assignees' | 'contracts'>('users');
  // 탭을 주소(?tab=)에도 남김 → 팀 보드 등 하위 화면에서 뒤로 오면 그 탭이 다시 열림
  const setTab = (t: 'users' | 'teams' | 'menus' | 'spaces' | 'assignees' | 'contracts') => { setTabState(t); try { const u = new URL(window.location.href); if (t === 'users') u.searchParams.delete('tab'); else u.searchParams.set('tab', t); window.history.replaceState(window.history.state, '', u.toString()); } catch {} };
  // 대기열 ①(10/19): 팀 보드 뒤로가기 등 ?tab=teams 로 오면 그 탭
  useEffect(() => { const t = new URLSearchParams(window.location.search).get('tab'); if (t === 'teams' || t === 'menus' || t === 'spaces' || t === 'assignees' || t === 'contracts') setTabState(t); }, []);
  const list = useApi<{ users: any[] }>(user.role === 'owner' ? '/api/admin/users' : null);
  const tabs = [['users', '사용자'], ['teams', '부서·팀'], ...(user.role === 'owner' ? [['menus', '메뉴 권한']] : []), ...(['owner', 'admin'].includes(user.role) ? [['spaces', '공간'], ['assignees', '담당자 지정'], ['contracts', '전자계약서']] : [])] as ['users' | 'teams' | 'menus' | 'spaces' | 'assignees' | 'contracts', string][];
  return (
    <div className="space-y-3">
      <div className="flex gap-1.5" role="tablist" aria-label="사용자 관리">
        {tabs.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} data-testid={`tab-${k}`}
            className={cx('rounded-full border px-3 py-1 text-sm', tab === k ? 'border-brand-600 bg-brand-50 font-semibold text-brand-700' : 'border-line bg-white text-ink-2')}>{l}</button>
        ))}
      </div>
      {tab === 'users' ? <Users /> : tab === 'teams' ? <TeamsTab /> : tab === 'spaces' ? <SpacesTab /> : tab === 'assignees' ? <AssigneeRulesTab /> : tab === 'contracts' ? <ContractsTab /> : <MenuPermsTab users={list.data?.users ?? []} />}
    </div>
  );
}

function Users() {
  const T = useTerms(); // 범용화 2단계: 회사별 용어(다짐은 지금 표현 그대로)
  const { user, dir, menus } = useSession(); const multiSite = useMultiSite();
  const canEdit = (menus?.admin_users ?? 'none') === 'edit'; // V14 7번: 조회만이면 읽기 전용
  const { data, error, loading, reload } = useApi<{ users: any[] }>('/api/admin/users');
  const [inv, setInv] = useState<any>(null);
  const [invKey, setInvKey] = useState(0); // 초대 창을 열 때마다 조직·팀 목록 새로 읽기(새로 만든 조직·팀이 바로 보이게)
  const teamsList = useApi<{ teams: any[] }>('/api/teams');
  const spaceInfo = useApi<{ spaces: string[] }>('/api/spaces');
  const [link, setLink] = useState('');
  const [mailRes, setMailRes] = useState<{ mail: string; to: string } | null>(null); // 대표 11/20 #1083: 방금 만든 초대의 메일 결과(보냄·못 보냄)
  const [edit, setEdit] = useState<any>(null);
  const [contract, setContract] = useState<ContractPreset | null>(null); // #116 전자계약서 보내기(초대 직후·줄 버튼)
  const [withContract, setWithContract] = useState(false);
  const [review, setReview] = useState<{ email: string; name: string } | null>(null);
  const [reviewMsg, setReviewMsg] = useState('');
  // 로컬 검수 10/17: 심사용 체험 계정은 직원 목록에 섞지 않고 접어 둠
  const [showDemo, setShowDemo] = useState(false);
  // 대표 10/20 7): 퇴사 처리·인수인계·복직 + 목록 필터(사용 중 / 퇴사)
  const [off, setOff] = useState<{ id: string; mode: 'leave' | 'handover' } | null>(null);
  const [showLeft, setShowLeft] = useState(false);
  const leftN = data?.users.filter((u: any) => u.status === 'left').length ?? 0;
  const todayK = dtf('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  async function rejoin(u: any) { if (!(await askConfirm(`${u.name}님을 복직 처리할까요? (퇴사일부터 30일 안)`, { title: '복직 처리', ok: '복직' }))) return; try { await api(`/api/admin/users/${u.id}/rejoin`, { body: {} }); toast.ok('복직 처리했습니다'); reload(); } catch (e: any) { toast.error(e.message); } }
  const demoN = data?.users.filter((u: any) => u.is_demo).length ?? 0;
  const allUnits = useApi<{ units: any[] }>('/api/admin/org-units');
  const roles = ROLES.filter((r) => r !== 'owner' || user.role === 'owner');

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    try { const r = await api('/api/admin/users', { body: inv }); setMailRes({ mail: r.mail, to: inv.email }); setLink(location.origin + r.path); const wc = withContract ? { userId: r.userId as string, name: inv.name as string, email: inv.email as string } : null; setInv(null); reload(); if (wc) setContract(wc); } catch (er: any) { toast.error(er.message); }
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    // #681: 이 사람이 장이던 곳에서 빼면 새 장을 같이 정함(고르지 않으면 '장 없음'으로 남고 알림)
    const lostIds = new Set(lostLeads(edit).map((t: any) => t.id));
    const newLeads = Object.entries((edit.newLeads ?? {}) as Record<string, string>).filter(([tid, uid]) => uid && lostIds.has(tid)).map(([teamId, userId]) => ({ teamId, userId }));
    try {
      const r = await api(`/api/admin/users/${edit.id}`, { method: 'PATCH', body: { name: edit.name, title: edit.title, titleShort: edit.title_short ?? null, role: edit.role, status: edit.status === 'invited' ? undefined : edit.status, orgUnitIds: edit.org_unit_ids , ...(edit.teamIds ? { teamIds: edit.teamIds, primaryTeamId: edit.primaryTeamId ?? null } : {}), ...(newLeads.length ? { newLeads } : {})} });
      const empty: { name: string; kind: string }[] = r?.leadless ?? [];
      if (empty.length) toast.info(`저장했습니다 — ${empty.map((t) => `${t.name}의 ${leadTitle(t.kind)}`).join(', ')}${iGa(leadTitle(empty[empty.length - 1].kind))} 비었습니다. 부서·팀 탭에서 정하세요`);
      else toast.ok('저장했습니다');
      setEdit(null); reload(); teamsList.reload(); refreshBadges();
    } catch (er: any) { toast.error(er.message); }
  }
  /** #681 편집 중 소속에서 빠지는데 이 사람이 장인 곳 */
  const lostLeads = (e: any) => { const ids: string[] = e.teamIds ?? (e.teams ?? []).map((t: any) => t.id); return (e.teams ?? []).filter((t: any) => t.lead && !ids.includes(t.id)); };
  async function reset(u: any) {
    try { const r = await api(`/api/admin/users/${u.id}/reset-password`, { body: {} }); setMailRes(null); setLink(location.origin + r.path); } catch (er: any) { toast.error(er.message); }
  }
  async function cancelInv(u: any) {
    if (!(await askConfirm(`${u.name}(${u.email}) 초대를 취소할까요?\n\n보낸 초대 링크는 더 쓸 수 없고, 목록에는 '초대 취소됨'으로 남습니다. 다시 초대하려면 [+ 직원 초대]에 같은 이메일을 넣으세요.`, { title: '초대 취소', ok: '초대 취소', danger: true }))) return;
    try { await api(`/api/admin/users/${u.id}/cancel-invite`, { body: {} }); toast.ok(`${u.name} 초대를 취소했습니다`); reload(); } catch (er: any) { toast.error(er.message); }
  }
  async function reinvite(u: any) {
    try { const r = await api('/api/admin/users', { body: { email: u.email, name: u.name, role: u.role, orgUnitIds: u.org_unit_ids, title: u.title ?? undefined } }); setMailRes({ mail: r.mail, to: u.email }); setLink(location.origin + r.path); reload(); } catch (er: any) { toast.error(er.message); }
  }
  const unitName = (id: string) => allUnits.data?.units.find((o) => o.id === id)?.name ?? dir.orgUnits.find((o) => o.id === id)?.name ?? '';
  async function setupReview(e: React.FormEvent) {
    e.preventDefault();
    try {
      const r = await api('/api/admin/review-account', { body: review });
      setReview(null); reload(); allUnits.reload();
      setReviewMsg(r.alreadyActive ? '이미 비밀번호를 정한 심사용 계정입니다. 예시 데이터만 새로 만들었습니다.' : '초대 링크에서 비밀번호를 직접 정하세요. 그 아이디·비밀번호를 TestFlight "베타 앱 심사 정보"에 입력합니다.');
      setMailRes(null); if (r.invitePath) setLink(location.origin + r.invitePath); else toast.ok('예시 데이터를 새로 만들었습니다');
    } catch (er: any) { toast.error(er.message); }
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">사용자·권한</h1>
        <span className="flex flex-wrap gap-2">
          {user.role === 'owner' && <Button variant="secondary" onClick={() => setReview({ email: '', name: '앱 심사 담당자' })} data-testid="review-account">심사용 체험 계정</Button>}
          {canEdit ? <Button onClick={() => { setInvKey((k) => k + 1); allUnits.reload(); teamsList.reload(); setInv({ email: '', name: '', role: 'staff', orgUnitIds: [], teamIds: [] }); }} data-testid="invite-open">+ 직원 초대</Button> : <span className="text-xs text-ink-3" data-testid="users-readonly">조회 권한 — 바꾸려면 {T.role.owner}에게 &ldquo;편집&rdquo;을 요청하세요</span>}
        </span>
      </div>
      {demoN > 0 && <button type="button" className="text-xs text-ink-2 underline" onClick={() => setShowDemo((x) => !x)} data-testid="demo-toggle">{showDemo ? '심사용 체험 계정 숨기기' : `심사용 체험 계정 ${demoN}개 보기`}</button>}
      {leftN > 0 && <button type="button" className="ml-3 text-xs text-ink-2 underline" onClick={() => setShowLeft((x) => !x)} data-testid="left-toggle">{showLeft ? '퇴사자 숨기기' : `퇴사자 ${leftN}명 보기`}</button>}
      {(user.role === 'owner' || user.role === 'admin') && <JoinLinkPanel canEdit={canEdit} />}{/* #1176 회사 초대 링크 · 합류 신청 · 회사 메일 도메인 */}
      {error ? <ErrorBox error={error} retry={reload} /> : loading && !data ? <Loading /> : (
        <div className="overflow-x-auto rounded-lg border bg-white">
          <table className="w-full text-sm" data-testid="users">
            <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="p-2">이름</th><th className="p-2">권한</th><th className="p-2">소속</th><th className="p-2">상태</th><th className="p-2">최근 로그인</th><th className="p-2"></th></tr></thead>
            <tbody className="divide-y">{data!.users.filter((u: any) => (showDemo || !u.is_demo) && (showLeft || u.status !== 'left')).map((u) => (
              <tr key={u.id} className={cx(u.status !== 'active' && u.status !== 'invited' && 'text-slate-400')}>
                <td className="p-2"><div className="font-medium">{u.name}{u.is_demo && <span className="ml-1.5 rounded bg-amber-100 px-1.5 text-[11px] font-medium text-amber-800">심사용</span>}{!u.has_password && u.social?.length > 0 && <span className="ml-1.5 rounded bg-sky-50 px-1.5 text-[11px] font-medium text-sky-800" title="아이폰 앱은 이메일·비밀번호로만 로그인합니다 — 아이폰을 쓰면 [재설정 링크]로 비밀번호를 만들게 해 주세요" data-testid="user-social-only">{u.social.map((p: string) => ({ kakao: '카카오', naver: '네이버', google: 'Google', apple: 'Apple' } as Record<string, string>)[p] ?? p).join('·')}만 · 비밀번호 없음</span>}</div><div className="text-xs text-slate-500">{u.email}{u.title ? ` · ${u.title}` : ''}{u.title_short ? ` (${u.title_short})` : ''}</div></td>
                <td className="p-2"><span className="flex items-center gap-1.5"><RoleBadge role={u.role} guest={u.is_demo} size="sm" /><span className="text-xs text-ink-2">{T.role[u.role as Role]}</span></span></td>
                <td className="p-2 text-xs">{(u.teams ?? []).length ? (u.teams as any[]).map((t, i) => <span key={t.id} className="mr-1.5 inline-flex items-center gap-0.5"><TeamPath path={t.path} />{t.primary && (u.teams as any[]).length > 1 && <span className="rounded bg-brand-50 px-1 text-[10px] text-brand-700">주</span>}{t.lead && <LeadChip kind={t.kind} />}{i < (u.teams as any[]).length - 1 ? '' : ''}</span>) : <span className="text-ink-3">{u.org_unit_ids.map(unitName).join(', ') || '-'}</span>}</td>
                <td className="p-2" data-testid="user-status">{u.status === 'left' && u.left_at ? `퇴사(${u.left_at.slice(5).replace('-', '/')})` : u.status === 'disabled' && !u.has_password && !u.last_login_at ? '초대 취소됨' : STATUS[u.status]}{u.status === 'invited' && u.invite_expires_at && <div className="text-xs text-slate-400">만료 {fmtDateTime(u.invite_expires_at)}</div>}{u.status === 'invited' && u.invite_mail?.status && u.invite_mail.status !== 'off' && <div className={cx('text-xs', u.invite_mail.status === 'failed' ? 'text-red-600' : 'text-slate-400')} data-testid="user-invite-mail">{u.invite_mail.status === 'failed' ? '초대 메일 못 보냄 — 링크를 직접 전달' : u.invite_mail.status === 'sent' ? `메일 보냄${u.invite_mail.at ? ` ${fmtDateTime(u.invite_mail.at)}` : ''}` : '메일 안 보냄(시험 환경)'}</div>}{u.status === 'left' && u.rejoin_until && u.rejoin_until >= todayK && <div className="text-xs text-slate-400">복직 가능 ~{u.rejoin_until.slice(5).replace('-', '/')}</div>}</td>
                <td className="p-2 text-xs">{u.last_login_at ? fmtDateTime(u.last_login_at) : '-'}</td>
                <td className="p-2 text-right whitespace-nowrap">{canEdit && <>
                  <Button size="sm" variant="ghost" onClick={() => setEdit({ ...u })}>편집</Button>
                  {u.status !== 'left' && !u.is_demo && !(u.status === 'disabled' && !u.has_password && !u.last_login_at) /* 초대 취소됨에는 안 보임(로컬 11/21) */ && <Button size="sm" variant="ghost" onClick={() => setContract({ userId: u.id, name: u.name, email: u.email, phone: u.phone })} data-testid="user-contract">전자계약서</Button>}
                  {u.status === 'active' && <Button size="sm" variant="ghost" onClick={() => reset(u)}>비번 재설정 링크</Button>}
                  {u.status === 'invited' && <Button size="sm" variant="ghost" onClick={() => reinvite(u)} data-testid="user-reinvite" title="새 초대 링크를 만들어 메일로 다시 보냅니다(예전 링크는 더 이상 쓸 수 없음)">초대 메일 다시 보내기</Button>}
                  {u.status === 'invited' && <Button size="sm" variant="ghost" onClick={() => cancelInv(u)} data-testid="user-cancel-invite" title="보낸 초대 링크를 취소합니다(가입 전인 사람만)">초대 취소</Button>}
                  {u.status === 'active' && u.id !== user.id && <Button size="sm" variant="ghost" onClick={() => setOff({ id: u.id, mode: 'leave' })} data-testid="user-leave">퇴사 처리</Button>}
                  {u.status === 'left' && <Button size="sm" variant="ghost" onClick={() => setOff({ id: u.id, mode: 'handover' })} data-testid="user-handover">인수인계</Button>}
                  {u.status === 'left' && u.rejoin_until && u.rejoin_until >= todayK && <Button size="sm" variant="ghost" onClick={() => rejoin(u)} data-testid="user-rejoin">복직</Button>}
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
            <Field label="권한"><select className={inputCls} value={inv.role} onChange={(e) => setInv({ ...inv, role: e.target.value })}>{roles.map((r) => <option key={r} value={r}>{T.role[r]}</option>)}</select></Field>
            <Field label="직책 (선택)"><input className={inputCls} value={inv.title ?? ''} onChange={(e) => setInv({ ...inv, title: e.target.value })} /></Field>
          </div>
          {/* 대표 10/20 15:15 재정비: '소속' 하나(부서 › 팀 트리, 주 소속 + 겸직) — 접근 범위는 자동, 예전 '접근 가능한 조직' 체크는 고급 */}
          <fieldset data-testid="invite-teams"><legend className="mb-1 text-xs font-medium text-slate-600">소속</legend>
            <TeamPicker key={invKey} teamIds={inv.teamIds ?? []} primaryTeamId={inv.primaryTeamId ?? null}
              onChange={({ teamIds, primaryTeamId, teams }) => setInv({ ...inv, teamIds, primaryTeamId, spaces: teams.length ? [...new Set<string>(teams.flatMap((x) => x.default_spaces ?? ['work']))] : inv.spaces })} /></fieldset>
          {/* 405차 조직 모델: 지점을 하나만 쓰는 회사는 조직 고르기가 없다(서버가 그 회사의 조직에 넣음) */}
          <details className="text-xs" data-testid="invite-advanced" hidden={!multiSite}><summary className="cursor-pointer text-slate-600">고급 — 접근 가능한 조직(비우면 소속에서 자동)</summary>
            <div className="mt-1"><UnitChecks key={invKey} value={inv.orgUnitIds} onChange={(v) => setInv({ ...inv, orgUnitIds: v })} />
              <p className="mt-1 text-slate-500">직접 고르면 그 조직과 하위 조직의 업무·일정만 봅니다. 비우면 본사 기준으로 소속 부서·팀 규칙을 따릅니다.</p></div></details>
          <fieldset data-testid="invite-spaces"><legend className="mb-1 text-xs font-medium text-slate-600">공간 {inv.teamIds?.length ? <span className="font-normal text-ink-3">(고른 부서·팀의 기본 공간을 제안)</span> : null}</legend>
            <div className="flex gap-3 text-sm">{([['work', '업무'], ['sales', '영업'], ['marketing', '마케팅']] as const).filter(([k]) => k === 'work' || (spaceInfo.data?.spaces ?? []).includes(k)).map(([k, l]) => (
              <label key={k} className="flex items-center gap-1.5"><input type="checkbox" checked={(inv.spaces ?? ['work']).includes(k)} onChange={(e) => { const cur = inv.spaces ?? ['work']; setInv({ ...inv, spaces: e.target.checked ? [...cur, k] : cur.filter((x: string) => x !== k) }); }} data-testid={`invite-space-${k}`} />{l}</label>))}</div></fieldset>
          <label className="flex items-center gap-2 text-sm" data-testid="invite-with-contract"><input type="checkbox" checked={withContract} onChange={(e) => setWithContract(e.target.checked)} />초대와 함께 전자계약서(근로계약서·비밀유지서약서) 보내기 — 링크를 만든 뒤 바로 보내기 창이 열립니다</label>
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
      <Modal open={!!link} onClose={() => { setLink(''); setReviewMsg(''); setMailRes(null); }} title={mailRes?.mail === 'sent' ? '초대 메일을 보냈습니다' : '링크를 전달하세요'}>
        {reviewMsg && <p className="mb-2 rounded-input bg-amber-50 p-2 text-sm text-amber-900" data-testid="review-msg">{reviewMsg}</p>}
        {/* 대표 11/20 #1083: 이메일 초대는 메일이 자동으로 감 — 결과를 먼저 알리고, 링크는 카카오톡·문자로도 보낼 수 있게 그대로 둠 */}
        {mailRes && mailRes.mail !== 'off' && (mailRes.mail === 'sent'
          ? <p className="mb-2 rounded-input bg-brand-50 p-2 text-sm text-brand-800" data-testid="invite-mail-result" data-mail="sent"><b>{mailRes.to}</b> 로 초대 메일을 보냈습니다. 메일이 안 보인다고 하면 스팸함·지메일 &lsquo;업데이트&rsquo; 탭을 확인하게 하거나, 아래 링크를 카카오톡·문자로 보내 주세요.</p>
          : mailRes.mail === 'failed'
            ? <p className="mb-2 rounded-input bg-red-50 p-2 text-sm text-red-800" role="alert" data-testid="invite-mail-result" data-mail="failed">초대 메일을 보내지 못했습니다. 아래 링크를 카카오톡·문자로 직접 전달하세요.</p>
            : <p className="mb-2 rounded-input bg-slate-50 p-2 text-sm text-ink-2" data-testid="invite-mail-result" data-mail="dev">메일 발송이 설정되지 않은 환경이라 메일은 보내지 않았습니다. 아래 링크를 전달하세요.</p>)}
        <p className="text-sm text-slate-600">{mailRes?.mail === 'sent' ? '같은 링크를 카카오톡·문자로 보내도 됩니다(본인에게만).' : '아래 링크를 카카오톡·문자·메일로 본인에게만 전달하세요.'} 링크는 1회용이며 초대 7일·재설정 24시간 후 만료됩니다.</p>
        <input readOnly className={cx(inputCls, 'mt-2 font-mono text-xs')} value={link} onFocus={(e) => e.target.select()} data-testid="invite-link" />
        <div className="mt-3 flex justify-end"><Button onClick={() => { navigator.clipboard?.writeText(link); toast.ok('복사했습니다'); }}>복사</Button></div>
        {/* 대표 11/20: 직원이 앱부터 받게 — 초대 링크와 앱 받기 주소를 한 번에 붙여 보낼 안내 글 */}
        {link.includes('/invite/') && !reviewMsg && (
          <div className="mt-3 rounded-input bg-slate-50 p-2.5 text-xs text-ink-2" data-testid="invite-app-guide">
            <p>직원이 휴대폰 앱부터 받게 하려면 앱 받기 주소도 함께 보내세요: <b className="font-mono text-ink">{APP_GET_URL.replace(/^https?:\/\//, '')}</b></p>
            <button type="button" className="mt-1.5 font-semibold text-brand-700 underline" onClick={() => { navigator.clipboard?.writeText(inviteGuideText(link, APP_GET_URL)); toast.ok('안내 문구를 복사했습니다'); }} data-testid="invite-guide-copy">초대 링크 + 앱 받기 안내 문구 복사</button>
          </div>
        )}
      </Modal>
      {off && <OffboardModal userId={off.id} mode={off.mode} onClose={() => setOff(null)} onDone={() => { setOff(null); reload(); }} />}
      {contract && <SendContractModal preset={contract} onClose={() => setContract(null)} />}
      <Modal open={!!edit} onClose={() => setEdit(null)} title="사용자 편집">
        {edit && <form onSubmit={save} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="이름"><input className={inputCls} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="직책"><input className={inputCls} value={edit.title ?? ''} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></Field>
            <Field label="직책 약칭 (예: CEO·CPO, 아바타 옆에 표시 — 비우면 직책)"><input className={inputCls} maxLength={12} value={edit.title_short ?? ''} onChange={(e) => setEdit({ ...edit, title_short: e.target.value })} aria-label="직책 약칭" /></Field>
            <Field label="권한"><select className={inputCls} value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })}>{roles.map((r) => <option key={r} value={r}>{T.role[r]}</option>)}</select></Field>
            <Field label="상태"><select className={inputCls} value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })} disabled={edit.status === 'invited'}>
              {edit.status === 'invited' && <option value="invited">초대됨</option>}<option value="active">사용 중</option><option value="disabled">사용 중지</option><option value="left">퇴사</option></select></Field>
          </div>
          <fieldset data-testid="edit-teams"><legend className="mb-1 text-xs font-medium text-slate-600">소속</legend>
            <TeamPicker testid="edit-team" teamIds={edit.teamIds ?? (edit.teams ?? []).map((t: any) => t.id)} primaryTeamId={edit.primaryTeamId ?? (edit.teams ?? []).find((t: any) => t.primary)?.id ?? null}
              onChange={({ teamIds, primaryTeamId }) => setEdit({ ...edit, teamIds, primaryTeamId })} /></fieldset>
          {lostLeads(edit).length > 0 && (
            <div className="space-y-1 rounded-input border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900" data-testid="lead-loss">
              {lostLeads(edit).map((t: any) => {
                const title = leadTitle(t.kind);
                const cands = ((teamsList.data?.teams ?? []).find((x: any) => x.id === t.id)?.members ?? []).filter((m: any) => m.id !== edit.id);
                return (
                  <div key={t.id} className="flex flex-wrap items-center gap-1.5">
                    <AlertTriangle className="size-3.5 shrink-0" /><span><b>{t.name}</b>의 {title}{iGa(title)} 비게 됩니다</span>
                    <select className="h-7 rounded border border-amber-300 bg-white px-1 text-xs" value={edit.newLeads?.[t.id] ?? ''} onChange={(e) => setEdit({ ...edit, newLeads: { ...(edit.newLeads ?? {}), [t.id]: e.target.value } })} aria-label={`${t.name} 새 ${title}`} data-testid="lead-loss-pick">
                      <option value="">{title} 없이 두기</option>
                      {cands.map((m: any) => <option key={m.id} value={m.id}>새 {title}: {m.name}</option>)}
                    </select>
                  </div>
                );
              })}
            </div>
          )}
          <details className="text-xs" hidden={!multiSite}><summary className="cursor-pointer text-slate-600">고급 — 접근 가능한 조직</summary><div className="mt-1"><UnitChecks value={edit.org_unit_ids} onChange={(v) => setEdit({ ...edit, org_unit_ids: v })} /></div></details>
          <UserContracts userId={edit.id} />
          <p className="text-xs text-slate-500">사용 중지·퇴사로 바꾸면 모든 기기에서 즉시 로그아웃되고 푸시·Google 동기화도 멈춥니다. 작성한 업무 기록은 남습니다.</p>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setEdit(null)}>취소</Button><Button type="submit">저장</Button></div>
        </form>}
      </Modal>
    </div>
  );
}

/** #116 사용자 카드: 이 사람의 전자계약서(상태·완료 PDF) */
function UserContracts({ userId }: { userId: string }) {
  const d = useApi<{ contracts: any[] }>(`/api/contracts?userId=${userId}`);
  const ST: Record<string, string> = { draft: '임시', sent: '서명 대기', partially_signed: '일부 서명', completed: '완료', declined: '거절', cancelled: '취소', expired: '기한 지남' };
  if (!d.data?.contracts.length) return null;
  return (
    <div className="rounded-input border border-line bg-slate-50 p-2 text-xs" data-testid="user-contracts">
      <b className="font-semibold">전자계약서</b>
      <ul className="mt-1 space-y-0.5">{d.data.contracts.map((c) => <li key={c.id} className="flex items-center gap-2"><span className="font-mono text-[11px] text-ink-3">{c.doc_no}</span><span>{c.title}</span><span className="ml-auto text-ink-2">{ST[c.status] ?? c.status}</span>{c.file_id && <a href={`/api/library/${c.file_id}/download`} className="text-brand-700 underline">PDF</a>}</li>)}</ul>
    </div>
  );
}
