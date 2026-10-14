'use client';
import { useState } from 'react';
import { ShieldCheck, Trash2 } from 'lucide-react';
import { api, useApi } from '@/components/client';
import { Button, ErrorBox, Skeleton, cx, inputCls, toast } from '@/components/ui';
import { ROLE_LABEL, type Role } from '@/lib/types';

type Level = { value: string; label: string };
type M = { menus: { key: string; label: string; levels: Level[] }[]; roles: Role[]; matrix: Record<string, Record<string, string>>; overrides: { menu: string; user_id: string; level: string; name: string }[] };

/** V13 2·4번 메뉴 권한 (대표만): 행 = 메뉴, 열 = 등급, 칸 = 단계. 아래에 사람별 예외 */
export function MenuPermsTab({ users }: { users: { id: string; name: string; role: Role; status: string }[] }) {
  const { data, error, loading, reload } = useApi<M>('/api/admin/menu-perms');
  const [busy, setBusy] = useState('');
  const [add, setAdd] = useState({ menu: 'revenue', userId: '', level: 'view' });
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
        <table className="w-full min-w-[640px] text-sm">
          <thead><tr className="border-b border-line bg-slate-50 text-left text-xs text-ink-2"><th className="p-2">메뉴</th>{d.roles.map((r) => <th key={r} className="p-2">{ROLE_LABEL[r]}</th>)}</tr></thead>
          <tbody className="divide-y divide-line">
            {d.menus.map((m) => (
              <tr key={m.key} data-menu={m.key}>
                <td className="p-2 font-medium">{m.label}</td>
                {d.roles.map((r) => (
                  <td key={r} className="p-2">
                    {r === 'owner' ? <span className="text-xs text-ink-3">{label(m.key, d.matrix[m.key][r])} (고정)</span> : (
                      <select className={cx(inputCls, 'h-8 min-w-[6.5rem] text-xs', d.matrix[m.key][r] === 'none' && 'text-ink-3')} value={d.matrix[m.key][r]} disabled={busy === `${m.key}.${r}`}
                        onChange={(e) => put({ menu: m.key, role: r, level: e.target.value }, `${m.key}.${r}`)} aria-label={`${m.label} ${ROLE_LABEL[r]}`}>
                        {m.levels.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                      </select>
                    )}
                  </td>
                ))}
              </tr>
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
          <select className={cx(inputCls, 'h-9 w-auto')} value={add.userId} onChange={(e) => setAdd({ ...add, userId: e.target.value })} aria-label="예외 사람">
            <option value="">사람 선택</option>{users.filter((u) => u.role !== 'owner' && u.status !== 'disabled').map((u) => <option key={u.id} value={u.id}>{u.name} ({ROLE_LABEL[u.role]})</option>)}
          </select>
          <select className={cx(inputCls, 'h-9 w-auto')} value={add.menu} onChange={(e) => setAdd({ ...add, menu: e.target.value, level: d.menus.find((m) => m.key === e.target.value)!.levels[1].value })} aria-label="예외 메뉴">
            {d.menus.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
          <select className={cx(inputCls, 'h-9 w-auto')} value={add.level} onChange={(e) => setAdd({ ...add, level: e.target.value })} aria-label="예외 단계">
            {addLevels.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
          <Button size="sm" disabled={!add.userId || busy === 'add'} onClick={() => put({ menu: add.menu, userId: add.userId, level: add.level }, 'add')}>예외 추가</Button>
        </div>
      </section>
      <p className="text-xs text-ink-3">자료실은 폴더마다 따로 좁힐 수 있습니다(자료실 → 폴더 고르기 → &ldquo;폴더 권한&rdquo;). 폴더 설정은 하위 폴더에 그대로 이어집니다.</p>
    </div>
  );
}
