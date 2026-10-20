'use client';
import { Fragment, useState } from 'react';
import { ChevronDown, ChevronRight, Lock, ShieldCheck, Trash2 } from 'lucide-react';
import { api, useApi } from '@/components/client';
import { Button, ErrorBox, Skeleton, cx, inputCls, toast } from '@/components/ui';
import { ROLE_LABEL, type Role } from '@/lib/types';

type Level = { value: string; label: string };
type M = { teamGrants: { user_id: string; name: string; team_id: string; team_name: string }[]; menus: { key: string; label: string; levels: Level[] }[]; roles: Role[]; matrix: Record<string, Record<string, string>>; overrides: { menu: string; user_id: string; level: string; name: string }[] };

/** V13 2·4번 메뉴 권한 (대표만): 행 = 메뉴, 열 = 등급, 칸 = 단계. 아래에 사람별 예외 */
export function MenuPermsTab({ users }: { users: { id: string; name: string; role: Role; status: string }[] }) {
  const { data, error, loading, reload } = useApi<M>('/api/admin/menu-perms');
  const [busy, setBusy] = useState('');
  const [add, setAdd] = useState({ menu: 'revenue', userId: '', level: 'view' });
  const [libOpen, setLibOpen] = useState(false);
  async function put(b: Record<string, unknown>, key: string) {
    setBusy(key);
    try { await api('/api/admin/menu-perms', { method: 'PUT', body: b }); reload(); toast.ok('바꿨습니다'); } catch (e: any) { toast.error(e.message); } finally { setBusy(''); }
  }
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (loading && !data) return <Skeleton rows={4} />;
  const d = data!;
  const label = (menu: string, lv: string) => d.menus.find((m) => m.key === menu)?.levels.find((l) => l.value === lv)?.label ?? lv;
  const addLevels = d.menus.find((m) => m.key === add.menu)?.levels ?? [];
  return (
    <div className="space-y-4" data-testid="menu-perms">
      <p className="flex items-start gap-1.5 text-sm text-ink-2"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand-600" />
        등급마다 메뉴를 켜고 끕니다. 꺼진 메뉴는 화면에서 사라지고 서버도 막습니다. 대표 본인 권한은 끌 수 없습니다. 바꾼 내용은 감사 기록에 남습니다.</p>
      <div className="overflow-x-auto rounded-card border border-line bg-white">
        <table className="w-full min-w-[760px] text-sm">
          <thead><tr className="border-b border-line bg-slate-50 text-left text-xs text-ink-2"><th className="p-2">메뉴</th>{d.roles.map((r) => <th key={r} className="p-2">{ROLE_LABEL[r]}</th>)}</tr></thead>
          <tbody className="divide-y divide-line">
            {d.menus.filter((m) => !NESTED.includes(m.key)).map((m) => (
              <Fragment key={m.key}>
                <Row m={m} d={d} busy={busy} put={put} open={m.key === 'library' ? libOpen : undefined} onToggle={m.key === 'library' ? () => setLibOpen(!libOpen) : undefined} />
                {m.key === 'library' && libOpen && <>
                  {d.menus.filter((x) => NESTED.includes(x.key)).map((x) => <Row key={x.key} m={x} d={d} busy={busy} put={put} nested />)}
                  <tr><td colSpan={d.roles.length + 1} className="bg-slate-50/60 p-2"><LibraryFolders roles={d.roles} /></td></tr>
                </>}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <section className="rounded-card border border-line bg-white p-3">
        <h2 className="text-sm font-semibold">사람별 예외 <span className="font-normal text-ink-3">— 등급 설정보다 먼저 적용</span></h2>
        <ul className="mt-2 divide-y divide-line text-sm" data-testid="menu-overrides">
          {d.overrides.map((o) => (
            <li key={o.menu + o.user_id} className="flex items-center gap-2 py-1.5">
              <span className="flex-1">{o.name} · {d.menus.find((m) => m.key === o.menu)?.label} → <b>{label(o.menu, o.level)}</b></span>
              <button className="inline-flex size-8 items-center justify-center rounded-input text-red-600 hover:bg-red-50" onClick={() => put({ menu: o.menu, userId: o.user_id, level: null }, 'del')} aria-label={`${o.name} 예외 지우기`}><Trash2 className="size-4" /></button>
            </li>
          ))}
          {!d.overrides.length && <li className="py-1.5 text-ink-3">예외 없음</li>}
        </ul>
        <div className="mt-2 flex flex-wrap gap-2">
          <select className={cx(inputCls, 'h-9 !w-auto')} value={add.userId} onChange={(e) => setAdd({ ...add, userId: e.target.value })} aria-label="예외 사람">
            <option value="">사람 선택</option>{users.filter((u) => u.role !== 'owner' && u.status !== 'disabled').map((u) => <option key={u.id} value={u.id}>{u.name} ({ROLE_LABEL[u.role]})</option>)}
          </select>
          <select className={cx(inputCls, 'h-9 !w-auto')} value={add.menu} onChange={(e) => setAdd({ ...add, menu: e.target.value, level: d.menus.find((m) => m.key === e.target.value)!.levels[1].value })} aria-label="예외 메뉴">
            {d.menus.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
          <select className={cx(inputCls, 'h-9 !w-auto')} value={add.level} onChange={(e) => setAdd({ ...add, level: e.target.value })} aria-label="예외 단계">
            {addLevels.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
          <Button size="sm" disabled={!add.userId || busy === 'add'} onClick={() => put({ menu: add.menu, userId: add.userId, level: add.level }, 'add')}>예외 추가</Button>
        </div>
      </section>
      <TeamView d={d} users={users} reload={reload} />
      <p className="text-xs text-ink-3">자료실 행을 펼치면 보안 등급(내부·기밀)별 열람과 폴더별 권한·등급을 같은 화면에서 정합니다. 폴더 설정은 하위 폴더에 그대로 이어집니다.</p>
    </div>
  );
}

/** 대표 10/20 4): 사람별 '팀 업무 보기' — 전체(다른 팀 전체 예외 조회) / 자기 팀만(예외·지정 없음) / 지정 팀(team_view_grants). 격리 팀원은 무엇을 골라도 자기 팀만 */
function TeamView({ d, users, reload }: { d: M; users: { id: string; name: string; role: Role; status: string }[]; reload: () => void }) {
  const teams = useApi<{ teams: { id: string; name: string; kind: string; parent_name: string | null }[] }>('/api/teams');
  const [userId, setUserId] = useState(''); const [busy, setBusy] = useState(false); const [pickMode, setPickMode] = useState(false); // '지정 팀'을 골랐지만 아직 팀을 안 고른 상태
  const list = (teams.data?.teams ?? []);
  const allLv = d.overrides.find((o) => o.menu === 'team_tasks_all' && o.user_id === userId)?.level;
  const picked = new Set(d.teamGrants.filter((g) => g.user_id === userId).map((g) => g.team_id));
  const mode = allLv && allLv !== 'none' ? 'all' : picked.size || pickMode ? 'pick' : 'own';
  async function setMode(m: 'all' | 'own' | 'pick') {
    setPickMode(m === 'pick'); setBusy(true);
    try {
      await api('/api/admin/menu-perms', { method: 'PUT', body: { menu: 'team_tasks_all', userId, level: m === 'all' ? 'view' : 'none' } });
      if (m !== 'pick') await api('/api/admin/menu-perms', { body: { userId, teamIds: [] } });
      reload(); toast.ok('바꿨습니다');
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  async function toggle(teamId: string) {
    const next = new Set(picked); if (next.has(teamId)) next.delete(teamId); else next.add(teamId);
    setBusy(true);
    try { await api('/api/admin/menu-perms', { body: { userId, teamIds: [...next] } }); reload(); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  return (
    <section className="rounded-card border border-line bg-white p-3" data-testid="team-view-perm">
      <h2 className="text-sm font-semibold">팀 업무 보기 <span className="font-normal text-ink-3">— 사람마다 전체 / 자기 팀만 / 지정 팀 (업무 화면 ‘팀별’ 칩에 그 팀만 보임, 격리 팀원은 자기 팀만)</span></h2>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select className={cx(inputCls, 'h-9 !w-auto')} value={userId} onChange={(e) => { setUserId(e.target.value); setPickMode(false); }} aria-label="팀 업무 보기 사람" data-testid="team-view-user">
          <option value="">사람 선택</option>{users.filter((u) => u.role !== 'owner' && u.status !== 'disabled').map((u) => <option key={u.id} value={u.id}>{u.name} ({ROLE_LABEL[u.role]})</option>)}
        </select>
        {userId && <div className="flex rounded-input border border-line p-0.5 text-xs" role="radiogroup" aria-label="팀 업무 보기 범위">
          {([['all', '전체'], ['own', '자기 팀만'], ['pick', '지정 팀']] as const).map(([k, l]) => (
            <button key={k} type="button" role="radio" aria-checked={mode === k} disabled={busy} onClick={() => setMode(k)} className={cx('rounded-[6px] px-2.5 py-1', mode === k ? 'bg-brand-600 font-semibold text-white' : 'hover:bg-slate-50')} data-testid={`team-view-${k}`}>{l}</button>))}
        </div>}
      </div>
      {userId && mode === 'pick' && <div className="mt-2 flex flex-wrap gap-1.5" data-testid="team-view-teams">
        {list.map((t) => <label key={t.id} className={cx('inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs', picked.has(t.id) ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-line')}>
          <input type="checkbox" className="sr-only" checked={picked.has(t.id)} disabled={busy} onChange={() => toggle(t.id)} />{t.kind === 'team' && t.parent_name ? `${t.parent_name} › ` : ''}{t.name}</label>)}
        {!list.length && <span className="text-xs text-ink-3">부서·팀이 없습니다</span>}
      </div>}
      {userId && mode === 'pick' && !picked.size && <p className="mt-1 text-xs text-ink-3">팀을 하나 이상 고르세요 — 고르지 않으면 ‘자기 팀만’과 같습니다.</p>}
      {d.teamGrants.length > 0 && <ul className="mt-2 divide-y divide-line text-xs text-ink-2" data-testid="team-view-list">{Object.entries(d.teamGrants.reduce<Record<string, string[]>>((a, g) => { (a[g.name] ??= []).push(g.team_name); return a; }, {})).map(([n, ts]) => <li key={n} className="py-1">{n}: 지정 팀 {ts.join(' · ')}</li>)}</ul>}
    </section>
  );
}

/** 자료실 아래에 펼쳐 보이는 행: 보안 등급별 열람 (V14 15·17번) */
const NESTED = ['library_internal', 'confidential'];
/** 단계별 독립 스위치 — 저장은 기존 단계(편집을 켜면 조회도, 조회를 끄면 나머지도) */
function Switches({ levels, value, onSet, label, disabled }: { levels: Level[]; value: string; onSet: (v: string) => void; label: string; disabled?: boolean }) {
  const idx = levels.findIndex((l) => l.value === value);
  const steps = levels.slice(1);
  return (
    <div className="flex flex-wrap gap-1">
      {steps.map((l, j) => {
        const on = j + 1 <= idx;
        const name = steps.length === 1 ? '켬' : SHORT[l.value] ?? l.label;
        return (
          <button key={l.value} type="button" role="switch" aria-checked={on} disabled={disabled} aria-label={`${label} ${name}`}
            onClick={() => onSet(on ? levels[j].value : l.value)}
            className={cx('hit inline-flex h-8 items-center gap-1 rounded-full border px-2.5 text-xs font-medium transition-colors disabled:opacity-50',
              on ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-white text-ink-3 hover:border-slate-400')}>
            <span className={cx('size-2 rounded-full', on ? 'bg-white' : 'bg-slate-300')} />{name}
          </button>
        );
      })}
    </div>
  );
}
const SHORT: Record<string, string> = { view: '조회', edit: '편집', delete: '삭제', use: '켬' };
function Row({ m, d, busy, put, nested, open, onToggle }: { m: M['menus'][number]; d: M; busy: string; put: (b: Record<string, unknown>, key: string) => void; nested?: boolean; open?: boolean; onToggle?: () => void }) {
  const levels = m.key === 'library' ? m.levels.map((l) => (l.value === 'edit' ? { ...l, label: '올리기·수정' } : l)) : m.levels;
  const lib = m.key === 'library';
  return (
    <tr data-menu={m.key} className={nested ? 'bg-slate-50/60' : ''}>
      <td className={cx('p-2 font-medium', nested && 'pl-7 text-ink-2')}>
        {onToggle ? <button type="button" onClick={onToggle} aria-expanded={open} className="inline-flex items-center gap-1 hover:underline" data-testid="perm-library-toggle">
          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}{m.label}</button>
          : <span className="inline-flex items-center gap-1">{m.key === 'confidential' && <Lock className="size-3.5 text-red-600" />}{m.label}</span>}
      </td>
      {d.roles.map((r) => (
        <td key={r} className="p-2">
          <Switches levels={lib ? levels.map((l) => ({ ...l, label: l.value === 'edit' ? '올리기·수정' : l.label })) : levels} value={d.matrix[m.key][r]} label={`${m.label} ${ROLE_LABEL[r]}`}
            disabled={r === 'owner' || busy === `${m.key}.${r}`} onSet={(v) => put({ menu: m.key, role: r, level: v }, `${m.key}.${r}`)} />
          {r === 'owner' && <span className="text-[10px] text-ink-3">고정</span>}
        </td>
      ))}
    </tr>
  );
}
type Folder = { folder: string; n: number; security?: string };
/** 자료실 행 펼침: 폴더별 등급 + 등급(역할)별 폴더 권한 */
function LibraryFolders({ roles }: { roles: Role[] }) {
  const lib = useApi<{ folders: Folder[] }>('/api/library');
  const fp = useApi<{ perms: { folder: string; role: string; level: string }[] }>('/api/library/folder-perms');
  const fs = useApi<{ folders: { folder: string; security: string }[] }>('/api/library/folder-security');
  const [busy, setBusy] = useState('');
  async function call(url: string, body: unknown, key: string) {
    setBusy(key);
    try { await api(url, { method: 'PUT', body }); fp.reload(); fs.reload(); lib.reload(); toast.ok('바꿨습니다'); } catch (e: any) { toast.error(e.message); } finally { setBusy(''); }
  }
  const folders = (lib.data?.folders ?? []).filter((f) => f.folder);
  const levels: Level[] = [{ value: 'none', label: '끔' }, { value: 'view', label: '조회' }, { value: 'edit', label: '올리기·수정' }, { value: 'delete', label: '삭제' }];
  const others = roles.filter((r) => r !== 'owner');
  if (!folders.length) return <p className="text-xs text-ink-3">아직 폴더가 없습니다. 자료실에서 폴더를 만들면 여기서 폴더별 권한·등급을 정할 수 있습니다.</p>;
  return (
    <div className="space-y-1.5" data-testid="perm-folders">
      <p className="text-xs text-ink-3">폴더별: 보안 등급(하위 폴더·파일에 상속, 파일은 더 높게만) · 등급별 권한(비워 두면 위 자료실 설정을 따름, 더 넓힐 수는 없음)</p>
      <table className="w-full text-xs">
        <thead><tr className="text-left text-ink-3"><th className="p-1.5">폴더</th><th className="p-1.5">보안 등급</th>{others.map((r) => <th key={r} className="p-1.5">{ROLE_LABEL[r]}</th>)}</tr></thead>
        <tbody className="divide-y divide-line">
          {folders.map((f) => {
            const sec = fs.data?.folders.find((x) => x.folder === f.folder)?.security ?? '';
            return (
              <tr key={f.folder} data-folder={f.folder}>
                <td className="p-1.5 font-medium">{f.folder}</td>
                <td className="p-1.5">
                  <select className={cx(inputCls, 'h-8 w-28 text-xs', sec === 'confidential' && 'text-red-700')} value={sec} disabled={busy === `sec.${f.folder}`} aria-label={`${f.folder} 보안 등급`}
                    onChange={(e) => call('/api/library/folder-security', { folder: f.folder, security: e.target.value || null }, `sec.${f.folder}`)}>
                    <option value="">상속(설정 없음)</option><option value="public">일반</option><option value="internal">내부</option><option value="confidential">🔒 기밀</option>
                  </select>
                </td>
                {others.map((r) => {
                  const p = fp.data?.perms.find((x) => x.folder === f.folder && x.role === r);
                  return (
                    <td key={r} className="p-1.5">
                      {p ? <div className="flex items-center gap-1"><Switches levels={levels} value={p.level} label={`${f.folder} ${ROLE_LABEL[r]}`} disabled={busy === `fp.${f.folder}.${r}`}
                        onSet={(v) => call('/api/library/folder-perms', { folder: f.folder, role: r, level: v }, `fp.${f.folder}.${r}`)} />
                        <button className="text-ink-3 underline" onClick={() => call('/api/library/folder-perms', { folder: f.folder, role: r, level: null }, `fp.${f.folder}.${r}`)}>기본</button></div>
                        : <button className="text-ink-3 underline" onClick={() => call('/api/library/folder-perms', { folder: f.folder, role: r, level: 'view' }, `fp.${f.folder}.${r}`)} aria-label={`${f.folder} ${ROLE_LABEL[r]} 따로 정하기`}>자료실 설정 따름 · 따로 정하기</button>}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
