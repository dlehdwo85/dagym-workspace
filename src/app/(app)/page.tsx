'use client';
import Link from 'next/link';
import { useState } from 'react';
import { api, broadcastRefresh, useApi } from '@/components/client';
import { useSession } from '@/components/session';
import { Button, Empty, ErrorBox, Loading, PriorityTag, StatusBadge, cx, dueClass, fmtDate, fmtDateTime, toast } from '@/components/ui';
import { UNIT_TYPE_LABEL } from '@/lib/types';

function Section({ title, count, children, href }: { title: string; count?: number; children: React.ReactNode; href?: string }) {
  return (
    <section className="rounded-lg border bg-white">
      <div className="flex items-center justify-between border-b px-4 py-2.5">
        <h2 className="text-sm font-semibold">{title}{count !== undefined && <span className="ml-1.5 text-slate-400">{count}</span>}</h2>
        {href && <Link href={href} className="text-xs text-brand-600 hover:underline">전체 보기</Link>}
      </div>
      <div className="p-2">{children}</div>
    </section>
  );
}

function TaskRows({ items, approve }: { items: any[]; approve?: (t: any, ok: boolean) => void }) {
  if (!items.length) return <p className="px-2 py-4 text-center text-xs text-slate-400">없음</p>;
  return (
    <ul className="divide-y">
      {items.map((t) => (
        <li key={t.id} className="flex items-center gap-2 px-2 py-2 text-sm">
          <div className="min-w-0 flex-1">
            <Link href={`/tasks/${t.id}`} className="block truncate font-medium hover:underline">{t.title}</Link>
            <div className="flex gap-2 text-xs text-slate-500">
              <span>{t.assignee_name ?? '미배정'}</span><span>{t.org_unit_name}</span>
              {t.due_date && <span className={dueClass(t.due_date, t.status)}>마감 {fmtDate(t.due_date)}</span>}
            </div>
          </div>
          <PriorityTag p={t.priority} />
          {approve ? (
            <div className="flex gap-1">
              <Button size="sm" onClick={() => approve(t, true)}>완료 확인</Button>
              <Button size="sm" variant="secondary" onClick={() => approve(t, false)}>보완 요청</Button>
            </div>
          ) : <StatusBadge status={t.status} />}
        </li>
      ))}
    </ul>
  );
}

export default function Dashboard() {
  const { user, dir } = useSession();
  const [brand, setBrand] = useState('');
  const { data, error, loading, reload } = useApi<any>(`/api/dashboard${brand ? `?brand=${brand}` : ''}`);
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;
  const company = data.scope === 'company';

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

  const maxLoad = Math.max(1, ...data.workload.map((w: any) => w.open));
  const days: { day: string; done: number }[] = [];
  for (let i = 27; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const s = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
    days.push({ day: s, done: data.completion.find((c: any) => c.day === s)?.done ?? 0 });
  }
  const maxDone = Math.max(1, ...days.map((d) => d.done));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold">{company ? '전체 현황' : `${user.name}님의 업무 현황`}</h1>
          <p className="text-xs text-slate-500">{fmtDate(data.today)} · {company ? '전 브랜드·전 현장' : '내가 접근할 수 있는 조직 범위'}</p>
        </div>
        <select className="rounded-md border px-2 py-1 text-sm" value={brand} onChange={(e) => setBrand(e.target.value)} aria-label="브랜드 선택">
          <option value="">전체 브랜드</option>{dir.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[['진행 중 업무', data.totals.open, '/tasks', ''], ['기한 초과', data.totals.overdue, '/tasks?view=overdue', 'text-red-600'],
          ['검토 대기', data.totals.review, '/tasks?view=review', 'text-amber-600'], ['최근 30일 완료', data.totals.done_30d, '/tasks?status=done', 'text-emerald-700']].map(([l, v, h, c]) => (
          <Link key={l as string} href={h as string} className="rounded-lg border bg-white p-3 hover:border-brand-500">
            <div className="text-xs text-slate-500">{l}</div>
            <div className={cx('mt-1 text-2xl font-bold', c as string)}>{v as number}</div>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="오늘의 중요 업무" count={data.important.length} href="/tasks?view=today"><TaskRows items={data.important} /></Section>
        <Section title="기한 초과" count={data.overdue.length} href="/tasks?view=overdue"><TaskRows items={data.overdue.slice(0, 10)} /></Section>
        <Section title="검토 대기 (완료 확인 필요)" count={data.review.length} href="/tasks?view=review">
          <TaskRows items={data.review.slice(0, 10)} approve={data.canApprove ? approve : undefined} />
        </Section>
        <Section title="이번 주 일정" count={data.events.length} href="/calendar">
          {!data.events.length ? <p className="px-2 py-4 text-center text-xs text-slate-400">이번 주 일정이 없습니다</p> : (
            <ul className="divide-y">{data.events.slice(0, 12).map((e: any) => (
              <li key={e.id + e.start} className="flex items-center gap-2 px-2 py-1.5 text-sm">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: e.color }} />
                <span className="w-32 shrink-0 text-xs text-slate-500">{e.allDay ? fmtDate(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(e.start))) + ' 종일' : fmtDateTime(e.start)}</span>
                <Link href={`/calendar?event=${e.id}`} className="truncate hover:underline">{e.title}</Link>
              </li>))}
            </ul>
          )}
        </Section>
      </div>

      <Section title="현장·부서별 이슈">
        {!data.bySite.length ? <Empty title="업무가 등록된 조직이 없습니다" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-slate-500"><th className="p-2">조직</th><th className="p-2 text-right">진행</th><th className="p-2 text-right">기한 초과</th><th className="p-2 text-right">검토 대기</th><th className="p-2 text-right">보류</th><th className="p-2 text-right">긴급</th></tr></thead>
              <tbody className="divide-y">{data.bySite.map((s: any) => (
                <tr key={s.id}>
                  <td className="p-2"><Link className="hover:underline" href={`/tasks?orgUnitId=${s.id}`}>{s.name}</Link> <span className="text-xs text-slate-400">{UNIT_TYPE_LABEL[s.type as keyof typeof UNIT_TYPE_LABEL]}</span></td>
                  <td className="p-2 text-right">{s.open}</td>
                  <td className={cx('p-2 text-right', s.overdue && 'font-semibold text-red-600')}>{s.overdue}</td>
                  <td className={cx('p-2 text-right', s.review && 'text-amber-600')}>{s.review}</td>
                  <td className="p-2 text-right">{s.on_hold}</td>
                  <td className={cx('p-2 text-right', s.urgent && 'text-red-600')}>{s.urgent}</td>
                </tr>))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="담당자별 업무량">
          {!data.workload.length ? <p className="px-2 py-4 text-center text-xs text-slate-400">배정된 업무가 없습니다</p> : (
            <ul className="space-y-1.5 p-2">{data.workload.map((w: any) => (
              <li key={w.id} className="text-xs">
                <div className="flex justify-between"><Link href={`/tasks?assigneeId=${w.id}`} className="font-medium hover:underline">{w.name}</Link>
                  <span className="text-slate-500">진행 {w.open} · 이번 주 {w.this_week}{w.overdue ? <b className="text-red-600"> · 초과 {w.overdue}</b> : ''} · 7일 완료 {w.done_7d}</span></div>
                <div className="mt-0.5 h-2 rounded bg-slate-100"><div className="h-2 rounded bg-brand-500" style={{ width: `${(w.open / maxLoad) * 100}%` }} /></div>
              </li>))}
            </ul>
          )}
        </Section>
        <Section title="완료 현황 (최근 4주, 일별)">
          <div className="flex h-28 items-end gap-0.5 p-2" aria-label="일별 완료 건수">
            {days.map((d) => (
              <div key={d.day} className="flex-1" title={`${d.day}: ${d.done}건`}>
                <div className="rounded-t bg-emerald-500" style={{ height: `${(d.done / maxDone) * 96}px`, minHeight: d.done ? 3 : 0 }} />
              </div>
            ))}
          </div>
          <p className="px-2 text-right text-xs text-slate-500">합계 {days.reduce((a, d) => a + d.done, 0)}건</p>
        </Section>
      </div>
    </div>
  );
}
