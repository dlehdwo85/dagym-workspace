'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Crown, MessageCircle, Plus, UsersRound } from 'lucide-react';
import { api, useApi } from './client';
import { useSession } from './session';
import { Avatar, Button, Field, Modal, Skeleton, cx, inputCls, toast } from './ui';

export type Team = { id: string; name: string; color: string; parent_id: string | null; kind: 'dept' | 'team'; isolated: boolean; default_spaces: string[]; parent_name: string | null; path: string; depth: number; parent_path: string | null; members: { id: string; name: string; title: string | null; lead: boolean; primary?: boolean }[]; mine: boolean; i_lead: boolean; room_id: string | null };
const COLORS = ['#0F766E', '#2563EB', '#EA580C', '#7C3AED', '#DB2777', '#16a34a', '#475569'];

/** V14 8번 사용자 관리 → "팀" 탭: 팀 만들기(이름·색·팀장 1명 이상·팀원), 한 사람 여러 팀 가능 */
export function TeamsTab() {
  const { dir, menus } = useSession();
  const canEdit = (menus?.admin_users ?? 'none') === 'edit';
  const { data, loading, reload } = useApi<{ teams: Team[] }>('/api/teams');
  type Edit = { id?: string; name: string; color: string; parentId: string | null; kind: 'dept' | 'team'; isolated: boolean; defaultSpaces: string[]; members: { userId: string; lead: boolean }[] };
  const [edit, setEdit] = useState<Edit | null>(null);
  const depts = data?.teams.filter((t) => t.kind === 'dept') ?? [];
  // 로컬 10/19(대표): 부서 › 팀 2단 — 부서가 있으면 새로 만드는 건 그 아래 팀(격리 켜짐), 없으면 부서부터
  const fresh = (): Edit => ({ name: '', color: COLORS[0], parentId: depts[0]?.id ?? null, kind: depts.length ? 'team' : 'dept', isolated: depts.length > 0, defaultSpaces: ['work'], members: [] });
  const [q, setQ] = useState('');
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!edit) return;
    try {
      const body = { name: edit.name, color: edit.color, members: edit.members, parentId: edit.parentId ?? null, kind: edit.kind, isolated: edit.kind === 'team' ? edit.isolated : false, defaultSpaces: edit.defaultSpaces }; // 재정비: 부서도 상위 부서를 가질 수 있음
      if (edit.id) await api(`/api/teams/${edit.id}`, { method: 'PATCH', body });
      else await api('/api/teams', { body });
      setEdit(null); reload(); toast.ok('저장했습니다');
    } catch (er: any) { toast.error(er.message); }
  }
  async function archive(t: Team) {
    if (!confirm(`"${t.name}" 팀을 보관할까요? (팀 업무는 그대로 남고 팀 표시만 빠집니다)`)) return;
    try { await api(`/api/teams/${t.id}`, { method: 'PATCH', body: { archived: true } }); reload(); } catch (e: any) { toast.error(e.message); }
  }
  const toggle = (userId: string, on: boolean) => setEdit((x) => x && { ...x, members: on ? [...x.members, { userId, lead: x.members.length === 0 }] : x.members.filter((m) => m.userId !== userId) });
  const setLead = (userId: string) => setEdit((x) => x && { ...x, members: x.members.map((m) => ({ ...m, lead: m.userId === userId })) }); // 재정비: 단위마다 '장' 1명
  const editPath = edit?.id ? data?.teams.find((t) => t.id === edit.id)?.path : undefined;
  const parentOptions = depts.filter((x) => x.id !== edit?.id && !(editPath && x.path.startsWith(editPath + ' › ')));
  if (loading && !data) return <Skeleton rows={4} />;
  return (
    <div className="space-y-3" data-testid="teams-tab">
      <div className="flex items-center justify-between">
        <p className="text-sm text-ink-2">조직은 트리로 꾸립니다: 본사 › 부서 › (하위 부서) › 팀. 부서 안에 부서·팀을 둘 수 있고, 단위마다 ‘장’ 1명을 둡니다(팀은 격리를 켜면 회사 안의 작은 회사처럼 움직입니다). 직원은 자기 부서 업무와 본인이 참여한 업무만 보고, 부서장은 부서원이 참여한 다른 부서와의 협업 업무까지 봅니다. 상위 부서를 정하면 그 부서장이 하위 부서 업무도 봅니다. 부서 대화방은 자동으로 생깁니다.</p>
        {canEdit && <Button onClick={() => setEdit(fresh())} data-testid="team-new"><Plus />부서·팀 만들기</Button>}
      </div>
      <ul className="space-y-2" data-testid="team-tree">
        {data?.teams.map((t) => (
          <li key={t.id} className="rounded-card border border-line bg-white p-3 shadow-card" style={{ marginLeft: Math.min(t.depth ?? 0, 6) * 20 }} data-testid="team-card" data-depth={t.depth ?? 0}>
            <div className="flex items-center gap-2">
              <span className="size-3 rounded-full" style={{ background: t.color }} />
              <Link href={`/teams/${t.id}`} className="flex-1 font-semibold hover:underline" data-testid="team-title">{t.parent_path ? <span className="hidden font-normal text-ink-2 sm:inline">{t.parent_path} › </span> : null}{t.name}
                <span className={cx('ml-1.5 rounded px-1 text-[11px] font-normal', t.kind === 'dept' ? 'bg-slate-100 text-ink-2' : 'bg-brand-50 text-brand-700')}>{t.kind === 'dept' ? '부서' : '팀'}</span>
                {t.isolated && <span className="ml-1 rounded bg-amber-50 px-1 text-[11px] font-normal text-amber-800" title="구성원은 자기 팀과 배정된 것만 봅니다">격리</span>}</Link>
              {t.room_id && <Link href={`/messages?room=${t.room_id}`} className="text-ink-3 hover:text-ink" aria-label={`${t.name} 대화방`}><MessageCircle className="size-4" /></Link>}
              {canEdit && <Button size="sm" variant="ghost" onClick={() => setEdit({ id: t.id, name: t.name, color: t.color, parentId: t.parent_id, kind: t.kind, isolated: t.isolated, defaultSpaces: t.default_spaces ?? ['work'], members: t.members.map((m) => ({ userId: m.id, lead: m.lead })) })}>편집</Button>}
              {canEdit && <Button size="sm" variant="ghost" onClick={() => archive(t)}>보관</Button>}
            </div>
            <ul className="mt-2 flex flex-wrap gap-1.5 text-xs">
              {t.members.map((m) => <li key={m.id} className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5', m.lead ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-ink-2')} title={m.primary ? '주 소속' : '겸직'}>{m.lead && <Crown className="size-3" />}{m.name}{m.title ? ` · ${m.title}` : ''}{m.primary === false && <span className="text-[10px] text-ink-3">겸직</span>}</li>)}
            </ul>
          </li>
        ))}
        {data && !data.teams.length && <li className="rounded-card border border-dashed border-line p-6 text-center text-sm text-ink-3 sm:col-span-2"><UsersRound className="mx-auto mb-1 size-6" />아직 팀이 없습니다</li>}
      </ul>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? '부서·팀 편집' : '부서·팀 만들기'}>
        {edit && (
          <form onSubmit={save} className="space-y-3">
            <div className="flex gap-3 text-sm" role="radiogroup" aria-label="종류">
              {(['dept', 'team'] as const).map((k) => <label key={k} className="flex items-center gap-1.5"><input type="radio" name="kind" checked={edit.kind === k} onChange={() => setEdit({ ...edit, kind: k, parentId: k === 'team' ? (edit.parentId ?? depts[0]?.id ?? null) : null, isolated: k === 'team' ? edit.isolated : false })} data-testid={`team-kind-${k}`} />{k === 'dept' ? '부서(상위 없음)' : '팀(부서 아래)'}</label>)}
            </div>
            <Field label={edit.kind === 'dept' ? '부서 이름' : '팀 이름'}><input className={inputCls} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder={edit.kind === 'dept' ? '예: 마케팅부' : '예: 콘텐츠팀'} required aria-label="팀 이름" /></Field>
            <Field label={edit.kind === 'team' ? '부서' : '상위 부서 (비우면 최상위)'}><select className={inputCls} value={edit.parentId ?? ''} onChange={(e) => setEdit({ ...edit, parentId: e.target.value || null })} aria-label={edit.kind === 'team' ? '부서' : '상위 부서'} required={edit.kind === 'team'} data-testid="team-parent">
              <option value="">{edit.kind === 'team' ? '부서를 고르세요' : '없음 — 최상위 부서'}</option>{parentOptions.map((x) => <option key={x.id} value={x.id}>{x.path}</option>)}</select></Field>
            {edit.kind === 'team' && <>
              {!depts.length && <p className="-mt-2 text-xs text-amber-800">팀은 부서 아래에 만듭니다 — 먼저 부서를 만드세요.</p>}
              <p className="-mt-2 text-xs text-ink-3">부서 구성원은 이 팀 업무를 모두 보고·고치고·배정합니다. 이 팀은 부서 업무를 볼 수 없습니다.</p>
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={edit.isolated} onChange={(e) => setEdit({ ...edit, isolated: e.target.checked })} data-testid="team-isolated" />
                <span>격리 — 회사 안의 작은 회사<span className="block text-xs text-ink-3">팀원은 자기 팀과 자기에게 배정된 것만 봅니다(본사·다른 부서의 업무·일정·사람·자료 없음). 팀장은 팀원 관리·배정·팀 일정, 대표·관리자는 전체.</span></span></label>
            </>}
            <fieldset><legend className="mb-1 text-xs font-medium text-ink-2">기본 공간 (이 {edit.kind === 'dept' ? '부서' : '팀'}로 초대하면 제안)</legend>
              <div className="flex gap-3 text-sm">{([['work', '업무'], ['sales', '영업'], ['marketing', '마케팅']] as const).map(([k, l]) => <label key={k} className="flex items-center gap-1.5"><input type="checkbox" checked={edit.defaultSpaces.includes(k)} onChange={(e) => setEdit({ ...edit, defaultSpaces: e.target.checked ? [...edit.defaultSpaces, k] : edit.defaultSpaces.filter((x) => x !== k) })} data-testid={`team-space-${k}`} />{l}</label>)}</div></fieldset>
            <div className="flex gap-1.5">{COLORS.map((c) => <button key={c} type="button" onClick={() => setEdit({ ...edit, color: c })} aria-label={`색 ${c}`} className={cx('size-7 rounded-full ring-offset-2', edit.color === c && 'ring-2 ring-ink')} style={{ background: c }} />)}</div>
            <input className={cx(inputCls, 'h-9')} placeholder="이름·직책으로 찾기" value={q} onChange={(e) => setQ(e.target.value)} aria-label="팀원 찾기" />
            <ul className="max-h-64 divide-y divide-line overflow-y-auto rounded-input border border-line">
              {dir.users.filter((u) => !q || u.name.includes(q) || (u.title ?? '').includes(q)).map((u) => {
                const m = edit.members.find((x) => x.userId === u.id);
                return (
                  <li key={u.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                    <label className="flex flex-1 items-center gap-2"><input type="checkbox" checked={!!m} onChange={(e) => toggle(u.id, e.target.checked)} aria-label={`${u.name} 팀원`} /><Avatar id={u.id} name={u.name} size={22} />{u.name}{u.title && <span className="text-xs text-ink-3">· {u.title}</span>}</label>
                    {m && <label className="flex items-center gap-1 text-xs text-amber-800"><input type="radio" name="team-lead" checked={m.lead} onChange={() => setLead(u.id)} aria-label={`${u.name} 장`} />{edit.kind === 'dept' ? '부서장' : '팀장'}</label>}
                  </li>
                );
              })}
            </ul>
            <p className="text-xs text-ink-3">구성원 {edit.members.length}명 · {edit.kind === 'dept' ? '부서장' : '팀장'} {edit.members.find((m) => m.lead) ? dir.users.find((u) => u.id === edit.members.find((m) => m.lead)!.userId)?.name ?? '1명' : '없음 (1명을 정하세요)'}</p>
            <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setEdit(null)}>취소</Button><Button type="submit" data-testid="team-save">저장</Button></div>
          </form>
        )}
      </Modal>
    </div>
  );
}
