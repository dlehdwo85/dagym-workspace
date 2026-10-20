'use client';
import { useMemo, useState } from 'react';
import { useApi } from '@/components/client';
import { cx, inputCls } from '@/components/ui';

export type PickTeam = { id: string; name: string; kind: 'dept' | 'team'; path: string; depth: number; isolated: boolean; default_spaces: string[]; color: string };
/**
 * 대표 10/20 15:15 부서·팀 재정비 — 초대·사용자 편집의 '소속' 하나: 트리(들여쓰기·경로)에서 체크(겸직 n개) + '주' 라디오(주 소속 1개).
 * 접근 범위는 소속에서 자동(자기 팀 + 상위 부서 공용) — 예전 '접근 가능한 조직' 체크는 고급 설정으로.
 */
export function TeamPicker({ teamIds, primaryTeamId, onChange, testid = 'invite-team' }: { teamIds: string[]; primaryTeamId: string | null; onChange: (v: { teamIds: string[]; primaryTeamId: string | null; teams: PickTeam[] }) => void; testid?: string }) {
  const { data } = useApi<{ teams: PickTeam[] }>('/api/teams');
  const [q, setQ] = useState('');
  const all = useMemo(() => data?.teams ?? [], [data]);
  const shown = q.trim() ? all.filter((t) => t.path.includes(q.trim())) : all;
  const emit = (ids: string[], primary: string | null) => onChange({ teamIds: ids, primaryTeamId: primary, teams: all.filter((t) => ids.includes(t.id)) });
  const toggle = (id: string, on: boolean) => {
    const ids = on ? [...teamIds, id] : teamIds.filter((x) => x !== id);
    const primary = on ? (primaryTeamId ?? id) : primaryTeamId === id ? ids[0] ?? null : primaryTeamId;
    emit(ids, primary);
  };
  return (
    <div data-testid="team-picker">
      {all.length > 6 && <input className={cx(inputCls, 'mb-1 h-8 text-xs')} placeholder="부서·팀 찾기" value={q} onChange={(e) => setQ(e.target.value)} aria-label="부서·팀 찾기" />}
      <div className="max-h-44 overflow-y-auto rounded border p-1.5">
        {shown.map((t) => {
          const on = teamIds.includes(t.id);
          return (
            <div key={t.id} className="flex items-center gap-2 py-0.5 text-sm" style={{ paddingLeft: Math.min(t.depth, 6) * 14 }}>
              <label className="flex min-w-0 flex-1 items-center gap-2">
                <input type="checkbox" checked={on} onChange={(e) => toggle(t.id, e.target.checked)} data-testid={testid} aria-label={`${t.path} 소속`} />
                <span className="size-2 shrink-0 rounded-full" style={{ background: t.color }} aria-hidden />
                <span className="truncate">{t.name}</span>
                <span className="shrink-0 text-[11px] text-ink-3">{t.kind === 'dept' ? '부서' : '팀'}{t.isolated ? ' · 격리' : ''}</span>
              </label>
              {on && <label className={cx('flex shrink-0 items-center gap-1 text-[11px]', primaryTeamId === t.id ? 'text-brand-700' : 'text-ink-3')}>
                <input type="radio" name={`${testid}-primary`} checked={primaryTeamId === t.id} onChange={() => emit(teamIds, t.id)} data-testid={`team-primary-${t.id}`} aria-label={`${t.path} 주 소속`} />주 소속</label>}
            </div>
          );
        })}
        {data && !all.length && <p className="px-1 py-1 text-xs text-ink-3">아직 부서·팀이 없습니다 — 부서·팀 탭에서 만들 수 있습니다</p>}
        {data && all.length > 0 && !shown.length && <p className="px-1 py-1 text-xs text-ink-3">찾는 부서·팀이 없습니다</p>}
      </div>
      <p className="mt-1 text-xs text-ink-3">주 소속 1곳 + 겸직 여러 곳. 볼 수 있는 범위(자기 팀 + 상위 부서 공용)는 소속에서 자동으로 정해집니다.</p>
    </div>
  );
}
/** 경로 표기: PC는 "영업부 › 영업1팀", 휴대폰은 마지막 단위만 */
export function TeamPath({ path, className }: { path: string; className?: string }) {
  const parts = path.split(' › ');
  const last = parts[parts.length - 1];
  return <span className={className}>{parts.length > 1 && <span className="hidden text-ink-3 sm:inline">{parts.slice(0, -1).join(' › ')} › </span>}{last}</span>;
}
