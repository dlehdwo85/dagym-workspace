'use client';
import Link from 'next/link';
import { use } from 'react';
import { AlertTriangle, ChevronLeft, Printer } from 'lucide-react';
import { useApi } from '@/components/client';
import { Button, DueChip, ErrorBox, PriorityTag, Skeleton, fmtDate, fmtDateTime } from '@/components/ui';

/** B-15 주간 보고 — 인쇄 또는 "PDF 로 저장"(브라우저 인쇄 대화상자) */
export default function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, loading } = useApi<{ report: any }>(`/api/reports/${id}`);
  if (error) return <ErrorBox error={error} />;
  if (loading && !data) return <Skeleton rows={8} />;
  const r = data!.report;
  const d = r.data;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between print:hidden">
        <Link href="/reports" className="inline-flex items-center gap-1 text-sm text-ink-2 hover:underline"><ChevronLeft className="size-4" />주간 보고</Link>
        <Button onClick={() => window.print()}><Printer />인쇄 · PDF 저장</Button>
      </div>
      <article className="print-area mx-auto max-w-4xl space-y-6 rounded-card border border-line bg-white p-6 shadow-card sm:p-10" data-testid="weekly-report">
        <header className="border-b border-line pb-4">
          <p className="text-sm text-ink-2">다짐 · 하이링크</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">주간 보고 · {fmtDate(d.weekStart)} ~ {fmtDate(d.weekEnd)}</h1>
          <p className="mt-1 text-xs text-ink-3">{fmtDateTime(r.created_at)} 자동 생성 · 워크인 집계</p>
        </header>
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[['완료', d.totals.done, ''], ['새 업무', d.totals.created, ''], ['지연(주말 기준)', d.totals.overdue, d.totals.overdue ? 'text-red-600' : ''], ['검토 대기', d.totals.review, ''], ['미해결 민원', d.totals.complaints, d.totals.complaints ? 'text-violet-600' : '']].map(([l, v, c]) => (
            <div key={l as string} className="rounded-input border border-line p-3"><div className="text-xs text-ink-2">{l}</div><div className={`mt-1 text-2xl font-bold tabular-nums ${c}`}>{v as number}</div></div>
          ))}
        </section>
        <section>
          <h2 className="mb-2 font-semibold">현장별</h2>
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-xs text-ink-2"><tr><th className="py-2">조직</th><th className="py-2 text-right">완료</th><th className="py-2 text-right">새 업무</th><th className="py-2 text-right">지연</th><th className="py-2 text-right">검토 대기</th><th className="py-2 text-right">미해결 민원</th></tr></thead>
            <tbody className="divide-y divide-line">
              {d.sites.map((s: any) => (
                <tr key={s.id}><td className="py-2 font-medium">{s.name}</td><td className="py-2 text-right tabular-nums">{s.done}</td><td className="py-2 text-right tabular-nums">{s.created}</td>
                  <td className={`py-2 text-right tabular-nums ${s.overdue ? 'font-semibold text-red-600' : ''}`}>{s.overdue}</td><td className="py-2 text-right tabular-nums">{s.review}</td><td className="py-2 text-right tabular-nums">{s.open_complaints}</td></tr>
              ))}
              {!d.sites.length && <tr><td colSpan={6} className="py-4 text-center text-ink-3">지난주 움직임이 있는 조직이 없습니다</td></tr>}
            </tbody>
          </table>
        </section>
        <section>
          <h2 className="mb-2 flex items-center gap-1.5 font-semibold"><AlertTriangle className="size-4 text-amber-500" />주요 이슈 (긴급·높음·지연)</h2>
          <ul className="divide-y divide-line text-sm">
            {d.issues.map((t: any) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2 py-2">
                <Link href={`/tasks/${t.id}`} className="font-medium hover:underline">{t.title}</Link>
                <span className="text-xs text-ink-2">{t.org_unit_name} · {t.assignee_name ?? '미배정'}</span>
                <span className="ml-auto flex items-center gap-2"><PriorityTag p={t.priority} /><DueChip due={t.due_date} status="open" /></span>
              </li>
            ))}
            {!d.issues.length && <li className="py-3 text-ink-3">주요 이슈가 없습니다</li>}
          </ul>
        </section>
        {d.sales && (
          <section data-testid="weekly-report-sales">
            {/* 202차(#461 ⑤): 영업 진행(회사 전체, 만든 날 기준) — 놓친 거래처(연락일 지남·다음 행동 없음·오래 쉼·담당 없음) */}
            <h2 className="mb-2 font-semibold">영업 진행 <span className="text-xs font-normal text-ink-3">{fmtDate(d.sales.asOf)} 기준 · 진행 중 {d.sales.open}곳</span></h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[['연락일 지남', d.sales.over, 'text-red-600'], ['다음 행동 없음', d.sales.none, 'text-red-600'], ['오래 쉼(14일 넘게 연락 없음)', d.sales.stale, 'text-amber-600'], ['담당 없음', d.sales.unassigned, 'text-red-600']].map(([l, v, c]) => (
                <div key={l as string} className="rounded-input border border-line p-3"><div className="text-xs text-ink-2">{l}</div><div className={`mt-1 text-2xl font-bold tabular-nums ${(v as number) ? c : ''}`}>{v as number}</div></div>
              ))}
            </div>
            {d.sales.staleTop.length > 0 && (
              <ul className="mt-2 divide-y divide-line text-sm">
                {d.sales.staleTop.map((l: any) => (
                  <li key={l.id} className="flex flex-wrap items-center gap-2 py-2">
                    <Link href={`/s/sales/leads?id=${l.id}`} className="font-medium hover:underline">{l.name}</Link>
                    <span className="text-xs text-ink-2">{l.status ?? '단계 없음'} · {l.owner ?? '담당 없음'}</span>
                    <span className="ml-auto text-xs text-amber-700">{l.last ? `마지막 접촉 ${fmtDate(l.last)} ${l.lastKind}` : `연락 기록 없음 · 등록 ${fmtDate(l.created)}`}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        {d.photos.length > 0 && (
          <section>
            <h2 className="mb-2 font-semibold">현장 사진</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {d.photos.map((p: any) => (
                <figure key={p.id} className="overflow-hidden rounded-input border border-line">
                  <img src={`/api/attachments/${p.id}/download?inline=1`} alt={p.file_name} className="aspect-square w-full bg-slate-100 object-cover" />
                  <figcaption className="p-1.5 text-[11px] text-ink-2"><span className="block truncate font-medium text-ink">{p.task_title}</span>{p.org_unit_name}</figcaption>
                </figure>
              ))}
            </div>
          </section>
        )}
      </article>
    </div>
  );
}
