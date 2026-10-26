'use client';
import { use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Crown, MessageCircle, UsersRound } from 'lucide-react';
import { useApi } from '@/components/client';
import { Avatar, DueChip, Empty, PageHeader, Skeleton, StatusBadge, cx } from '@/components/ui';
import type { Team } from '@/components/Teams';
import { leadTitle } from '@/lib/orgKinds';

/** V14 8번 팀 보드: 팀원별 열 + 담당자 미정(팀장이 지정할 업무) */
export default function TeamBoard({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const teams = useApi<{ teams: Team[] }>('/api/teams');
  const tasks = useApi<any[]>(`/api/tasks?teamId=${id}&includeDone=recent&limit=500`);
  const team = teams.data?.teams.find((t) => t.id === id);
  if (teams.loading && !teams.data) return <Skeleton rows={6} />;
  if (!team) return <Empty title="팀이 없습니다" icon={UsersRound}>보관됐거나 볼 수 없는 팀입니다.</Empty>;
  const all: any[] = Array.isArray(tasks.data) ? tasks.data : (tasks.data as any)?.tasks ?? [];
  // P2 조직 개편: 이 부서가 주관하는 업무는 담당자별 열, 다른 부서 업무에 '함께하는 부서'로 붙은 것은 맨 끝 열
  const list = all.filter((t) => t.team_id === id);
  const shared = all.filter((t) => t.team_id !== id);
  const cols = [{ id: null as string | null, name: '담당자 미정', lead: false }, ...team.members.map((m) => ({ id: m.id as string | null, name: m.name, lead: m.lead }))];
  return (
    <div className="space-y-3">
      {/* 대기열 ①(10/19): 하위 화면 뒤로가기 — 기록이 있으면 뒤로, 없으면 부서·팀 목록 */}
      <button type="button" onClick={() => (window.history.length > 1 ? router.back() : router.push('/admin/users?tab=teams'))} className="inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink" data-testid="team-back"><ArrowLeft className="size-4" />뒤로</button>
      <PageHeader title={team.path ?? team.name} icon={UsersRound} sub={`구성원 ${team.members.length}명 · 열린 업무 ${list.filter((t) => t.status !== 'done').length}건${shared.length ? ` · 함께하는 업무 ${shared.filter((t) => t.status !== 'done').length}건` : ''}`}
        actions={team.room_id ? <Link href={`/messages?room=${team.room_id}`} className="inline-flex h-9 items-center gap-1.5 rounded-input border border-line px-3 text-sm hover:bg-slate-50"><MessageCircle className="size-4" />팀 대화방</Link> : null} />
      <div className="scrollbar-thin -mx-3 flex gap-3 overflow-x-auto px-3 pb-3" data-testid="team-board">
        {cols.map((c) => {
          const mine = list.filter((t) => (t.assignee_id ?? null) === c.id);
          if (c.id === null && !mine.length) return null;
          return (
            <section key={c.id ?? 'none'} className="w-72 shrink-0 rounded-card border border-line bg-slate-50 p-2" data-testid="team-col">
              <h2 className="mb-2 flex items-center gap-1.5 px-1 text-sm font-semibold">
                {c.id ? <Avatar id={c.id} name={c.name} size={22} /> : null}{c.name}{c.lead && <Crown className="size-3.5 text-amber-600" aria-label={leadTitle(team.kind)} />}
                <span className="ml-auto text-xs font-normal text-ink-3">{mine.filter((t) => t.status !== 'done').length}</span>
              </h2>
              <ul className="space-y-1.5">
                {mine.map((t) => (
                  <li key={t.id}><Link href={`/tasks/${t.id}`} className={cx('block rounded-input border border-line bg-white p-2 text-sm shadow-card hover:border-slate-300', t.status === 'done' && 'opacity-60')}>
                    <div className="line-clamp-2 font-medium">{t.title}</div>
                    <div className="mt-1 flex items-center gap-1.5"><StatusBadge status={t.status} /><DueChip due={t.due_date} status={t.status} /></div>
                  </Link></li>
                ))}
                {!mine.length && <li className="px-1 py-2 text-xs text-ink-3">업무 없음</li>}
              </ul>
            </section>
          );
        })}
        {shared.length > 0 && (
          <section className="w-72 shrink-0 rounded-card border border-dashed border-line bg-white p-2" data-testid="team-col-shared">
            <h2 className="mb-2 flex items-center gap-1.5 px-1 text-sm font-semibold">다른 부서와 함께<span className="ml-auto text-xs font-normal text-ink-3">{shared.filter((t) => t.status !== 'done').length}</span></h2>
            <ul className="space-y-1.5">
              {shared.map((t) => (
                <li key={t.id}><Link href={`/tasks/${t.id}`} className={cx('block rounded-input border border-line bg-white p-2 text-sm shadow-card hover:border-slate-300', t.status === 'done' && 'opacity-60')}>
                  <div className="line-clamp-2 font-medium">{t.title}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5"><StatusBadge status={t.status} /><DueChip due={t.due_date} status={t.status} />{t.team_name && <span className="text-[11px] text-ink-3">주관 {t.team_name}</span>}{t.assignee_name && <span className="text-[11px] text-ink-3">· {t.assignee_name}</span>}</div>
                </Link></li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
