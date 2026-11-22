'use client';
import { dtf } from '@/lib/dtf';
import Link from 'next/link';
import { useState } from 'react';
import { CalendarPlus, Plus, SquarePen, Stamp } from 'lucide-react';
import { useApi } from '@/components/client';
import { ClockCard } from '@/components/ClockCard';
import { useSession, useTerms } from '@/components/session';
import { ErrorBox, cx, fmtDate } from '@/components/ui';
import { useCalColors, type CalColors } from '@/components/calColors';
import { SPACE_META } from '@/components/spaceMeta';
import { ABSENCE_KINDS } from '@/lib/types';
import type { EventKind } from '@/lib/terms';
import { useRowOpen } from '@/components/rowOpen';
import { showTask } from '@/components/TaskPanelHost';
import { ConnectCard } from '@/components/ConnectCard';
import { useRouter } from 'next/navigation';

/**
 * #1110(대표 11/22 시안 승인) 홈 — 한 화면 반 안에 '지금 할 일'만.
 * 머리(인사·날짜·출근 상태 + [새로 만들기][출근하기]) → 오늘 처리할 것(숫자 칸, 0이면 숨김) → 회사 현황(대표·관리자만 4칸)
 * → 이번 주 일정·업무(목록 하나, 7줄) + 오른쪽(휴대폰은 아래) 빠른 만들기·공지 2개. 숫자는 /api/home 한 번.
 */
const seoulDay = (d: Date | string) => dtf('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(d));
const fmtHM = (d: Date | string) => dtf('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(d));
const addDays = (d: string, n: number) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const dow = (d: string) => new Date(d + 'T00:00:00Z').getUTCDay();
const cleanTitle = (t: string) => t.replace(/^(\[(업무|업무 시간)\]\s*)+/, '');
const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;
/** 일정이 걸친 서울 날짜들 (종일 일정의 끝은 다음 날 0시라 하루 빼서 계산) */
function eventDays(e: any): string[] {
  const s = seoulDay(e.start);
  const end = seoulDay(new Date(new Date(e.end).getTime() - 1));
  const out: string[] = [];
  for (let d = s; d <= end && out.length < 62; d = addDays(d, 1)) out.push(d);
  return out.length ? out : [s];
}

type Summary = {
  today: string; admin: boolean;
  todo: { overdue: number; overdueOldestDays: number | null; dueToday: number; approvals: number; marketing: number | null; bids: number | null; unread: number };
  company: null | {
    sales: { dueThisWeek: number; earliestDays: number | null } | null;
    branch: { submitted: number; total: number; day: string } | null;
    check: { acting: number; waiting: number } | null;
    agreement: { earliestDays: number; soon: number } | null;
    ads: { spend: number; cap: number | null } | null;
  };
  notices: { id: string; title: string; important: boolean; read: boolean; at: string }[];
};

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
/** 숫자 칸 하나 — 누르면 걸러진 목록 */
function Cell({ k, label, value, sub, href, tone }: { k: string; label: string; value: string | number; sub?: string; href: string; tone?: 'red' | 'amber' }) {
  return (
    <Link prefetch={false} href={href} data-testid={`home-cell-${k}`}
      className="min-w-0 rounded-input border border-line bg-white px-3 py-2.5 hover:border-slate-300 hover:bg-slate-50">
      <span className="block truncate text-xs text-ink-2">{label}</span>
      <span className={cx('block text-2xl font-bold tabular-nums leading-tight', tone === 'red' ? 'text-red-600' : tone === 'amber' ? 'text-amber-700' : 'text-ink')}>{value}</span>
      {sub && <span className="block truncate text-[11px] text-ink-3">{sub}</span>}
    </Link>
  );
}

/** 이번 주 목록 한 줄 — 업무는 줄을 눌러 상세(휴대폰은 전체 시트), 일정은 캘린더 */
function ListRow({ r, colors, today }: { r: WeekItem & { day: string }; colors: CalColors; today: string }) {
  const router = useRouter();
  const rowOpen = useRowOpen(r.task?.id ?? '', (id) => showTask(id, (h) => router.push(h)));
  const isTask = !!r.task && (r.kind === 'task' || r.kind === 'overdue');
  const dayLabel = r.kind === 'overdue' ? '' : r.day === today ? '오늘' : r.day === addDays(today, 1) ? '내일' : `${Number(r.day.slice(5, 7))}/${Number(r.day.slice(8))}(${DOW[dow(r.day)]})`;
  const sm = r.space ? SPACE_META[r.space] : null;
  const dot = sm ? (colors.cals?.[`space:${r.space}`] ?? sm.color) : r.personal ? colors.personal : colors.company;
  return (
    <li {...(isTask ? rowOpen : {})} className={cx('flex min-w-0 items-center gap-2 px-2 py-2 text-sm hover:bg-slate-50', isTask && 'cursor-pointer')}
      data-day={r.day} data-week-item={r.tag} {...(r.task ? { 'data-week-task': r.task.id } : {})} {...(isTask ? { 'data-home-task': r.task.id } : {})} {...(r.space ? { 'data-week-space': r.space } : {})}>
      <span className={cx('w-[3.25rem] shrink-0 text-xs tabular-nums', r.day === today || r.kind === 'overdue' ? 'font-semibold text-ink' : 'text-ink-2')}>{dayLabel}{dayLabel && r.time ? <span className="block font-normal text-ink-2">{r.time}</span> : !dayLabel ? r.time : ''}</span>
      {isTask ? <span className="h-3.5 w-1 shrink-0 rounded-full" style={{ background: dot }} aria-hidden data-week-bar /> : <span className="size-2.5 shrink-0 rounded-full" style={{ background: dot }} aria-hidden />}
      <Link prefetch={false} href={r.href} className="min-w-0 flex-1 truncate font-medium hover:underline">{r.title}</Link>
      {sm ? <span className="shrink-0 rounded px-1.5 text-[10px] font-medium" style={{ background: sm.soft, color: sm.color }}>{sm.short}</span>
        : <span className={cx('shrink-0 rounded px-1.5 text-[10px] font-medium', r.kind === 'overdue' ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-ink-2')}>{r.tag}</span>}
    </li>
  );
}

export default function Dashboard() {
  const T = useTerms(); // 범용화 2단계: 회사별 용어(다짐은 지금 표현 그대로)
  const { user } = useSession();
  const { data, error, reload } = useApi<Summary>('/api/home');
  const { colors: calColors } = useCalColors();
  const [newMenu, setNewMenu] = useState(false);
  const [allRows, setAllRows] = useState(false);
  const d0 = seoulDay(new Date());
  const today = data?.today ?? d0;
  const myOpen = useApi<{ tasks: any[] }>('/api/tasks?view=my&limit=300');
  const agenda = useApi<{ items: { date: string; time: string | null; title: string; kind: string; space: 'sales' | 'marketing'; href: string }[] }>(`/api/spaces/agenda?from=${d0}&to=${addDays(d0, 6)}`, [d0]);
  const week7 = useApi<{ events: any[] }>(`/api/events?from=${encodeURIComponent(`${d0}T00:00:00+09:00`)}&to=${encodeURIComponent(`${addDays(d0, 7)}T00:00:00+09:00`)}`, [d0]);

  const hour = Number(dtf('en-US', { timeZone: 'Asia/Seoul', hour: 'numeric', hour12: false }).format(new Date()));
  const greet = hour < 11 ? '좋은 아침입니다' : hour < 17 ? '안녕하세요' : '오늘도 수고 많으셨습니다';

  // 이번 주 일정·업무 — 목록 하나: 기한 지남 → 오늘 → 이번 주(날짜·시각 순). 같은 날 같은 제목의 일정·업무는 한 줄, 연결된 일정·업무도 한 줄
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const open = (myOpen.data?.tasks ?? []).filter((t) => t.status !== 'done');
  const blockDone = (e: any) => e.blockTask?.status === 'done'; // 완료된 업무의 '업무 시간' 블록은 숨김(캘린더와 같은 규칙)
  const evsByDay = new Map<string, any[]>(weekDays.map((d) => [d, []]));
  for (const e of (week7.data?.events ?? []).filter((x: any) => !blockDone(x))) for (const d of eventDays(e)) evsByDay.get(d)?.push(e);
  const rows: (WeekItem & { day: string })[] = [];
  rows.push(...open.filter((t) => t.due_date && t.due_date < today).sort((a, b) => a.due_date.localeCompare(b.due_date))
    .map((t) => ({ key: `o${t.id}`, day: t.due_date, time: '', title: t.title, personal: !t.project_id, tag: `지남 ${fmtDate(t.due_date)}`, href: `/tasks/${t.id}`, task: t, kind: 'overdue' as const })));
  for (const d of weekDays) {
    const evs = evsByDay.get(d) ?? [];
    const linked = new Set(evs.flatMap((e) => [e.linkedTask?.id, ...(e.linkedTaskIds ?? [])]).filter(Boolean));
    const items: WeekItem[] = [
      ...evs.map((e) => ({ key: `e${e.id}${e.start}`, time: e.allDay || seoulDay(e.start) !== d ? '' : fmtHM(e.start), title: cleanTitle(e.title), personal: e.calendarType === 'personal',
        tag: e.linkedTask ? '일정·업무' : (ABSENCE_KINDS as readonly string[]).includes(e.kind) ? T.event[e.kind as EventKind] : '일정', href: `/calendar?date=${d}&event=${e.id}`,
        task: e.linkedTask ? { id: e.linkedTask.id, status: e.linkedTask.status } : null, kind: 'event' as const })),
      ...open.filter((t) => t.due_date === d && !linked.has(t.id)).map((t) => ({ key: `t${t.id}`, time: t.due_time ?? '', title: t.title, personal: !t.project_id, tag: '업무', href: `/tasks/${t.id}`, task: t, kind: 'task' as const })),
      ...(agenda.data?.items ?? []).filter((x) => x.date === d).map((x, i) => ({ key: `s${x.space}${i}${x.title}`, time: x.time ?? '', title: x.title, personal: false, tag: x.space, href: x.href, task: null, kind: 'space' as const, space: x.space })),
    ];
    rows.push(...mergeSameTitle(items.filter((x) => x.task?.status !== 'done')).sort((x, y) => (x.time || '00:00').localeCompare(y.time || '00:00')).map((x) => ({ ...x, day: d })));
  }
  const seen = new Set<string>(); const list = rows.filter((r) => { const k = r.task?.id ? `t${r.task.id}` : r.key; if (seen.has(k)) return false; seen.add(k); return true; });
  const shown = allRows ? list : list.slice(0, 7); // 대표 시안: 7줄 — 넘으면 [외 n건 더 보기]
  const listLoading = !myOpen.data || !week7.data;

  const td = data?.todo; const c = data?.company;
  const cells = td ? [
    td.overdue > 0 && { k: 'overdue', label: '기한 지남', value: td.overdue, sub: td.overdueOldestDays ? `최대 ${td.overdueOldestDays}일 지남` : '내 업무', href: `/tasks?view=overdue&assigneeId=${user.id}`, tone: 'red' as const },
    td.approvals > 0 && { k: 'approvals', label: '결재 대기', value: td.approvals, sub: '내 차례', href: '/approvals?view=todo', tone: 'amber' as const },
    td.dueToday > 0 && { k: 'today', label: '오늘 마감', value: td.dueToday, sub: '내 업무', href: '/tasks?view=today' },
    !!td.marketing && { k: 'marketing', label: '마케팅 승인', value: td.marketing, sub: '승인할 시안', href: '/s/marketing/approvals' },
    !!td.bids && { k: 'bids', label: '새 입찰 공고', value: td.bids, sub: '오늘 아침 메일', href: '/s/sales/hub?tab=bids&bt=today' },
    td.unread > 0 && { k: 'unread', label: '안 읽은 메시지', value: td.unread, sub: '메시지', href: '/messages' },
  ].filter(Boolean) as Parameters<typeof Cell>[0][] : [];
  const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;
  const companyCells = c ? [
    c.sales && { k: 'sales', label: '영업 · 이번 주 입찰 마감', value: `${c.sales.dueThisWeek}건`, sub: c.sales.earliestDays !== null ? `가장 빠른 마감 D-${c.sales.earliestDays}` : '이번 주 마감 없음', href: '/s/sales/hub?tab=bids' },
    c.branch && { k: 'branch', label: '지점 보고 · 이번 주 제출', value: `${c.branch.submitted}/${c.branch.total}`, sub: c.branch.total > c.branch.submitted ? `미제출 ${c.branch.total - c.branch.submitted}곳 · ${md(c.branch.day)}(금) 마감` : `모두 제출 · ${md(c.branch.day)}(금)`, href: '/branch-reports', tone: c.branch.total > c.branch.submitted ? 'amber' as const : undefined },
    (c.check || c.agreement) && { k: 'check', label: '점검 · 계약', value: c.check ? `조치 중 ${c.check.acting}` : c.agreement ? `D-${c.agreement.earliestDays}` : '-', sub: c.agreement ? `계약 만료 가장 빠른 D-${c.agreement.earliestDays}` : '만료 예정 계약 없음', href: c.check ? '/check' : '/agreements' },
    c.ads && { k: 'ads', label: '이번 달 광고비(메타+네이버)', value: won(c.ads.spend), sub: c.ads.cap ? `월 상한 ${won(c.ads.cap)}` : '월 상한 없음', href: '/s/marketing/ad-ops', tone: c.ads.cap && c.ads.spend > c.ads.cap * 0.9 ? 'amber' as const : undefined },
  ].filter(Boolean) as Parameters<typeof Cell>[0][] : [];

  if (error) return <ErrorBox error={error} retry={reload} />;
  return (
    <div className="space-y-4" data-testid="home">
      {/* 1) 머리: 인사·날짜·출근 상태 + [새로 만들기][출근하기] */}
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-ink-2">{fmtDate(today)}</p>
          <h1 className="mt-0.5 text-xl font-bold tracking-tight sm:text-2xl">{greet}, {user.name}님</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ClockCard inline />
          <div className="relative hidden sm:block">
            <button type="button" onClick={() => setNewMenu((v) => !v)} aria-haspopup="menu" aria-expanded={newMenu} data-testid="home-new"
              className="inline-flex h-8 items-center gap-1 rounded-input border border-line bg-white px-3 text-sm font-medium hover:bg-slate-50"><Plus className="size-4" />새로 만들기</button>
            {newMenu && <>
              <div className="fixed inset-0 z-40" onClick={() => setNewMenu(false)} />
              <div role="menu" className="absolute right-0 z-50 mt-1 w-44 rounded-input border border-line bg-white p-1 shadow-pop">
                {QUICK.map((q) => <Link key={q.key} role="menuitem" prefetch={false} href={q.href(today)} className="flex items-center gap-2 rounded px-2.5 py-2 text-sm hover:bg-slate-50"><q.icon className="size-4 text-ink-2" />{q.label}</Link>)}
              </div>
            </>}
          </div>
        </div>
      </div>
      <ConnectCard />

      {/* 2) 오늘 처리할 것 — 모든 직원, 0인 칸은 숨김 */}
      <section data-testid="home-todo">
        <h2 className="mb-1.5 text-sm font-semibold">오늘 처리할 것</h2>
        {!data ? <div className="grid grid-cols-3 gap-2 lg:grid-cols-6">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-[74px] rounded-input" />)}</div>
          : cells.length ? <div className="grid grid-cols-3 gap-2 lg:grid-cols-6">{cells.map((x) => <Cell key={x.k} {...x} />)}</div>
          : <p className="rounded-input border border-line bg-white px-3 py-2.5 text-sm text-ink-2" data-testid="home-todo-empty">지금 처리할 것이 없습니다.</p>}
      </section>

      {/* 3) 회사 현황 — 대표·관리자만 */}
      {companyCells.length > 0 && (
        <section data-testid="home-company">
          <h2 className="mb-1.5 text-sm font-semibold">회사 현황</h2>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">{companyCells.map((x) => <Cell key={x.k} {...x} />)}</div>
        </section>
      )}

      <div className="grid min-w-0 gap-4 lg:grid-cols-3">
        {/* 4) 이번 주 일정·업무 — 목록 하나, 7줄 */}
        <section className="min-w-0 rounded-card border border-line bg-white lg:col-span-2" data-testid="home-week">
          <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
            <h2 className="text-sm font-semibold">이번 주 일정·업무</h2>
            {!listLoading && <span className="text-xs text-ink-3 tabular-nums">{list.length}건</span>}
            <Link prefetch={false} href="/calendar" className="ml-auto text-xs text-ink-2 hover:underline">캘린더</Link>
          </div>
          {listLoading ? <div className="space-y-2 p-3">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-6 rounded" />)}</div>
            : shown.length ? <ul className="divide-y divide-line">{shown.map((r) => <ListRow key={r.key} r={r} colors={calColors} today={today} />)}</ul>
            : <p className="px-3 py-6 text-center text-sm text-ink-3">이번 주 일정·업무가 없습니다.</p>}
          <div className="flex items-center gap-3 border-t border-line px-3 py-2 text-sm">
            {list.length > shown.length && <button type="button" onClick={() => setAllRows(true)} className="text-xs text-ink-2 hover:underline" data-testid="home-week-more">외 {list.length - shown.length}건 더 보기</button>}
            <Link prefetch={false} href="/tasks?view=my" className="ml-auto font-medium text-accent-600 hover:underline" data-testid="home-all-tasks">전체 업무 보기</Link>
          </div>
        </section>

        {/* 5) 오른쪽(휴대폰은 아래): 빠른 만들기 · 공지 */}
        <div className="min-w-0 space-y-4">
          <section className="rounded-card border border-line bg-white p-3" data-testid="home-quick">
            <h2 className="mb-2 text-sm font-semibold">빠른 만들기</h2>
            <div className="grid grid-cols-3 gap-2">
              {QUICK.map((q) => <Link key={q.label} prefetch={false} href={q.href(today)} data-testid={`home-quick-${q.key}`}
                className="flex flex-col items-center gap-1 rounded-input border border-line px-2 py-2.5 text-xs font-medium hover:bg-slate-50"><q.icon className="size-5 text-ink-2" />{q.label}</Link>)}
            </div>
          </section>
          <section className="rounded-card border border-line bg-white p-3" data-testid="home-notices">
            <div className="mb-1 flex items-center gap-2"><h2 className="text-sm font-semibold">공지</h2><Link prefetch={false} href="/notices" className="ml-auto text-xs text-ink-2 hover:underline">전체</Link></div>
            {!data ? <div className="skeleton h-10 rounded" /> : data.notices.length ? (
              <ul className="divide-y divide-line text-sm">{data.notices.map((n) => (
                <li key={n.id}><Link prefetch={false} href={`/notices/${n.id}`} className="flex items-center gap-1.5 py-1.5 hover:underline">
                  {n.important && <span className="shrink-0 rounded bg-red-50 px-1.5 text-[11px] font-semibold text-red-700">중요</span>}
                  <span className={cx('min-w-0 flex-1 truncate', !n.read && 'font-semibold')}>{n.title}</span>
                  {!n.read && <span className="shrink-0 text-[11px] text-accent-600">새 공지</span>}</Link></li>))}</ul>
            ) : <p className="py-1.5 text-sm text-ink-3">공지가 없습니다.</p>}
          </section>
        </div>
      </div>
    </div>
  );
}

/** 빠른 만들기(머리 [새로 만들기]와 같은 세 가지) */
const QUICK = [
  { key: 'task', label: '업무', icon: SquarePen, href: () => '/tasks?new=1' },
  { key: 'event', label: '일정', icon: CalendarPlus, href: (d: string) => `/calendar?quick=1&date=${d}` },
  { key: 'approval', label: '결재 올리기', icon: Stamp, href: () => '/approvals?view=mine' },
] as const;
