'use client';
// V30 ⑤ 관리자 이용 현황 탭: 오늘/7일/30일 접속한 사람, 날짜별 막대(접속·만든 업무·끝낸 업무), 사용자·팀별 표, 엑셀
import { useState } from 'react';
import { Download } from 'lucide-react';
import { useApi } from '@/components/client';
import { fmtBytes } from '@/components/usage';
import { ErrorBox, Skeleton, cx, fmtDateTime } from '@/components/ui';

type Stats = {
  days: number; since: string; today: string;
  summary: { dau: number; wau: number; mau: number; users: number; activeInRange: number; tasksCreated: number; tasksDone: number; storageBytes: number };
  users: { id: string; name: string; title: string | null; role: string; status: string; last_active: string | null; active_days: number; tasks_created: number; tasks_done: number; storage_bytes: number; teams: string[] }[];
  teams: { id: string; name: string; color: string; members: number; active_users: number; tasks_created: number; tasks_done: number }[];
  daily: { day: string; active: number; created: number; done: number }[];
};
const RANGES: [number, string][] = [[7, '7일'], [30, '30일'], [90, '90일']];
const ago = (iso: string | null) => {
  if (!iso) return '접속 기록 없음';
  const h = (Date.now() - new Date(iso).getTime()) / 3600_000;
  if (h < 1) return '방금';
  if (h < 24) return `${Math.floor(h)}시간 전`;
  if (h < 24 * 30) return `${Math.floor(h / 24)}일 전`;
  return fmtDateTime(iso);
};

export function UsageStats() {
  const [days, setDays] = useState(30);
  const [sort, setSort] = useState<'last' | 'created' | 'done' | 'storage'>('last');
  const st = useApi<Stats>(`/api/usage/stats?days=${days}`, [days]);
  if (st.error) return <ErrorBox error={st.error} retry={st.reload} />;
  if (!st.data) return <Skeleton rows={6} />;
  const { summary: s, users, teams, daily } = st.data;
  const max = Math.max(1, ...daily.map((d) => Math.max(d.active, d.created, d.done)));
  const sorted = [...users].sort((a, b) => sort === 'created' ? b.tasks_created - a.tasks_created : sort === 'done' ? b.tasks_done - a.tasks_done : sort === 'storage' ? b.storage_bytes - a.storage_bytes
    : (b.last_active ? new Date(b.last_active).getTime() : 0) - (a.last_active ? new Date(a.last_active).getTime() : 0));
  const th = (k: typeof sort, label: string) => <th className={cx('cursor-pointer py-1 text-right', sort === k && 'text-brand-700')} onClick={() => setSort(k)}>{label}{sort === k ? ' ▾' : ''}</th>;
  return (
    <div className="space-y-4" data-testid="usage-stats">
      <div className="flex flex-wrap items-center gap-1.5">
        {RANGES.map(([d, l]) => <button key={d} onClick={() => setDays(d)} className={cx('rounded-full border px-3 py-1 text-xs font-medium', days === d ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-white text-ink-2')} data-testid={`stats-range-${d}`}>{l}</button>)}
        <span className="text-xs text-ink-3">{st.data.since} ~ {st.data.today}</span>
        <a href={`/api/usage/stats/export?days=${days}`} className="ml-auto inline-flex h-7 items-center gap-1 rounded-input border border-line bg-white px-2.5 text-xs hover:bg-slate-50" data-testid="stats-export"><Download className="size-3.5" />엑셀</a>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="stats-summary">
        {[['오늘 접속', `${s.dau}명`, `사용자 ${s.users}명 중`], ['7일 접속', `${s.wau}명`, '최근 7일에 한 번이라도'], ['30일 접속', `${s.mau}명`, `${days}일 안 접속 ${s.activeInRange}명`], [`${days}일 업무`, `${s.tasksCreated} / ${s.tasksDone}`, '만든 수 / 끝낸 수']].map(([t, v, sub]) => (
          <div key={t} className="rounded-card border border-line bg-white p-3 shadow-card"><div className="text-xs text-ink-2">{t}</div><div className="text-xl font-bold tabular-nums">{v}</div><div className="text-[11px] text-ink-3">{sub}</div></div>
        ))}
      </div>
      <section className="rounded-card border border-line bg-white p-4 shadow-card">
        <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-sm font-semibold">날짜별</h2><span className="flex gap-3 text-[11px] text-ink-3"><i className="inline-flex items-center gap-1"><b className="inline-block size-2 rounded-sm bg-brand-500" />접속</i><i className="inline-flex items-center gap-1"><b className="inline-block size-2 rounded-sm bg-sky-400" />만든 업무</i><i className="inline-flex items-center gap-1"><b className="inline-block size-2 rounded-sm bg-emerald-500" />끝낸 업무</i></span></div>
        <div className="mt-2 flex h-28 items-end gap-px overflow-hidden" data-testid="stats-daily">
          {daily.map((d) => (
            <div key={d.day} className="flex h-full min-w-0 flex-1 items-end justify-center gap-px" title={`${d.day} · 접속 ${d.active}명 · 만든 업무 ${d.created} · 끝낸 업무 ${d.done}`}>
              <span className="w-1/3 rounded-t bg-brand-500" style={{ height: `${(d.active / max) * 100}%` }} /><span className="w-1/3 rounded-t bg-sky-400" style={{ height: `${(d.created / max) * 100}%` }} /><span className="w-1/3 rounded-t bg-emerald-500" style={{ height: `${(d.done / max) * 100}%` }} />
            </div>
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[11px] text-ink-3"><span>{daily[0]?.day.slice(5)}</span><span>{daily[daily.length - 1]?.day.slice(5)}</span></div>
      </section>
      <section className="rounded-card border border-line bg-white p-4 shadow-card">
        <h2 className="text-sm font-semibold">사용자별 <span className="font-normal text-ink-3">— 제목을 눌러 정렬</span></h2>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm" data-testid="stats-users">
            <thead><tr className="text-left text-xs text-ink-3"><th className="py-1">이름</th><th>팀</th>{th('last', '최근 접속')}<th className="text-right">접속일</th>{th('created', '만든 업무')}{th('done', '끝낸 업무')}{th('storage', '저장')}</tr></thead>
            <tbody>
              {sorted.map((x) => (
                <tr key={x.id} className={cx('border-t border-line', x.status !== 'active' && 'text-ink-3')} data-testid="stats-user-row" data-user={x.id}>
                  <td className="py-1.5">{x.name}{x.title && <span className="ml-1 text-[11px] text-ink-3">{x.title}</span>}{x.status !== 'active' && <span className="ml-1 rounded bg-slate-100 px-1 text-[10px]">비활성</span>}</td>
                  <td className="text-xs text-ink-2">{x.teams.join(', ') || '—'}</td>
                  <td className="text-right text-xs tabular-nums" data-testid="stats-last">{ago(x.last_active)}</td>
                  <td className="text-right tabular-nums">{x.active_days}</td><td className="text-right tabular-nums" data-testid="stats-created">{x.tasks_created}</td><td className="text-right tabular-nums" data-testid="stats-done">{x.tasks_done}</td><td className="text-right text-xs tabular-nums">{fmtBytes(x.storage_bytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="rounded-card border border-line bg-white p-4 shadow-card">
        <h2 className="text-sm font-semibold">팀별</h2>
        {!teams.length ? <p className="mt-1 text-xs text-ink-3">팀이 없습니다 — 사용자 관리에서 팀을 만들면 팀별로 보입니다</p> : (
          <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[420px] text-sm" data-testid="stats-teams">
            <thead><tr className="text-left text-xs text-ink-3"><th className="py-1">팀</th><th className="text-right">인원</th><th className="text-right">접속한 사람</th><th className="text-right">만든 업무</th><th className="text-right">끝낸 업무</th></tr></thead>
            <tbody>{teams.map((x) => <tr key={x.id} className="border-t border-line" data-testid="stats-team-row"><td className="py-1.5"><i className="mr-1.5 inline-block size-2 rounded-full" style={{ background: x.color }} />{x.name}</td><td className="text-right tabular-nums">{x.members}</td><td className="text-right tabular-nums">{x.active_users}</td><td className="text-right tabular-nums">{x.tasks_created}</td><td className="text-right tabular-nums">{x.tasks_done}</td></tr>)}</tbody>
          </table></div>
        )}
      </section>
      <p className="text-[11px] text-ink-3">접속 = 그날 워크인(웹·앱)을 한 번이라도 연 사람. 끝낸 업무는 담당자 기준, 저장은 그 사람이 올린 파일 합계입니다.</p>
    </div>
  );
}
