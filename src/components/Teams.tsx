'use client';
import { useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Crown, MessageCircle, Network, Plus } from 'lucide-react';
import { api, useApi } from './client';
import { useSession } from './session';
import { Avatar, Button, Field, Modal, Skeleton, cx, inputCls, toast } from './ui';
import { GENERIC_ORG, KIND_HINT, KIND_LABEL, LEAD_TITLE, ORG_KINDS, PARENT_KINDS, eulReul, nameKindWarn, topAllowed, type OrgKind } from '@/lib/orgKinds';

export type Team = { id: string; name: string; color: string; parent_id: string | null; kind: OrgKind; isolated: boolean; default_spaces: string[]; parent_name: string | null; path: string; depth: number; parent_path: string | null; members: { id: string; name: string; title: string | null; lead: boolean; primary?: boolean }[]; mine: boolean; i_lead: boolean; room_id: string | null };
const COLORS = ['#0F766E', '#2563EB', '#EA580C', '#7C3AED', '#DB2777', '#16a34a', '#475569'];
const NAME_EX: Record<OrgKind, string> = { hq: '예: 본사', division: '예: 플랫폼사업부', dept: '예: 영업부', team: '예: 영업1팀' };
const KIND_CHIP: Record<OrgKind, string> = { hq: 'bg-slate-800 text-white', division: 'bg-violet-50 text-violet-700', dept: 'bg-slate-100 text-ink-2', team: 'bg-brand-50 text-brand-700' };
/** 위 단위 기본값: 팀은 부서 → 사업부 → 본사, 부서는 사업부 → 본사 → 부서, 사업부는 본사 */
const PREFER: Record<OrgKind, OrgKind[]> = { hq: [], division: ['hq'], dept: ['division', 'hq', 'dept'], team: ['dept', 'division', 'hq'] };
/** [일반 기업 조직도로 시작] 미리 보기 한 줄(orgKinds GENERIC_ORG 그대로) */
const TEMPLATE_LINE = `${GENERIC_ORG.name} › ${(GENERIC_ORG.children ?? []).map((c) => (c.children?.length ? `${c.name}(${c.children.map((x) => x.name).join('·')})` : c.name)).join(' · ')}`;

/**
 * 사용자 관리 → '부서·팀' 탭 — P2 조직 개편(대표 확정 10/26): 본사 › 사업부 › 부서 › 팀 4단.
 * 종류마다 한 줄 설명·고른 종류에 맞는 위 단위만(#679) · 장 이름 자동·팀 아래 조직 없음·이름-종류 검사(#680) · 장 없음 표시(#681) · 조직도 틀
 */
export function TeamsTab() {
  const { dir, menus } = useSession();
  const canEdit = (menus?.admin_users ?? 'none') === 'edit';
  const { data, loading, reload } = useApi<{ teams: Team[] }>('/api/teams');
  type Edit = { id?: string; name: string; color: string; parentId: string | null; kind: OrgKind; isolated: boolean; defaultSpaces: string[]; members: { userId: string; lead: boolean }[]; adoptTopLevel: boolean };
  const [edit, setEdit] = useState<Edit | null>(null);
  const [busy, setBusy] = useState(false);
  const all = data?.teams ?? [];
  const hqOf = (selfId?: string) => all.find((t) => t.kind === 'hq' && t.id !== selfId);
  const pathOf = (id?: string) => (id ? all.find((t) => t.id === id)?.path : undefined);
  /** 고른 종류 바로 위에 올 수 있는 단위만(자기 자신·자기 아래는 빼고) */
  const parentsFor = (kind: OrgKind, selfId?: string) => { const sp = pathOf(selfId); return all.filter((x) => PARENT_KINDS[kind].includes(x.kind) && x.id !== selfId && !(sp && x.path.startsWith(sp + ' › '))); };
  const defaultParent = (kind: OrgKind, selfId?: string): string | null => {
    if (kind === 'hq' || ((kind === 'division' || kind === 'dept') && !hqOf(selfId))) return null; // 본사가 없는 회사는 맨 위 사업부·부서
    const opts = parentsFor(kind, selfId);
    for (const k of PREFER[kind]) { const o = opts.find((x) => x.kind === k); if (o) return o.id; }
    return null;
  };
  const fresh = (): Edit => {
    // 195차 후속(CI 1511): 첫 단위도 기본은 '부서' — 본사는 사람이 고를 때만(빈 회사는 [일반 기업 조직도로 시작]). 예전처럼 부서가 있으면 '팀'
    const kind: OrgKind = all.some((t) => t.kind === 'dept') ? 'team' : 'dept';
    return { name: '', color: COLORS[0], parentId: defaultParent(kind), kind, isolated: kind === 'team', defaultSpaces: ['work'], members: [], adoptTopLevel: true };
  };
  const pickKind = (k: OrgKind) => setEdit((x) => {
    if (!x) return x;
    const keep = x.parentId && parentsFor(k, x.id).some((o) => o.id === x.parentId) ? x.parentId : null;
    return { ...x, kind: k, parentId: k === 'hq' ? null : keep ?? defaultParent(k, x.id), isolated: k === 'team' ? (x.kind === 'team' ? x.isolated : !x.id) : false };
  });
  const [q, setQ] = useState('');
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!edit) return;
    setBusy(true);
    try {
      const body = { name: edit.name, color: edit.color, members: edit.members, parentId: edit.kind === 'hq' ? null : edit.parentId ?? null, kind: edit.kind, isolated: edit.kind === 'team' ? edit.isolated : false, defaultSpaces: edit.defaultSpaces,
        ...(edit.kind === 'hq' && edit.adoptTopLevel && topOthers(edit.id).length ? { adoptTopLevel: true } : {}) };
      const r = edit.id ? await api(`/api/teams/${edit.id}`, { method: 'PATCH', body }) : await api('/api/teams', { body });
      const moved: string[] = r?.moved ?? [];
      setEdit(null); reload();
      toast.ok(moved.length ? `저장했습니다 — ${moved.join(', ')}${eulReul(moved[moved.length - 1])} 본사 아래로 옮겼습니다` : '저장했습니다');
    } catch (er: any) { toast.error(er.message); } finally { setBusy(false); }
  }
  async function archive(t: Team) {
    if (!confirm(`"${t.name}" ${KIND_LABEL[t.kind]}${eulReul(KIND_LABEL[t.kind])} 보관할까요? (업무는 그대로 남고 조직도 표시만 빠집니다)`)) return;
    try { await api(`/api/teams/${t.id}`, { method: 'PATCH', body: { archived: true } }); reload(); } catch (e: any) { toast.error(e.message); }
  }
  async function startTemplate() {
    if (!confirm(`일반 기업 조직도로 시작할까요?\n${TEMPLATE_LINE}\n\n만든 뒤 이름·구성은 바로 고칠 수 있습니다.`)) return;
    setBusy(true);
    try { const r = await api('/api/teams/template', { body: {} }); reload(); toast.ok(`조직도 ${r.created}곳을 만들었습니다 — 이름을 바꾸고 사람을 넣으세요`); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  /** 맨 위에 있는 사업부·부서(본사로 만들 때 아래로 옮길 후보) */
  const topOthers = (selfId?: string) => all.filter((t) => !t.parent_id && t.id !== selfId && (t.kind === 'division' || t.kind === 'dept'));
  const toggle = (userId: string, on: boolean) => setEdit((x) => x && { ...x, members: on ? [...x.members, { userId, lead: x.members.length === 0 }] : x.members.filter((m) => m.userId !== userId) });
  const setLead = (userId: string) => setEdit((x) => x && { ...x, members: x.members.map((m) => ({ ...m, lead: m.userId === userId })) }); // 단위마다 장 1명
  if (loading && !data) return <Skeleton rows={4} />;
  const noHq = all.length > 0 && !hqOf();
  return (
    <div className="space-y-3" data-testid="teams-tab">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 flex-1 text-sm text-ink-2">조직은 <b className="font-semibold text-ink">본사 › 사업부 › 부서 › 팀</b> 4단입니다. 위 단위는 아래 단위 업무를 모두 보고, 아래 단위는 위 단위 업무를 보지 못합니다(본인이 참여한 업무는 예외). 단위마다 장 1명 — 대표·사업부장·부서장·팀장. 다른 부서와 같이 하는 업무는 업무 상세에서 ‘함께하는 부서’를 붙이면 그 부서와 위 단위가 같이 봅니다. 대화방은 자동으로 생깁니다.</p>
        {canEdit && <Button onClick={() => setEdit(fresh())} data-testid="team-new"><Plus />부서·팀 만들기</Button>}
      </div>
      {noHq && <p className="rounded-input border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" data-testid="org-no-hq">아직 본사가 없습니다. 맨 위 단위를 [편집]해 종류를 ‘본사’로 바꾸거나 본사를 새로 만들면, 맨 위에 있는 사업부·부서를 본사 아래로 한 번에 옮길 수 있습니다.</p>}
      <ul className="space-y-2" data-testid="team-tree">
        {all.map((t) => {
          const lead = t.members.find((m) => m.lead);
          const warn = nameKindWarn(t.name, t.kind);
          return (
            <li key={t.id} className="rounded-card border border-line bg-white p-3 shadow-card" style={{ marginLeft: Math.min(t.depth ?? 0, 6) * 20 }} data-testid="team-card" data-depth={t.depth ?? 0} data-kind={t.kind} data-name={t.name}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="size-3 shrink-0 rounded-full" style={{ background: t.color }} />
                <Link href={`/teams/${t.id}`} className="min-w-0 flex-1 font-semibold hover:underline" data-testid="team-title">{t.parent_path ? <span className="hidden font-normal text-ink-2 sm:inline">{t.parent_path} › </span> : null}{t.name}
                  <span className={cx('ml-1.5 rounded px-1 text-[11px] font-normal', KIND_CHIP[t.kind] ?? KIND_CHIP.dept)} data-testid="team-kind">{KIND_LABEL[t.kind] ?? '부서'}</span>
                  {t.isolated && <span className="ml-1 rounded bg-amber-50 px-1 text-[11px] font-normal text-amber-800" title="구성원은 자기 팀과 배정된 것만 봅니다">격리</span>}
                  {!lead && <span className="ml-1 rounded bg-red-50 px-1 text-[11px] font-normal text-red-700" title={`${LEAD_TITLE[t.kind] ?? '장'}을 정해 주세요`} data-testid="team-no-lead">{LEAD_TITLE[t.kind] ?? '장'} 없음</span>}
                  {warn && <span className="ml-1 rounded bg-amber-50 px-1 text-[11px] font-normal text-amber-800" title={warn} data-testid="team-name-kind">이름·종류 확인</span>}</Link>
                {t.room_id && <Link href={`/messages?room=${t.room_id}`} className="text-ink-3 hover:text-ink" aria-label={`${t.name} 대화방`}><MessageCircle className="size-4" /></Link>}
                {canEdit && <Button size="sm" variant="ghost" onClick={() => { setQ(''); setEdit({ id: t.id, name: t.name, color: t.color, parentId: t.parent_id, kind: t.kind, isolated: t.isolated, defaultSpaces: t.default_spaces ?? ['work'], members: t.members.map((m) => ({ userId: m.id, lead: m.lead })), adoptTopLevel: true }); }}>편집</Button>}
                {canEdit && <Button size="sm" variant="ghost" onClick={() => archive(t)}>보관</Button>}
              </div>
              <ul className="mt-2 flex flex-wrap gap-1.5 text-xs">
                {t.members.map((m) => <li key={m.id} className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5', m.lead ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-ink-2')} title={m.primary ? '주 소속' : '겸직'} data-testid={m.lead ? 'team-lead-chip' : undefined}>
                  {m.lead && <><Crown className="size-3" /><span className="font-medium">{LEAD_TITLE[t.kind] ?? '장'}</span></>}{m.name}{m.title ? ` · ${m.title}` : ''}{m.primary === false && <span className="text-[10px] text-ink-3">겸직</span>}</li>)}
              </ul>
            </li>
          );
        })}
        {data && !all.length && (
          <li className="rounded-card border border-dashed border-line p-6 text-center text-sm text-ink-3" data-testid="org-empty">
            <Network className="mx-auto mb-1 size-6" />
            <p className="font-medium text-ink-2">아직 조직도가 없습니다</p>
            <p className="mt-1">본사 › 사업부 › 부서 › 팀 순서로 만듭니다. 처음이면 일반 기업 조직도로 시작한 뒤 이름만 바꾸세요.</p>
            <p className="mt-1 text-xs">{TEMPLATE_LINE}</p>
            {canEdit && <Button className="mt-3" onClick={startTemplate} disabled={busy} data-testid="org-template">일반 기업 조직도로 시작</Button>}
          </li>
        )}
      </ul>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? '부서·팀 편집' : '부서·팀 만들기'}>
        {edit && (() => {
          const hq = hqOf(edit.id);
          const opts = parentsFor(edit.kind, edit.id);
          // 예전 규칙으로 맨 위에 있던 부서는 종류를 그대로 두면 이름·구성원만 고칠 수 있게 '지금처럼 맨 위'를 남김(서버도 바뀐 게 없으면 위치 검사 안 함)
          const orig = edit.id ? all.find((t) => t.id === edit.id) : undefined;
          const keepTop = !!orig && !orig.parent_id && orig.kind === edit.kind;
          const topOk = topAllowed(edit.kind, !!hq) || keepTop;
          const lt = LEAD_TITLE[edit.kind];
          const warn = edit.name.trim() ? nameKindWarn(edit.name, edit.kind) : null;
          const tops = topOthers(edit.id);
          const leadUser = edit.members.find((m) => m.lead);
          return (
            <form onSubmit={save} className="space-y-3">
              <fieldset><legend className="mb-1 text-xs font-medium text-ink-2">종류</legend>
                <div className="grid gap-1.5 sm:grid-cols-2" role="radiogroup" aria-label="종류">
                  {ORG_KINDS.map((k) => {
                    const taken = k === 'hq' && !!hq;
                    return (
                      <label key={k} className={cx('flex cursor-pointer items-start gap-2 rounded-input border px-2.5 py-2 text-sm', edit.kind === k ? 'border-brand-600 bg-brand-50' : 'border-line bg-white', taken && 'cursor-not-allowed opacity-50')}>
                        <input type="radio" name="kind" className="mt-1" checked={edit.kind === k} disabled={taken} onChange={() => pickKind(k)} data-testid={`team-kind-${k}`} />
                        <span><b className="font-semibold">{KIND_LABEL[k]}</b>{taken && <span className="ml-1 text-[11px] text-ink-3">(이미 {hq!.name})</span>}<span className="block text-xs text-ink-3">{KIND_HINT[k]}</span></span>
                      </label>
                    );
                  })}
                </div></fieldset>
              <Field label={`${KIND_LABEL[edit.kind]} 이름`}><input className={inputCls} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder={NAME_EX[edit.kind]} required aria-label="팀 이름" /></Field>
              {warn && <p className="-mt-2 flex items-center gap-1 text-xs text-amber-800" data-testid="team-name-warn"><AlertTriangle className="size-3.5 shrink-0" />{warn}</p>}
              {edit.kind !== 'hq' ? (
                <Field label="위 단위"><select className={inputCls} value={edit.parentId ?? ''} onChange={(e) => setEdit({ ...edit, parentId: e.target.value || null })} aria-label="위 단위" required={!topOk} data-testid="team-parent">
                  {topOk ? <option value="">{topAllowed(edit.kind, !!hq) ? '없음 — 맨 위' : '없음 — 지금처럼 맨 위(본사 아래로 옮기는 것을 권장)'}</option> : <option value="">{PARENT_KINDS[edit.kind].map((k) => KIND_LABEL[k]).join('·')} 중에서 고르세요</option>}
                  {opts.map((x) => <option key={x.id} value={x.id}>{x.path} ({KIND_LABEL[x.kind] ?? '부서'})</option>)}</select></Field>
              ) : <p className="text-xs text-ink-3" data-testid="team-hq-note">본사는 회사 맨 위 1곳입니다.</p>}
              {edit.kind !== 'hq' && !opts.length && !topOk && <p className="-mt-2 text-xs text-amber-800" data-testid="team-parent-missing">먼저 {PARENT_KINDS[edit.kind].map((k) => KIND_LABEL[k]).join('·')}{eulReul(KIND_LABEL[PARENT_KINDS[edit.kind][PARENT_KINDS[edit.kind].length - 1]])} 만드세요.</p>}
              {edit.kind === 'hq' && tops.length > 0 && (
                <label className="flex items-start gap-2 text-sm" data-testid="team-adopt"><input type="checkbox" className="mt-0.5" checked={edit.adoptTopLevel} onChange={(e) => setEdit({ ...edit, adoptTopLevel: e.target.checked })} />
                  <span>맨 위에 있는 {tops.length}곳({tops.slice(0, 4).map((t) => t.name).join(', ')}{tops.length > 4 ? ' 등' : ''})을 본사 아래로 옮기기</span></label>
              )}
              {edit.kind === 'team' && <>
                <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={edit.isolated} onChange={(e) => setEdit({ ...edit, isolated: e.target.checked })} data-testid="team-isolated" />
                  <span>격리 — 회사 안의 작은 회사<span className="block text-xs text-ink-3">팀원은 자기 팀과 자기에게 배정된 것만 봅니다(본사·다른 부서의 업무·일정·사람·자료 없음). 위 단위 장에게 업무를 요청할 수는 있습니다. 팀장은 팀원 관리·배정·팀 일정, 대표·관리자는 전체.</span></span></label>
              </>}
              <fieldset><legend className="mb-1 text-xs font-medium text-ink-2">기본 공간 (이 {KIND_LABEL[edit.kind]}로 초대하면 제안)</legend>
                <div className="flex gap-3 text-sm">{([['work', '업무'], ['sales', '영업'], ['marketing', '마케팅']] as const).map(([k, l]) => <label key={k} className="flex items-center gap-1.5"><input type="checkbox" checked={edit.defaultSpaces.includes(k)} onChange={(e) => setEdit({ ...edit, defaultSpaces: e.target.checked ? [...edit.defaultSpaces, k] : edit.defaultSpaces.filter((x) => x !== k) })} data-testid={`team-space-${k}`} />{l}</label>)}</div></fieldset>
              <div className="flex gap-1.5">{COLORS.map((c) => <button key={c} type="button" onClick={() => setEdit({ ...edit, color: c })} aria-label={`색 ${c}`} className={cx('size-7 rounded-full ring-offset-2', edit.color === c && 'ring-2 ring-ink')} style={{ background: c }} />)}</div>
              <input className={cx(inputCls, 'h-9')} placeholder="이름·직책으로 찾기" value={q} onChange={(e) => setQ(e.target.value)} aria-label="팀원 찾기" />
              <ul className="max-h-64 divide-y divide-line overflow-y-auto rounded-input border border-line">
                {dir.users.filter((u) => !q || u.name.includes(q) || (u.title ?? '').includes(q)).map((u) => {
                  const m = edit.members.find((x) => x.userId === u.id);
                  return (
                    <li key={u.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                      <label className="flex min-w-0 flex-1 items-center gap-2"><input type="checkbox" checked={!!m} onChange={(e) => toggle(u.id, e.target.checked)} aria-label={`${u.name} 팀원`} /><Avatar id={u.id} name={u.name} size={22} /><span className="truncate">{u.name}</span>{u.title && <span className="shrink-0 text-xs text-ink-3">· {u.title}</span>}</label>
                      {m && <label className="flex shrink-0 items-center gap-1 text-xs text-amber-800"><input type="radio" name="team-lead" checked={m.lead} onChange={() => setLead(u.id)} aria-label={`${u.name} 장`} />{lt}</label>}
                    </li>
                  );
                })}
              </ul>
              <p className={cx('text-xs', edit.members.length && !leadUser ? 'text-red-700' : 'text-ink-3')} data-testid="team-lead-summary">구성원 {edit.members.length}명 · {lt} {leadUser ? dir.users.find((u) => u.id === leadUser.userId)?.name ?? '1명' : edit.members.length ? `없음 — ${lt}${eulReul(lt)} 1명 정하세요` : `없음 — 구성원 없이 저장하면 ‘${lt} 없음’으로 표시됩니다`}</p>
              <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setEdit(null)}>취소</Button><Button type="submit" disabled={busy} data-testid="team-save">저장</Button></div>
            </form>
          );
        })()}
      </Modal>
    </div>
  );
}
/** 사용자 목록 등 '장' 표시: 왕관 + 장 이름(대표·사업부장·부서장·팀장) — #681 */
export function LeadChip({ kind, className }: { kind: string | null | undefined; className?: string }) {
  const title = kind && kind in LEAD_TITLE ? LEAD_TITLE[kind as OrgKind] : '장';
  return <span className={cx('inline-flex items-center gap-0.5 rounded-full bg-amber-50 px-1.5 text-[10px] font-medium text-amber-800', className)} data-testid="lead-chip"><Crown className="size-2.5" aria-hidden />{title}</span>;
}
