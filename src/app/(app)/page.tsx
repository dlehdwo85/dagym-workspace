'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, CalendarDays, CalendarPlus, CalendarRange, Check, CheckCircle2, ChevronLeft, ChevronRight, CircleCheck, Hourglass, MapPin, MessageSquare, PlusCircle, Sparkles, Users, Activity as ActivityIcon } from 'lucide-react';
import { api, broadcastRefresh, useApi } from '@/components/client';
import { useSession } from '@/components/session';
import { Avatar, Button, Card, DueChip, ErrorBox, PriorityTag, Skeleton, cx, fmtDate, fmtDateTime, fmtTime, toast } from '@/components/ui';
import { InlineAddTask } from '@/components/TaskQuick';
import { useCalColors, type CalColors } from '@/components/calColors';
import { SPACE_META } from '@/components/spaceMeta';
import { ABSENCE_KINDS, EVENT_KIND_LABEL } from '@/lib/types';
import { useRowOpen } from '@/components/rowOpen';
import { ConnectCard } from '@/components/ConnectCard';
import { HomeMonth } from '@/components/HomeMonth';
import { useRouter } from 'next/navigation';

const seoulDay = (d: Date | string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(d));
const fmtHM = (d: Date | string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(d));
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

/** 오늘의 일정 한 줄 — 줄을 누르면 상세. 대표(10/16): 왼쪽 완료 동그라미 없앰(업무 목록 V14 43·이번 주 V14 37 과 같게, 완료는 업무 안에서) */
function TodayRow({ t, className }: { t: any; className?: string }) {
  const router = useRouter();
  const rowOpen = useRowOpen(t.id, (id) => router.push(`/tasks/${id}`)); // 줄 아무 곳이나 눌러 상세
  return (
    <li {...rowOpen} className={cx(className, "flex min-w-0 cursor-pointer items-center gap-2.5 rounded-input px-2 py-1.5 text-sm hover:bg-slate-50")} data-home-task={t.id}>
      <div className="min-w-0 flex-1">
        <Link href={`/tasks/${t.id}`} className="block truncate font-medium hover:text-accent-600 hover:underline">{t.title}</Link>
        <div className="truncate text-xs text-ink-2">{t.assignee_name ?? '담당자 없음'}{t.org_unit_name ? ` · ${t.org_unit_name}` : ''}</div>
      </div>
      <PriorityTag p={t.priority} label={false} />
      <DueChip due={t.due_date} status={t.status} />
    </li>
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

type WeekItem = { key: string; time: string; title: string; personal: boolean; tag: string; href: string; task: any | null; kind?: 'event' | 'task' | 'space' | 'overdue'; space?: 'sales' | 'marketing' };
/** V14 47: 같은 날·같은 제목의 일정과 업무(연결 안 된 것 포함)는 한 줄로 — 시각은 일정 기준, 꼬리표 "업무 n · 일정 m" */
function mergeSameTitle(items: WeekItem[]): WeekItem[] {
  const norm = (t: string) => t.replace(/\s+/g, ' ').trim().toLowerCase();
  const groups = new Map<string, WeekItem[]>();
  for (const it of items) { const k = norm(it.title); groups.set(k, [...(groups.get(k) ?? []), it]); }
  const out: WeekItem[] = [];
  for (const g of groups.values()) {
    const evs = g.filter((x) => x.kind === 'event'); const tks = g.filter((x) => x.kind === 'task');
    if (g.length === 1 || !evs.length || !tks.length) { out.push(...g); continue; }
    const base = evs[0];
    const linkedTasks = evs.filter((e) => e.task).length;
    out.push({ ...base, key: base.key + ':m', tag: `업무 ${tks.length + linkedTasks} · 일정 ${evs.length}`, task: base.task ?? (tks.length === 1 ? tks[0].task : null) });
  }
  return out;
}
/** 이번 주 한 줄: [시간/종일] [색 점·업무는 색 막대] 제목 [꼬리표] */
function WeekRow({ r, colors, onDone }: { r: WeekItem; colors: CalColors; onDone: (t: any) => void }) {
  const done = r.task?.status === 'done';
  // 대표 확정(10/19): 영업·마케팅 주요 일정은 공간 색 점 + 공간 칩(캘린더 '영업'·'마케팅' 색과 같게)
  if (r.space) { const sm = SPACE_META[r.space]; const c = colors.cals?.[`space:${r.space}`] ?? sm.color; return (
    <li className="flex min-w-0 items-center gap-2 rounded-input px-2 py-1.5 text-sm hover:bg-slate-50" data-week-item={r.tag} data-week-space={r.space}>
      <span className="w-10 shrink-0 text-xs tabular-nums text-ink-2">{r.time || '종일'}</span>
      <span className="size-2.5 shrink-0 rounded-full" style={{ background: c }} aria-hidden />
      <Link href={r.href} className="min-w-0 flex-1 truncate font-medium hover:underline">{r.title}</Link>
      <span className="shrink-0 rounded-full px-1.5 text-[10px] font-medium" style={{ background: sm.soft, color: sm.color }}>{sm.short}</span>
    </li>); }
  return (
    <li className="flex min-w-0 items-center gap-2 rounded-input px-2 py-1.5 text-sm hover:bg-slate-50" data-week-item={r.tag} {...(r.task ? { 'data-week-task': r.task.id } : {})}>
      <span className="w-10 shrink-0 text-xs tabular-nums text-ink-2">{r.time || '종일'}</span>
      {/* V14 37번: 업무 동그라미 제거 — 업무는 색 막대, 일정은 색 점 (제목을 누르면 상세) */}
      {r.task && r.tag !== '일정·업무'
        ? <span className="h-3.5 w-1 shrink-0 rounded-full" style={{ background: r.personal ? colors.personal : colors.company }} aria-hidden data-week-bar />
        : <span className="size-2.5 shrink-0 rounded-full" style={{ background: r.personal ? colors.personal : colors.company }} aria-hidden />}
      <Link href={r.href} className={cx('min-w-0 flex-1 truncate font-medium hover:underline', done && 'text-ink-3 line-through')}>{r.title}</Link>
      <span className={cx('shrink-0 rounded-full px-1.5 text-[10px] font-medium', r.kind === 'overdue' ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-ink-2')}>{r.tag}</span>
    </li>
  );
}

export default function Dashboard() {
  const { user, dir, features } = useSession();
  const { data, error, loading, reload } = useApi<any>('/api/dashboard');
  const [aiQ, setAiQ] = useState('');
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const router = useRouter();
  const { colors: calColors } = useCalColors();
  const mine = useApi<{ tasks: any[] }>('/api/tasks?view=today&limit=50');
  const myTeams = useApi<{ teams: { id: string; name: string; color: string }[]; tasks: any[] }>('/api/teams/today'); // V14 8번 우리 팀
  // 내 미완료 업무 전체: 이번 주 마감(요일별 표시)·마감 없는 새 업무(48시간)
  const myOpen = useApi<{ tasks: any[] }>('/api/tasks?view=my&limit=300');
  const today = data?.today ?? seoulDay(new Date());
  // 대표 확정(10/19): 홈은 '이번 주 일정' 하나(오늘 칸 강조·업무 포함) — '오늘'·'이달' 칸 없앰
  // V7: "이번 주 일정" = 오늘부터 7일
  const d0 = seoulDay(new Date());
  const hol = useApi<{ holidays: { date: string; name: string }[] }>('/api/holidays');
  // 영업·마케팅 주요 일정(공간에 들어갈 수 있을 때만, 하나하나가 아니라 묶음)
  const agenda = useApi<{ items: { date: string; time: string | null; title: string; kind: string; space: 'sales' | 'marketing'; href: string }[] }>(`/api/spaces/agenda?from=${d0}&to=${addDays(d0, 6)}`, [d0]);
  const week7 = useApi<{ events: any[] }>(`/api/events?from=${encodeURIComponent(`${d0}T00:00:00+09:00`)}&to=${encodeURIComponent(`${addDays(d0, 7)}T00:00:00+09:00`)}`, [d0]);

  if (error) return <ErrorBox error={error} retry={reload} />;
  if (loading && !data) return <div className="space-y-4"><div className="skeleton h-8 w-60 rounded" /><div className="grid gap-3 lg:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-48 rounded-card" />)}</div><Skeleton rows={5} /></div>;
  if (!data) return null;
  const company = data.scope === 'company';
  const tot = data.totals;
  // V7 순서: 기한 지남 → 오늘 마감(시각순, 시각 없는 것 뒤) → 오늘 시작
  const rank = (t: any) => (t.due_date && t.due_date < today ? 0 : t.due_date === today ? 1 : 2);
  const todayTasks: any[] = [...(scope === 'mine' ? mine.data?.tasks ?? [] : data.todayAll ?? [])]
    .sort((a, b) => rank(a) - rank(b) || (a.due_date ?? '').localeCompare(b.due_date ?? '') || (a.due_time ?? '99').localeCompare(b.due_time ?? '99'));

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
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const byDay = new Map<string, any[]>(weekDays.map((d) => [d, []]));
  // 대표 지시(2026-10-15): 완료된 업무의 "업무 시간" 블록은 홈에도 안 보이게(캘린더 "완료 보기" 꺼짐과 같은 규칙)
  const blockDone = (e: any) => e.blockTask?.status === 'done';
  for (const e of (week7.data?.events ?? data.events).filter((x: any) => !blockDone(x))) for (const d of eventDays(e)) byDay.get(d)?.push(e);
  // 7일 안에 마감인 내 업무도 그날에 (등록 즉시 보이게) — 시각 있는 마감은 일정과 섞어 시간순
  const weekTasks = (myOpen.data?.tasks ?? []).filter((t) => t.due_date && t.due_date >= today && t.due_date <= weekDays[6]);
  const tasksByDay = new Map<string, any[]>(weekDays.map((d) => [d, weekTasks.filter((t) => t.due_date === d)]));
  // V7 5번: 일정과 업무를 같은 한 줄로 — 시간순(종일·시간 없는 마감이 맨 위), "업무에도 추가"로 연결된 일정·업무는 한 줄로 합침
  const weekRows = new Map<string, WeekItem[]>(weekDays.map((d) => {
    const evs = byDay.get(d) ?? [];
    const linked = new Set(evs.flatMap((e) => [e.linkedTask?.id, ...(e.linkedTaskIds ?? [])]).filter(Boolean));
    const items: WeekItem[] = [
      ...evs.map((e) => ({ key: `e${e.id}${e.start}`, time: e.allDay || seoulDay(e.start) !== d ? '' : fmtHM(e.start), title: cleanTitle(e.title), personal: e.calendarType === 'personal',
        tag: e.linkedTask ? '일정·업무' : (ABSENCE_KINDS as readonly string[]).includes(e.kind) ? EVENT_KIND_LABEL[e.kind as keyof typeof EVENT_KIND_LABEL] : '일정', href: `/calendar?date=${d}&event=${e.id}`, task: e.linkedTask ? { id: e.linkedTask.id, status: e.linkedTask.status } : null, kind: e.kind === 'task_block' ? undefined : ('event' as const) })),
      ...(tasksByDay.get(d) ?? []).filter((t) => !linked.has(t.id)).map((t) => ({ key: `t${t.id}`, time: t.due_time ?? '', title: t.title, personal: !t.project_id,
        tag: '업무', href: `/tasks/${t.id}`, task: t, kind: 'task' as const })),
      ...(agenda.data?.items ?? []).filter((x) => x.date === d).map((x, i) => ({ key: `s${x.space}${i}${x.title}`, time: x.time ?? '', title: x.title, personal: false, tag: x.space, href: x.href, task: null, kind: 'space' as const, space: x.space })),
    ];
    // V14 20번(대표 결정): 완료된 업무·일정은 이번 주 목록에서 숨김
    return [d, mergeSameTitle(items.filter((x) => x.task?.status !== 'done')).sort((x, y) => (x.time || '00:00').localeCompare(y.time || '00:00'))] as [string, WeekItem[]];
  }));
  // 오늘 칸 맨 위: 기한 지난 내 업무(예전 '오늘의 일정'에 있던 것) — 빨간 '지남' 꼬리표
  const overdue: WeekItem[] = todayTasks.filter((t) => t.due_date && t.due_date < today && t.status !== 'done')
    .map((t) => ({ key: `o${t.id}`, time: '', title: t.title, personal: !t.project_id, tag: `지남 ${fmtDate(t.due_date)}`, href: `/tasks/${t.id}`, task: t, kind: 'overdue' as const }));
  weekRows.set(today, [...overdue, ...(weekRows.get(today) ?? [])]);
  const holName = (d: string) => hol.data?.holidays.find((h) => h.date === d)?.name ?? null;
  const weekCount = [...weekRows.values()].reduce((n, x) => n + x.length, 0);
  const freshNoDue = (myOpen.data?.tasks ?? []).filter((t) => !t.due_date && Date.now() - new Date(t.assigned_at ?? t.created_at).getTime() < 48 * 3600000);
  // 담당자별 현황: 본사 사람(없으면 업무가 많은 순 6명)
  const hqIds = new Set(dir.orgUnits.filter((o) => o.type === 'hq').map((o) => o.id));
  const hqPeople = dir.users.filter((u) => u.org_unit_ids?.some((id) => hqIds.has(id)));
  const zero = { open: 0, overdue: 0, due_today: 0, done_week: 0, this_week: 0 };
  const people = (hqPeople.length ? hqPeople.map((u) => ({ id: u.id, name: u.name, ...zero, ...(data.workload.find((w: any) => w.id === u.id) ?? {}) })) : data.workload.slice(0, 6)) as any[];
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hour: 'numeric', hour12: false }).format(new Date()));
  const greet = hour < 11 ? '좋은 아침입니다' : hour < 17 ? '안녕하세요' : '오늘도 수고 많으셨습니다';

  return (
    <div className="space-y-3 sm:space-y-5">
      <div>
        <p className="text-sm text-ink-2">{fmtDate(data.today)} · {greet}, {user.name}님</p>
        <h1 className="mt-0.5 text-xl font-bold tracking-tight sm:text-2xl">{company ? '전체 현황' : `${user.name}님의 업무 현황`}</h1>
      </div>
      <ConnectCard />
      {tot.overdue > 0 && (
        <Link href="/tasks?view=overdue" className="flex items-center gap-2 rounded-card border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-100" data-testid="overdue-banner">
          <AlertTriangle className="size-5 shrink-0" />기한 지난 업무 {tot.overdue}건<span className="ml-auto inline-flex items-center gap-0.5 text-xs font-medium">확인하기<ArrowRight className="size-3.5" /></span>
        </Link>
      )}
      {features.ai && (
        <form onSubmit={(e) => { e.preventDefault(); if (aiQ.trim()) router.push(`/assistant?q=${encodeURIComponent(aiQ.trim())}`); }} className="flex items-center gap-2 rounded-card border border-line bg-white px-3 py-2 shadow-card" data-testid="home-ai">
          <Sparkles className="size-5 shrink-0 text-amber-500" />
          <input value={aiQ} onChange={(e) => setAiQ(e.target.value)} placeholder="✨ AI에게 요청" title="예: 로고 찾아줘, 이번 주 내 마감 정리" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-3" aria-label="AI에게 요청" />
          <button type="submit" className="shrink-0 rounded-input bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50" disabled={!aiQ.trim()}>요청</button>
        </form>
      )}
      {/* V14 8번: 우리 팀 오늘의 일정 (팀에 속해 있을 때만) */}
      {(myTeams.data?.teams.length ?? 0) > 0 && (
        <section className="rounded-card border border-line bg-white p-3 shadow-card" data-testid="home-team">
          <div className="mb-2 flex flex-wrap items-center gap-2"><h2 className="text-sm font-semibold">우리 팀 오늘의 일정</h2>
            {myTeams.data!.teams.map((t) => <Link key={t.id} href={`/teams/${t.id}`} className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-xs hover:bg-slate-50"><span className="size-2 rounded-full" style={{ background: t.color }} />{t.name} 보드</Link>)}</div>
          <ul className="divide-y divide-line text-sm">
            {myTeams.data!.tasks.slice(0, 8).map((t) => (
              <li key={t.id} className="flex items-center gap-2 py-1.5">
                <span className="size-2 shrink-0 rounded-full" style={{ background: t.team_color ?? '#0F766E' }} />
                <Link href={`/tasks/${t.id}`} className="min-w-0 flex-1 truncate hover:underline">{t.title}</Link>
                <span className="shrink-0 text-xs text-ink-3">{t.assignee_name ?? '담당 미정'}</span><DueChip due={t.due_date} status={t.status} />
              </li>
            ))}
            {!myTeams.data!.tasks.length && <li className="py-2 text-xs text-ink-3">오늘 할 팀 업무가 없습니다</li>}
          </ul>
        </section>
      )}
      {/* WORKIN_V2 홈: 오늘의 일정 · 이번 주 일정 · 이달의 일정 · 담당자별 현황 · 기한 지남/검토 대기 · 최근 활동 (모바일은 위에서부터 이 순서) */}
      <div className="grid min-w-0 gap-4 lg:grid-flow-dense lg:grid-cols-3">
        <Section title="이번 주 일정" count={weekCount} href="/calendar" icon={CalendarDays} className="lg:col-span-2" testid="home-week">
          <ul className="divide-y divide-line">
            {weekDays.map((d) => {
              const rows = weekRows.get(d) ?? [];
              const isToday = d === today;
              return (
                // 날짜 줄의 빈 곳을 누르면 그 날짜로 일정 빠른 등록 (홈에 따로 만들기 버튼 없이 — V6 1번)
                <li key={d} className={cx('flex min-w-0 cursor-pointer gap-2 py-1.5 hover:bg-slate-50/70', isToday && 'rounded-input bg-accent-50/60')} data-day={d}
                  onClick={(ev) => { if ((ev.target as HTMLElement).closest('a,button')) return; router.push(`/calendar?quick=1&date=${d}`); }}>
                  <span className={cx('w-12 shrink-0 px-2 pt-1.5 text-xs font-semibold tabular-nums', isToday ? 'text-accent-600' : dow(d) === 0 || holName(d) ? 'text-red-600' : 'text-ink-2')}>
                    {DOW[dow(d)]} {Number(d.slice(8))}{isToday && <span className="block text-[10px] font-medium">오늘</span>}
                    {holName(d) && <span className="block truncate text-[10px] font-medium text-red-600" data-holiday={d}>{holName(d)}</span>}
                  </span>
                  {rows.length ? <ul className="min-w-0 flex-1">{rows.map((r) => <WeekRow key={r.key} r={r} colors={calColors} onDone={done} />)}</ul>
                    : <span className="flex-1 px-2 pt-1.5 text-xs text-ink-3">일정 없음 — 눌러서 추가</span>}
                </li>
              );
            })}
          </ul>
          <div className="border-t border-line px-1 pt-1"><InlineAddTask muted defaultDue={data.today} onCreated={() => { mine.reload(); myOpen.reload(); reload(); }} placeholder="할 일 추가" /></div>
        </Section>
        {/* 로컬 10/19(대표 확정): 최근 활동 → 알림 '활동' 탭, 그 자리에 월 미니 캘린더(PC 오른쪽 위, 휴대폰은 이번 주 다음 접힌 줄) */}
        <HomeMonth today={today} className="lg:col-start-3 lg:row-start-1" />

        {scope === 'mine' && freshNoDue.length > 0 && (
          <Section title="새로 받은 업무 (48시간, 마감 없음)" count={freshNoDue.length} icon={CheckCircle2} className="lg:col-span-2" testid="home-fresh">
            <ul>{freshNoDue.slice(0, 5).map((t) => <TodayRow key={t.id} t={t} />)}</ul>
          </Section>
        )}
        <Section title="담당자별 현황" icon={Users} href="/tasks" className="lg:col-span-2 lg:row-span-2" testid="home-people">
          <div className="grid gap-2 px-1 sm:grid-cols-2 xl:grid-cols-3">
            {people.map((p) => (
              <Link key={p.id} href={`/tasks?assigneeId=${p.id}`} className="min-w-0 rounded-input border border-line p-3 hover:border-slate-300 hover:shadow-card">
                <div className="flex min-w-0 items-center gap-2"><Avatar id={p.id} name={p.name} size={28} /><span className="truncate font-semibold">{p.name}</span></div>
                <dl className="mt-2 grid grid-cols-4 gap-1 text-center">
                  {([['진행', p.open, ''], ['오늘 마감', p.due_today, p.due_today ? 'text-amber-700' : ''], ['지연', p.overdue, p.overdue ? 'text-red-600' : ''], ['주간 완료', p.done_week, 'text-green-600']] as const).map(([l, v, tone]) => (
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
                  {/* V12 11번: 검토 승인·반려는 그 업무의 지시자만 */}
                  {t.requested_by === user.id ? <span className="flex gap-1"><Button size="sm" onClick={() => approve(t, true)}>완료 확인</Button><Button size="sm" variant="secondary" onClick={() => approve(t, false)}>보완 요청</Button></span>
                    : <span className="text-xs text-ink-3">지시자 확인 대기{t.requested_by_name ? ` · ${t.requested_by_name}` : ''}</span>}
                </li>
              ))}
            </ul>
          )}
        </Section>

      </div>
    </div>
  );
}
