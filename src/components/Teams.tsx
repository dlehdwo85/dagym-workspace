'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Crown, MessageCircle, Plus, UsersRound } from 'lucide-react';
import { api, useApi } from './client';
import { useSession } from './session';
import { Avatar, Button, Field, Modal, Skeleton, cx, inputCls, toast } from './ui';

export type Team = { id: string; name: string; color: string; members: { id: string; name: string; title: string | null; lead: boolean }[]; mine: boolean; i_lead: boolean; room_id: string | null };
const COLORS = ['#0F766E', '#2563EB', '#EA580C', '#7C3AED', '#DB2777', '#059669', '#475569'];

/** V14 8번 사용자 관리 → "팀" 탭: 팀 만들기(이름·색·팀장 1명 이상·팀원), 한 사람 여러 팀 가능 */
export function TeamsTab() {
  const { dir, menus } = useSession();
  const canEdit = (menus?.admin_users ?? 'none') === 'edit';
  const { data, loading, reload } = useApi<{ teams: Team[] }>('/api/teams');
  const [edit, setEdit] = useState<{ id?: string; name: string; color: string; members: { userId: string; lead: boolean }[] } | null>(null);
  const [q, setQ] = useState('');
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!edit) return;
    try {
      if (edit.id) await api(`/api/teams/${edit.id}`, { method: 'PATCH', body: { name: edit.name, color: edit.color, members: edit.members } });
      else await api('/api/teams', { body: { name: edit.name, color: edit.color, members: edit.members } });
      setEdit(null); reload(); toast.ok('저장했습니다');
    } catch (er: any) { toast.error(er.message); }
  }
  async function archive(t: Team) {
    if (!confirm(`"${t.name}" 팀을 보관할까요? (팀 업무는 그대로 남고 팀 표시만 빠집니다)`)) return;
    try { await api(`/api/teams/${t.id}`, { method: 'PATCH', body: { archived: true } }); reload(); } catch (e: any) { toast.error(e.message); }
  }
  const toggle = (userId: string, on: boolean) => setEdit((x) => x && { ...x, members: on ? [...x.members, { userId, lead: x.members.length === 0 }] : x.members.filter((m) => m.userId !== userId) });
  const setLead = (userId: string, lead: boolean) => setEdit((x) => x && { ...x, members: x.members.map((m) => (m.userId === userId ? { ...m, lead } : m)) });
  if (loading && !data) return <Skeleton rows={4} />;
  return (
    <div className="space-y-3" data-testid="teams-tab">
      <div className="flex items-center justify-between">
        <p className="text-sm text-ink-2">팀은 현장·부서(조직 구성)와 별개의 업무 묶음입니다. 한 사람이 여러 팀에 속할 수 있고, 팀 대화방이 자동으로 생깁니다.</p>
        {canEdit && <Button onClick={() => setEdit({ name: '', color: COLORS[0], members: [] })} data-testid="team-new"><Plus />팀 만들기</Button>}
      </div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {data?.teams.map((t) => (
          <li key={t.id} className="rounded-card border border-line bg-white p-3 shadow-card" data-testid="team-card">
            <div className="flex items-center gap-2">
              <span className="size-3 rounded-full" style={{ background: t.color }} />
              <Link href={`/teams/${t.id}`} className="flex-1 font-semibold hover:underline">{t.name}</Link>
              {t.room_id && <Link href={`/messages?room=${t.room_id}`} className="text-ink-3 hover:text-ink" aria-label={`${t.name} 대화방`}><MessageCircle className="size-4" /></Link>}
              {canEdit && <Button size="sm" variant="ghost" onClick={() => setEdit({ id: t.id, name: t.name, color: t.color, members: t.members.map((m) => ({ userId: m.id, lead: m.lead })) })}>편집</Button>}
              {canEdit && <Button size="sm" variant="ghost" onClick={() => archive(t)}>보관</Button>}
            </div>
            <ul className="mt-2 flex flex-wrap gap-1.5 text-xs">
              {t.members.map((m) => <li key={m.id} className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5', m.lead ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-ink-2')}>{m.lead && <Crown className="size-3" />}{m.name}{m.title ? ` · ${m.title}` : ''}</li>)}
            </ul>
          </li>
        ))}
        {data && !data.teams.length && <li className="rounded-card border border-dashed border-line p-6 text-center text-sm text-ink-3 sm:col-span-2"><UsersRound className="mx-auto mb-1 size-6" />아직 팀이 없습니다</li>}
      </ul>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? '팀 편집' : '팀 만들기'}>
        {edit && (
          <form onSubmit={save} className="space-y-3">
            <Field label="팀 이름"><input className={inputCls} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="예: 마케팅팀" required aria-label="팀 이름" /></Field>
            <div className="flex gap-1.5">{COLORS.map((c) => <button key={c} type="button" onClick={() => setEdit({ ...edit, color: c })} aria-label={`색 ${c}`} className={cx('size-7 rounded-full ring-offset-2', edit.color === c && 'ring-2 ring-ink')} style={{ background: c }} />)}</div>
            <input className={cx(inputCls, 'h-9')} placeholder="이름·직책으로 찾기" value={q} onChange={(e) => setQ(e.target.value)} aria-label="팀원 찾기" />
            <ul className="max-h-64 divide-y divide-line overflow-y-auto rounded-input border border-line">
              {dir.users.filter((u) => !q || u.name.includes(q) || (u.title ?? '').includes(q)).map((u) => {
                const m = edit.members.find((x) => x.userId === u.id);
                return (
                  <li key={u.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                    <label className="flex flex-1 items-center gap-2"><input type="checkbox" checked={!!m} onChange={(e) => toggle(u.id, e.target.checked)} aria-label={`${u.name} 팀원`} /><Avatar id={u.id} name={u.name} size={22} />{u.name}{u.title && <span className="text-xs text-ink-3">· {u.title}</span>}</label>
                    {m && <label className="flex items-center gap-1 text-xs text-amber-800"><input type="checkbox" checked={m.lead} onChange={(e) => setLead(u.id, e.target.checked)} aria-label={`${u.name} 팀장`} />팀장</label>}
                  </li>
                );
              })}
            </ul>
            <p className="text-xs text-ink-3">팀원 {edit.members.length}명 · 팀장 {edit.members.filter((m) => m.lead).length}명 (1명 이상)</p>
            <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setEdit(null)}>취소</Button><Button type="submit" data-testid="team-save">저장</Button></div>
          </form>
        )}
      </Modal>
    </div>
  );
}
