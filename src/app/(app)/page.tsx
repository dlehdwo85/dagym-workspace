'use client';
import Link from 'next/link';
import { useState } from 'react';
import { AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight, CalendarDays, CheckCircle2, CircleDot, Hourglass, MapPin, Plus, Sparkles, Users } from 'lucide-react';
import { api, broadcastRefresh, useApi } from '@/components/client';
import { useSession } from '@/components/session';
import { Avatar, Button, Card, DueChip, Empty, ErrorBox, PriorityTag, STATUS_TONE, Skeleton, cx, fmtDate, fmtDateTime, toast } from '@/components/ui';
import { STATUS_LABEL, UNIT_TYPE_LABEL, type TaskStatus } from '@/lib/types';

function Section({ title, count, children, href, icon: Icon, className }: { title: string; count?: number; children: React.ReactNode; href?: string; icon?: typeof Users; className?: string }) {
  return (
    <Card className={cx('flex flex-col', className)}>
      <div className="flex items-center justify-between px-4 pb-2 pt-3.5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">{Icon && <Icon className="size-4 text-ink-3" />}{title}{count !== undefined && <span className="rounded-full bg-slate-100 px-1.5 text-xs font-medium text-ink-2 tabular-nums">{count}</span>}</h2>
        {href && <Link href={href} className="inline-flex items-center gap-0.5 text-xs font-medium text-accent-600 hover:underline">전체 보기<ArrowRight className="size-3" /></Link>}
      </div>
      <div className="flex-1 px-2 pb-2">{children}</div>
    </Card>
  );
}

function TaskRows({ items, approve, empty }: { items: any[]; approve?: (t: any, ok: boolean) => void; empty: string }) {
  if (!items.length) return <p className="flex items-center justify-center gap-1.5 px-2 py-8 text-center text-sm text-ink-3"><CheckCircle2 className="size-4" />{empty}</p>;
  return (
    <ul>
      {items.map((t) => (
        <li key={t.id} className="flex items-center gap-2.5 rounded-input px-2 py-2 text-sm hover:bg-slate-50">
          <Avatar id={t.assignee_id} name={t.assignee_name} size={26} />
          <div className="min-w-0 flex-1">
            <Link href={`/tasks/${t.id}`} className="block truncate font-medium hover:text-accent-600 hover:underline">{t.title}</Link>
            <div className="flex gap-2 text-xs text-ink-2"><span>{t.assignee_name ?? '미배정'}</span><span className="truncate">{t.org_unit_name}</span></div>
          </div>
          <PriorityTag p={t.priority} label={false} />
          {!approve && <DueChip due={t.due_date} status={t.status} />}
          {approve ? (
            <div className="flex gap-1">
              <Button size="sm" onClick={() => approve(t, true)}>완료 확인</Button>
              <Button size="sm" variant="secondary" onClick={() => approve(t, false)}>보완 요청</Button>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function Delta({ now, prev, goodUp = true, what = '' }: { now: number; prev: number; goodUp?: boolean; what?: string }) {
  const d = now - prev;
  if (d === 0) return <span className="text-xs text-ink-3">{what}지난주와 같음</span>;
  const up = d > 0;
  const good = up === goodUp;
  return (
    <span className={cx('inline-flex items-center gap-0.5 text-xs font-medium', good ? 'text-emerald-600' : 'text-red-600')}>
      {up ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}{what}지난주보다 {Math.abs(d)}건 {up ? '많음' : '적음'}
    </span>
  );
}

/** 상태 분포 도넛 (SVG) */
function Donut({ parts }: { parts: { key: TaskStatus; n: number }[] }) {
  const total = parts.reduce((a, p) => a + p.n, 0);
  const R = 42, C = 2 * Math.PI * R;
  let off = 0;
  return (
    <div className="flex items-center gap-5 px-2 py-2">
      <svg viewBox="0 0 120 120" className="size-32 shrink-0 -rotate-90" role="img" aria-label={`진행 중 업무 ${total}건 상태 분포`}>
        <circle cx="60" cy="60" r={R} fill="none" stroke="#f1f5f9" strokeWidth="16" />
        {total > 0 && parts.filter((p) => p.n).map((p) => {
          const len = (p.n / total) * C;
          const el = <circle key={p.key} cx="60" cy="60" r={R} fill="none" stroke={STATUS_TONE[p.key].bar} strokeWidth="16" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-off} />;
          off += len;
          return el;
        })}
        <text x="60" y="60" textAnchor="middle" dominantBaseline="central" className="fill-current text-[22px] font-bold" transform="rotate(90 60 60)">{total}</text>
      </svg>
      <ul className="flex-1 space-y-1.5 text-sm">
        {parts.map((p) => (
          <li key={p.key} className="flex items-center gap-2">
            <span className="size-2.5 rounded-full" style={{ background: STATUS_TONE[p.key].bar }} />
            <span className="flex-1 text-ink-2">{STATUS_LABEL[p.key]}</span>
            <span className="font-semibold tabular-nums">{p.n}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Dashboard() {
  const { user, dir } = useSession();
  const [brand, setBrand] = useState('');
  const { data, error, loading, reload } = useApi<any>(`/api/dashboard${brand ? `?brand=${brand}` : ''}`);
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (loading && !data) return <div className="space-y-4"><div className="skeleton h-8 w-60 rounded" /><div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-24 rounded-card" />)}</div><Skeleton rows={5} /></div>;
  if (!data) return null;
  const company = data.scope === 'company';
  const tot = data.totals;

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

  const avgLoad = data.workload.length ? data.workload.reduce((a: number, w: any) => a + w.open, 0) / data.workload.length : 0;
  const maxLoad = Math.max(1, ...data.workload.map((w: any) => w.open));
  const days: { day: string; done: number }[] = [];
  for (let i = 27; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const s = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
    days.push({ day: s, done: data.completion.find((c: any) => c.day === s)?.done ?? 0 });
  }
  const maxDone = Math.max(1, ...days.map((d) => d.done));
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hour: 'numeric', hour12: false }).format(new Date()));
  const greet = hour < 11 ? '좋은 아침입니다' : hour < 17 ? '안녕하세요' : '오늘도 수고 많으셨습니다';
  const empty = !tot.open && !tot.done_30d;

  const kpis = [
    { label: '진행 중 업무', value: tot.open, href: '/tasks', icon: CircleDot, tone: 'text-accent-600 bg-accent-50', sub: <Delta now={tot.created_7d} prev={tot.created_prev7d} goodUp={false} what="새 업무 " /> },
    { label: '기한 초과', value: tot.overdue, href: '/tasks?view=overdue', icon: AlertTriangle, tone: 'text-red-600 bg-red-50', sub: tot.overdue ? <span className="text-xs font-medium text-red-600">바로 확인이 필요합니다</span> : <span className="text-xs text-emerald-600">지연 없음</span> },
    { label: '검토 대기', value: tot.review, href: '/tasks?view=review', icon: Hourglass, tone: 'text-amber-600 bg-amber-50', sub: <span className="text-xs text-ink-2">완료 확인을 기다리는 업무</span> },
    { label: '최근 7일 완료', value: tot.done_7d, href: '/tasks?status=done', icon: CheckCircle2, tone: 'text-emerald-600 bg-emerald-50', sub: <Delta now={tot.done_7d} prev={tot.done_prev7d} what="완료 " /> },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-ink-2">{fmtDate(data.today)} · {greet}, {user.name}님</p>
          <h1 className="mt-0.5 text-2xl font-bold tracking-tight">{company ? '전체 현황' : `${user.name}님의 업무 현황`}</h1>
          <p className="mt-0.5 text-xs text-ink-3">{company ? '전 브랜드·전 현장' : '내가 접근할 수 있는 조직 범위'}</p>
        </div>
        <div className="flex rounded-input border border-line bg-white p-0.5 text-sm shadow-card" role="group" aria-label="브랜드 선택">
          {[{ id: '', name: '전체' }, ...dir.brands].map((b) => (
            <button key={b.id} onClick={() => setBrand(b.id)} aria-pressed={brand === b.id}
              className={cx('rounded-md px-3 py-1.5 font-medium', brand === b.id ? 'bg-brand-600 text-white' : 'text-ink-2 hover:bg-slate-100')}>{b.name}</button>
          ))}
        </div>
      </div>

      {empty && (
        <Empty title="아직 등록된 업무가 없습니다" icon={Sparkles} action={<Link href="/tasks?view=my"><Button><Plus />첫 업무 만들기</Button></Link>}>
          상단 <b>만들기</b> 또는 단축키 <b>N</b> 으로 업무를 등록하면 여기에서 현장별 진행 상황을 한눈에 볼 수 있습니다.
        </Empty>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((k) => (
          <Link key={k.label} href={k.href} className="group rounded-card border border-line bg-white p-4 shadow-card transition hover:-translate-y-0.5 hover:shadow-pop">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-ink-2">{k.label}</span>
              <span className={cx('flex size-8 items-center justify-center rounded-input', k.tone)}><k.icon className="size-4" /></span>
            </div>
            <div className="mt-2 text-[30px] font-bold leading-none tracking-tight tabular-nums">{k.value}</div>
            <div className="mt-2 min-h-4">{k.sub}</div>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Section title="오늘의 중요 업무" count={data.important.length} href="/tasks?view=today" className="lg:col-span-2"><TaskRows items={data.important} empty="오늘 급한 업무가 없습니다" /></Section>
        <Section title="진행 중 업무 상태">
          <Donut parts={[{ key: 'todo', n: tot.s_todo }, { key: 'in_progress', n: tot.s_in_progress }, { key: 'review', n: tot.review }, { key: 'on_hold', n: tot.s_on_hold }]} />
        </Section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="검토 대기 (완료 확인 필요)" count={data.review.length} href="/tasks?view=review">
          <TaskRows items={data.review.slice(0, 10)} approve={data.canApprove ? approve : undefined} empty="확인할 업무가 없습니다" />
        </Section>
        <Section title="기한 초과" count={data.overdue.length} href="/tasks?view=overdue"><TaskRows items={data.overdue.slice(0, 10)} empty="지연된 업무가 없습니다" /></Section>
      </div>

      <Section title="현장·부서별 현황" icon={MapPin}>
        {!data.bySite.length ? <p className="px-2 py-8 text-center text-sm text-ink-3">업무가 등록된 조직이 없습니다</p> : (
          <div className="grid gap-2.5 p-2 sm:grid-cols-2 xl:grid-cols-3">
            {data.bySite.map((s: any) => {
              const alert = s.overdue > 0;
              return (
                <Link key={s.id} href={`/tasks?orgUnitId=${s.id}`} className={cx('rounded-input border p-3 transition hover:shadow-card', alert ? 'border-red-200 bg-red-50/40' : 'border-line hover:border-slate-300')}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-semibold">{s.name}</span>
                    <span className="shrink-0 text-xs text-ink-3">{UNIT_TYPE_LABEL[s.type as keyof typeof UNIT_TYPE_LABEL]}</span>
                  </div>
                  <div className="mt-2 grid grid-cols-4 gap-1 text-center">
                    {[['진행', s.open, ''], ['초과', s.overdue, s.overdue ? 'text-red-600' : ''], ['검토', s.review, s.review ? 'text-amber-600' : ''], ['긴급', s.urgent, s.urgent ? 'text-red-600' : '']].map(([l, v, c]) => (
                      <div key={l as string}><div className={cx('text-lg font-bold tabular-nums', c as string)}>{v as number}</div><div className="text-[11px] text-ink-3">{l as string}</div></div>
                    ))}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="완료 추이 (최근 4주)" icon={CheckCircle2}>
          <div className="px-2 pt-2">
            <div className="relative flex h-36 items-end gap-[3px] border-b border-line" aria-label="일별 완료 건수">
              {days.map((d) => {
                const wknd = [0, 6].includes(new Date(d.day + 'T00:00:00Z').getUTCDay());
                return (
                  <div key={d.day} className="group relative flex h-full flex-1 items-end" title={`${fmtDate(d.day)}: ${d.done}건`}>
                    <div className={cx('w-full rounded-t-[3px] transition-colors', d.done ? 'bg-emerald-500 group-hover:bg-emerald-600' : wknd ? 'bg-slate-100' : 'bg-slate-200')} style={{ height: d.done ? `${Math.max(6, (d.done / maxDone) * 100)}%` : 3 }} />
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between py-1.5 text-[11px] text-ink-3 tabular-nums"><span>{fmtDate(days[0].day)}</span><span>오늘</span></div>
          </div>
          <p className="px-2 pb-1 text-right text-xs text-ink-2">합계 <b className="text-ink">{days.reduce((a, d) => a + d.done, 0)}</b>건</p>
        </Section>
        <Section title="담당자별 업무량" icon={Users}>
          {!data.workload.length ? <p className="px-2 py-8 text-center text-sm text-ink-3">배정된 업무가 없습니다</p> : (
            <ul className="space-y-2.5 p-2">{data.workload.slice(0, 10).map((w: any) => {
              const heavy = w.open > Math.max(5, avgLoad * 1.5) || w.overdue > 2;
              return (
                <li key={w.id} className="flex items-center gap-2.5 text-xs">
                  <Avatar id={w.id} name={w.name} size={26} />
                  <div className="min-w-0 flex-1">
                    <div className="flex justify-between gap-2"><Link href={`/tasks?assigneeId=${w.id}`} className="truncate text-sm font-medium hover:underline">{w.name}</Link>
                      <span className="shrink-0 text-ink-2 tabular-nums">진행 {w.open} · 이번 주 {w.this_week}{w.overdue ? <b className="text-red-600"> · 초과 {w.overdue}</b> : ''}</span></div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100"><div className={cx('h-full rounded-full', heavy ? 'bg-red-500' : 'bg-accent-500')} style={{ width: `${(w.open / maxLoad) * 100}%` }} /></div>
                  </div>
                </li>
              );
            })}</ul>
          )}
        </Section>
      </div>

      <Section title="이번 주 일정" count={data.events.length} href="/calendar" icon={CalendarDays}>
        {!data.events.length ? <p className="px-2 py-8 text-center text-sm text-ink-3">이번 주 일정이 없습니다</p> : (
          <ul className="grid gap-x-4 sm:grid-cols-2">{data.events.slice(0, 12).map((e: any) => (
            <li key={e.id + e.start} className="flex items-center gap-2.5 rounded-input px-2 py-2 text-sm hover:bg-slate-50">
              <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: e.color }} />
              <div className="min-w-0">
                <Link href={`/calendar?event=${e.id}`} className="block truncate font-medium hover:underline">{e.title}</Link>
                <span className="text-xs text-ink-2">{e.allDay ? fmtDate(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(e.start))) + ' 종일' : fmtDateTime(e.start)}</span>
              </div>
            </li>))}
          </ul>
        )}
      </Section>
    </div>
  );
}
