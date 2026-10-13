'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, CalendarDays, CalendarRange, CheckCircle2, ChevronLeft, ChevronRight, CircleCheck, Hourglass, MapPin, MessageSquare, PlusCircle, Users, Activity as ActivityIcon } from 'lucide-react';
import { api, broadcastRefresh, useApi } from '@/components/client';
import { useSession } from '@/components/session';
import { Avatar, Button, Card, DueChip, ErrorBox, PriorityTag, Skeleton, cx, fmtDate, fmtDateTime, fmtTime, toast } from '@/components/ui';
import { InlineAddTask } from '@/components/TaskQuick';

const seoulDay = (d: Date | string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(d));
const addDays = (d: string, n: number) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const dow = (d: string) => new Date(d + 'T00:00:00Z').getUTCDay();
const cleanTitle = (t: string) => t.replace(/^(\[(업무|업무 시간)\]\s*)+/, '');
/** 일정이 걸친 서울 날짜들 (종일 일정의 끝은 다음 날 0시라 하루 빼서 계산) */
function eventDays(e: any): string[] {
  const s = seoulDay(e.start);
  const end = seoulDay(new Date(new Date(e.end).getTime() - 1));
  const out: string[] = [];
  for (let d = s; d <= end && out.length < 62; d = addDays(d, 1)) out.push(d);
  return out.length ? out : [s];
}

function Section({ title, count, children, href, icon: Icon, className, actions, testid }: {
  title: string; count?: number; children: React.ReactNode; href?: string; icon?: typeof Users; className?: string; actions?: React.ReactNode; testid?: string;
}) {
  return (
    <Card className={cx('flex flex-col', className)} data-testid={testid}>
      <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-3.5">
        <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold">{Icon && <Icon className="size-4 shrink-0 text-ink-3" />}<span className="truncate">{title}</span>{count !== undefined && <span className="rounded-full bg-slate-100 px-1.5 text-xs font-medium text-ink-2 tabular-nums">{count}</span>}</h2>
        <div className="flex shrink-0 items-center gap-2">
          {actions}
          {href && <Link href={href} className="inline-flex items-center gap-0.5 text-xs font-medium text-accent-600 hover:underline">전체<ArrowRight className="size-3" /></Link>}
        </div>
      </div>
      <div className="min-w-0 flex-1 px-2 pb-2">{children}</div>
    </Card>
  );
}

/** 오늘 할 일 한 줄: 원형 체크로 바로 완료(관리자 확인·결재선 업무는 검토 요청) */
function TodayRow({ t, onDone }: { t: any; onDone: (t: any) => void }) {
  const { user } = useSession();
  const toReview = !!t.approval_line_id || (t.approval_required && user.role === 'staff');
  return (
    <li className="flex min-w-0 items-center gap-2.5 rounded-input px-2 py-1.5 text-sm hover:bg-slate-50">
      <button onClick={() => onDone(t)} aria-label={`${t.title} ${toReview ? '검토 요청' : '완료'}`} title={toReview ? '검토 요청' : '완료'}
        className="flex size-[22px] shrink-0 items-center justify-center rounded-full border-[1.5px] border-slate-300 text-transparent hover:border-emerald-500 hover:text-emerald-500">
        <CircleCheck className="size-[22px] stroke-[1.8]" style={{ margin: -1.5 }} />
      </button>
      <div className="min-w-0 flex-1">
        <Link href={`/tasks/${t.id}`} className="block truncate font-medium hover:text-accent-600 hover:underline">{t.title}</Link>
        <div className="truncate text-xs text-ink-2">{t.assignee_name ?? '담당자 없음'}{t.org_unit_name ? ` · ${t.org_unit_name}` : ''}</div>
      </div>
      <PriorityTag p={t.priority} label={false} />
      <DueChip due={t.due_date} status={t.status} />
    </li>
  );
}

function MonthCalendar({ month, setMonth, events, selected, setSelected, today }: {
  month: string; setMonth: (m: string) => void; events: any[]; selected: string; setSelected: (d: string) => void; today: string;
}) {
  const first = month + '-01';
  const startPad = (dow(first) + 6) % 7; // 월요일 시작
  const nextMonth = (() => { const [y, m] = month.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; })();
  const prevMonth = (() => { const [y, m] = month.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; })();
  const days: string[] = [];
  for (let d = first; d < nextMonth + '-01'; d = addDays(d, 1)) days.push(d);
  const has = new Set(events.flatMap(eventDays));
  return (
    <div className="px-2" data-testid="home-month">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-sm font-semibold tabular-nums">{Number(month.slice(0, 4))}년 {Number(month.slice(5))}월</span>
        <span className="flex">
          <button onClick={() => setMonth(prevMonth)} className="rounded p-1 text-ink-2 hover:bg-slate-100" aria-label="이전 달"><ChevronLeft className="size-4" /></button>
          <button onClick={() => { setMonth(today.slice(0, 7)); setSelected(today); }} className="rounded px-1.5 text-xs text-ink-2 hover:bg-slate-100">오늘</button>
          <button onClick={() => setMonth(nextMonth)} className="rounded p-1 text-ink-2 hover:bg-slate-100" aria-label="다음 달"><ChevronRight className="size-4" /></button>
        </span>
      </div>
      <div className="grid grid-cols-7 text-center text-[11px] text-ink-3">{['월', '화', '수', '목', '금', '토', '일'].map((d) => <span key={d} className="py-1">{d}</span>)}</div>
      <div className="grid grid-cols-7 text-center text-sm">
        {Array.from({ length: startPad }, (_, i) => <span key={'p' + i} />)}
        {days.map((d) => (
          <button key={d} onClick={() => setSelected(d)} aria-label={`${fmtDate(d)} 일정`} aria-pressed={selected === d}
            className={cx('relative mx-auto my-0.5 flex size-8 items-center justify-center rounded-full tabular-nums',
              selected === d ? 'bg-brand-600 font-semibold text-white' : d === today ? 'font-bold text-accent-600 ring-1 ring-accent-500' : dow(d) === 0 ? 'text-red-600 hover:bg-slate-100' : 'hover:bg-slate-100')}>
            {Number(d.slice(8))}
            {has.has(d) && <span className={cx('absolute bottom-0.5 size-1 rounded-full', selected === d ? 'bg-white' : 'bg-accent-500')} />}
          </button>
        ))}
      </div>
    </div>
  );
}

function EventRow({ e, withDate }: { e: any; withDate?: boolean }) {
  return (
    <li className="flex min-w-0 items-start gap-2.5 rounded-input px-2 py-1.5 text-sm hover:bg-slate-50">
      <span className="mt-0.5 h-8 w-1 shrink-0 rounded-full" style={{ background: e.color }} />
      <span className="w-14 shrink-0 pt-0.5 text-xs tabular-nums text-ink-2">{withDate && <span className="block">{Number(seoulDay(e.start).slice(5, 7))}/{Number(seoulDay(e.start).slice(8))}</span>}{e.allDay ? '종일' : fmtTime(e.start)}</span>
      <div className="min-w-0 flex-1">
        <Link href={`/calendar?date=${seoulDay(e.start)}&event=${e.id}`} className="block truncate font-medium hover:underline">{cleanTitle(e.title)}</Link>
        {e.location && <span className="flex min-w-0 items-center gap-1 text-xs text-ink-2"><MapPin className="size-3 shrink-0" /><span className="truncate">{e.location}</span></span>}
      </div>
    </li>
  );
}

export default function Dashboard() {
  const { user, dir } = useSession();
  const { data, error, loading, reload } = useApi<any>('/api/dashboard');
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const mine = useApi<{ tasks: any[] }>('/api/tasks?view=today&limit=50');
  const today = data?.today ?? seoulDay(new Date());
  const [month, setMonth] = useState(() => seoulDay(new Date()).slice(0, 7));
  const [selected, setSelected] = useState(() => seoulDay(new Date()));
  const monthRange = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
    return { from: `${month}-01T00:00:00+09:00`, to: `${next}T00:00:00+09:00` };
  }, [month]);
  const monthEvents = useApi<{ events: any[] }>(`/api/events?from=${encodeURIComponent(monthRange.from)}&to=${encodeURIComponent(monthRange.to)}`, [monthRange.from]);

  if (error) return <ErrorBox error={error} retry={reload} />;
  if (loading && !data) return <div className="space-y-4"><div className="skeleton h-8 w-60 rounded" /><div className="grid gap-3 lg:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-48 rounded-card" />)}</div><Skeleton rows={5} /></div>;
  if (!data) return null;
  const company = data.scope === 'company';
  const tot = data.totals;
  const todayTasks: any[] = scope === 'mine' ? mine.data?.tasks ?? [] : data.todayAll ?? [];

  async function done(t: any) {
    const toReview = !!t.approval_line_id || (t.approval_required && user.role === 'staff');
    try {
      await api(`/api/tasks/${t.id}`, { method: 'PATCH', body: { status: toReview ? 'review' : 'done' } });
      toast.ok(toReview ? '검토를 요청했습니다' : '완료했습니다', { label: '되돌리기', run: async () => { await api(`/api/tasks/${t.id}`, { method: 'PATCH', body: { status: t.status } }).catch(() => {}); reload(); mine.reload(); } });
      reload(); mine.reload(); broadcastRefresh();
    } catch (e: any) { toast.error(e.message); }
  }
  async function approve(t: any, ok: boolean) {
    try {
      if (ok) await api(`/api/tasks/${t.id}`, { method: 'PATCH', body: { status: 'done' } });
      else {
        const note = prompt('보완 요청 내용을 입력하세요') ?? '';
        if (!note) return;
        await api(`/api/tasks/${t.id}`, { method: 'PATCH', body: { status: 'in_progress', reviewNote: note } });
        await api(`/api/tasks/${t.id}/comments`, { body: { body: `[보완 요청] ${note}` } });
      }
      toast.ok(ok ? '최종 완료 처리했습니다' : '보완을 요청했습니다');
      reload(); broadcastRefresh();
    } catch (e: any) { toast.error(e.message); }
  }

  // 이번 주 일정: 요일별
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(data.week.start, i));
  const byDay = new Map<string, any[]>(weekDays.map((d) => [d, []]));
  for (const e of data.events) for (const d of eventDays(e)) byDay.get(d)?.push(e);
  // 이달의 일정: 선택한 날 목록, 오늘이면 다가오는 일정
  const mEvents = monthEvents.data?.events ?? [];
  const dayList = selected === today
    ? mEvents.filter((e) => eventDays(e).some((d) => d >= today)).sort((a, b) => +new Date(a.start) - +new Date(b.start)).slice(0, 6)
    : mEvents.filter((e) => eventDays(e).includes(selected));
  // 담당자별 현황: 본사 사람(없으면 업무가 많은 순 6명)
  const hqIds = new Set(dir.orgUnits.filter((o) => o.type === 'hq').map((o) => o.id));
  const hqPeople = dir.users.filter((u) => u.org_unit_ids?.some((id) => hqIds.has(id)));
  const zero = { open: 0, overdue: 0, due_today: 0, done_week: 0, this_week: 0 };
  const people = (hqPeople.length ? hqPeople.map((u) => ({ id: u.id, name: u.name, ...zero, ...(data.workload.find((w: any) => w.id === u.id) ?? {}) })) : data.workload.slice(0, 6)) as any[];
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hour: 'numeric', hour12: false }).format(new Date()));
  const greet = hour < 11 ? '좋은 아침입니다' : hour < 17 ? '안녕하세요' : '오늘도 수고 많으셨습니다';

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-ink-2">{fmtDate(data.today)} · {greet}, {user.name}님</p>
        <h1 className="mt-0.5 text-2xl font-bold tracking-tight">{company ? '전체 현황' : `${user.name}님의 업무 현황`}</h1>
      </div>
      {/* WORKIN_V2 홈: 오늘 할 일 · 이번 주 일정 · 이달의 일정 · 담당자별 현황 · 기한 지남/검토 대기 · 최근 활동 (모바일은 위에서부터 이 순서) */}
      <div className="grid min-w-0 gap-4 lg:grid-flow-dense lg:grid-cols-3">
        <Section title="오늘 할 일" count={todayTasks.length} href={scope === 'mine' ? '/tasks?view=my' : '/tasks?view=overdue'} icon={CheckCircle2} className="lg:col-span-2" testid="home-today"
          actions={(
            <div className="flex rounded-full border border-line p-0.5 text-xs" role="group" aria-label="오늘 할 일 범위">
              {([['mine', '내 것'], ['all', '전체']] as const).map(([k, l]) => (
                <button key={k} onClick={() => setScope(k)} aria-pressed={scope === k} className={cx('rounded-full px-2.5 py-0.5 font-medium', scope === k ? 'bg-brand-600 text-white' : 'text-ink-2 hover:bg-slate-100')}>{l}</button>
              ))}
            </div>
          )}>
          {!todayTasks.length ? <p className="flex items-center justify-center gap-1.5 px-2 py-6 text-center text-sm text-ink-3"><CheckCircle2 className="size-4" />{scope === 'mine' ? '오늘 마감이거나 지난 내 업무가 없습니다' : '오늘 마감이거나 지난 업무가 없습니다'}</p>
            : <ul>{todayTasks.slice(0, 10).map((t) => <TodayRow key={t.id} t={t} onDone={done} />)}</ul>}
          <div className="border-t border-line px-1 pt-1"><InlineAddTask muted defaultDue={data.today} onCreated={() => { mine.reload(); reload(); }} placeholder="오늘 할 일 추가 — 제목 입력 후 Enter" /></div>
        </Section>

        <Section title="이번 주 일정" count={data.events.length} href="/calendar" icon={CalendarDays} className="lg:col-span-2" testid="home-week">
          <ul className="divide-y divide-line">
            {weekDays.map((d) => {
              const list = (byDay.get(d) ?? []).sort((a, b) => +new Date(a.start) - +new Date(b.start));
              const isToday = d === today;
              if (!list.length && !isToday && d < today) return null;
              return (
                <li key={d} className={cx('flex min-w-0 gap-2 py-1.5', isToday && 'rounded-input bg-accent-50/60')} data-day={d}>
                  <span className={cx('w-12 shrink-0 px-2 pt-1.5 text-xs font-semibold tabular-nums', isToday ? 'text-accent-600' : dow(d) === 0 ? 'text-red-600' : 'text-ink-2')}>
                    {DOW[dow(d)]} {Number(d.slice(8))}{isToday && <span className="block text-[10px] font-medium">오늘</span>}
                  </span>
                  {list.length ? <ul className="min-w-0 flex-1">{list.slice(0, 4).map((e) => <EventRow key={e.id + e.start} e={e} />)}{list.length > 4 && <li className="px-2 text-xs text-ink-3">외 {list.length - 4}건</li>}</ul>
                    : <span className="flex-1 px-2 pt-1.5 text-xs text-ink-3">일정 없음</span>}
                </li>
              );
            })}
          </ul>
        </Section>

        <Section title="이달의 일정" icon={CalendarRange} className="lg:col-start-3 lg:row-span-2 lg:row-start-1" testid="home-month-card">
          <MonthCalendar month={month} setMonth={setMonth} events={mEvents} selected={selected} setSelected={setSelected} today={today} />
          <div className="mt-2 border-t border-line pt-2">
            <p className="px-2 pb-1 text-xs font-semibold text-ink-2">{selected === today ? '다가오는 일정' : `${fmtDate(selected)} 일정`}</p>
            {!dayList.length ? <p className="px-2 py-4 text-center text-sm text-ink-3">일정이 없습니다</p>
              : <ul data-testid="home-day-list">{dayList.map((e) => <EventRow key={e.id + e.start} e={e} withDate={selected === today} />)}</ul>}
          </div>
        </Section>

        <Section title="담당자별 현황" icon={Users} href="/tasks" className="lg:col-span-2 lg:row-span-2" testid="home-people">
          <div className="grid gap-2 px-1 sm:grid-cols-2 xl:grid-cols-3">
            {people.map((p) => (
              <Link key={p.id} href={`/tasks?assigneeId=${p.id}`} className="min-w-0 rounded-input border border-line p-3 hover:border-slate-300 hover:shadow-card">
                <div className="flex min-w-0 items-center gap-2"><Avatar id={p.id} name={p.name} size={28} /><span className="truncate font-semibold">{p.name}</span></div>
                <dl className="mt-2 grid grid-cols-4 gap-1 text-center">
                  {([['진행', p.open, ''], ['오늘 마감', p.due_today, p.due_today ? 'text-amber-700' : ''], ['지연', p.overdue, p.overdue ? 'text-red-600' : ''], ['주간 완료', p.done_week, 'text-emerald-600']] as const).map(([l, v, tone]) => (
                    <div key={l} className="min-w-0"><dt className="truncate text-[10px] text-ink-3">{l}</dt><dd className={cx('text-lg font-bold tabular-nums', tone)}>{v ?? 0}</dd></div>
                  ))}
                </dl>
              </Link>
            ))}
            {!people.length && <p className="px-2 py-6 text-center text-sm text-ink-3">담당자가 있는 업무가 없습니다</p>}
          </div>
        </Section>

        <Section title="기한 지남 · 검토 대기" icon={AlertTriangle} className="lg:col-start-3" testid="home-alerts">
          <div className="grid grid-cols-2 gap-2 px-1">
            <Link href="/tasks?view=overdue" className="rounded-input border border-line p-3 hover:border-red-200 hover:bg-red-50/40">
              <span className="flex items-center gap-1 text-xs text-ink-2"><AlertTriangle className="size-3.5 text-red-500" />기한 지남</span>
              <span className={cx('text-2xl font-bold tabular-nums', tot.overdue ? 'text-red-600' : 'text-ink')}>{tot.overdue}</span>
            </Link>
            <Link href="/tasks?view=review" className="rounded-input border border-line p-3 hover:border-amber-200 hover:bg-amber-50/40">
              <span className="flex items-center gap-1 text-xs text-ink-2"><Hourglass className="size-3.5 text-amber-500" />검토 대기</span>
              <span className={cx('text-2xl font-bold tabular-nums', tot.review ? 'text-amber-700' : 'text-ink')}>{tot.review}</span>
            </Link>
          </div>
          {data.canApprove && data.review.length > 0 && (
            <ul className="mt-2">
              {data.review.slice(0, 3).map((t: any) => (
                <li key={t.id} className="flex min-w-0 flex-wrap items-center gap-2 rounded-input px-2 py-1.5 text-sm hover:bg-slate-50">
                  <Link href={`/tasks/${t.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">{t.title}</Link>
                  <span className="flex gap-1"><Button size="sm" onClick={() => approve(t, true)}>완료 확인</Button><Button size="sm" variant="secondary" onClick={() => approve(t, false)}>보완 요청</Button></span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="최근 활동" icon={ActivityIcon} className="lg:col-start-3" testid="home-activity">
          {!data.activity?.length ? <p className="px-2 py-6 text-center text-sm text-ink-3">최근 활동이 없습니다</p> : (
            <ul>
              {data.activity.map((a: any, i: number) => (
                <li key={i} className="flex min-w-0 items-start gap-2 rounded-input px-2 py-1.5 text-sm">
                  <span className="mt-0.5 shrink-0">{a.kind === 'done' ? <CheckCircle2 className="size-4 text-emerald-500" /> : a.kind === 'comment' ? <MessageSquare className="size-4 text-accent-500" /> : <PlusCircle className="size-4 text-ink-3" />}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate"><b className="font-semibold">{a.actor_name ?? '시스템'}</b> {a.kind === 'done' ? '완료' : a.kind === 'comment' ? '댓글' : '등록'} · <Link href={`/tasks/${a.task_id}`} className="hover:underline">{a.title}</Link></p>
                    {a.body && <p className="truncate text-xs text-ink-2">{a.body}</p>}
                    <p className="text-[11px] text-ink-3">{fmtDateTime(a.at)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}
