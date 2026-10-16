'use client';
import { api, broadcastRefresh, useApi } from '@/components/client';
import { ErrorBox, Skeleton, cx, toast } from '@/components/ui';
import { SPACE_META } from '@/components/spaceMeta';

type Data = { enabled: string[]; users: { id: string; name: string; role: string; admin: boolean; spaces: string[] }[] };

/** V41 단계 1: 관리 › 사용자 › 공간 — 영업·마케팅 공간 켜기/끄기(가격은 대표 결정 전, 결제 연동 없음) + 직원별 배정(관리자는 켠 공간 전부) */
export function SpacesTab() {
  const { data, error, reload } = useApi<Data>('/api/admin/spaces');
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Skeleton rows={4} />;
  const extra = (['sales', 'marketing'] as const);
  async function toggle(space: 'sales' | 'marketing', on: boolean) {
    try { await api('/api/admin/spaces', { method: 'PUT', body: { space, on } }); toast.ok(on ? `${SPACE_META[space].short} 공간을 켰습니다` : `${SPACE_META[space].short} 공간을 껐습니다`); reload(); broadcastRefresh(); location.reload(); } catch (e: any) { toast.error(e.message); }
  }
  async function assign(userId: string, cur: string[], space: string, on: boolean) {
    const next = extra.filter((s) => (s === space ? on : cur.includes(s)));
    try { await api('/api/admin/spaces/members', { method: 'PUT', body: { userId, spaces: next } }); reload(); } catch (e: any) { toast.error(e.message); }
  }
  return (
    <div className="space-y-4" data-testid="spaces-tab">
      <section className="rounded-card border border-line bg-white p-4 shadow-card">
        <h2 className="text-sm font-semibold">회사 공간</h2>
        <p className="mt-1 text-xs text-ink-2">업무 공간은 늘 켜져 있습니다. 영업·마케팅 공간을 켜면 관리자는 바로 보이고, 직원은 아래에서 배정한 사람만 보입니다. (공간 추가 요금은 아직 정해지지 않아 결제 없이 켜고 끕니다)</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <div className="flex items-center gap-2 rounded-input border border-line px-3 py-2 text-sm"><span className="size-3 rounded-full" style={{ background: SPACE_META.work.color }} />{SPACE_META.work.label}<span className="ml-auto text-xs text-ink-3">늘 켜짐</span></div>
          {extra.map((s) => {
            const on = data.enabled.includes(s);
            return (
              <label key={s} className="flex items-center gap-2 rounded-input border border-line px-3 py-2 text-sm">
                <span className="size-3 rounded-full" style={{ background: SPACE_META[s].color }} />{SPACE_META[s].label}
                <input type="checkbox" className="ml-auto size-4" checked={on} onChange={(e) => toggle(s, e.target.checked)} aria-label={`${SPACE_META[s].short} 공간 켜기`} data-testid={`space-toggle-${s}`} />
              </label>
            );
          })}
        </div>
      </section>
      {data.enabled.length > 1 && (
        <section className="rounded-card border border-line bg-white p-4 shadow-card">
          <h2 className="text-sm font-semibold">직원별 공간</h2>
          <table className="mt-2 w-full text-sm" data-testid="space-members">
            <thead><tr className="text-left text-xs text-ink-3"><th className="py-1">이름</th>{extra.filter((s) => data.enabled.includes(s)).map((s) => <th key={s}>{SPACE_META[s].short}</th>)}</tr></thead>
            <tbody>{data.users.map((u) => (
              <tr key={u.id} className="border-t border-line">
                <td className="py-1.5">{u.name}{u.admin && <span className="ml-1 text-[11px] text-ink-3">관리자 · 모든 공간</span>}</td>
                {extra.filter((s) => data.enabled.includes(s)).map((s) => (
                  <td key={s}><input type="checkbox" className={cx('size-4', u.admin && 'opacity-50')} disabled={u.admin} checked={u.admin || u.spaces.includes(s)}
                    onChange={(e) => assign(u.id, u.spaces, s, e.target.checked)} aria-label={`${u.name} ${SPACE_META[s].short} 공간`} /></td>
                ))}
              </tr>
            ))}</tbody>
          </table>
        </section>
      )}
    </div>
  );
}
