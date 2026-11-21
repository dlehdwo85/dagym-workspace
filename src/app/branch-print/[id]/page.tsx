import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { getReport } from '@/lib/branchReport';
import { ReportView, type Body } from '@/components/branch/ReportView';
import { PrintButton } from '@/components/branch/PrintButton';

export const metadata: Metadata = { title: '지점 주간보고 인쇄', robots: { index: false, follow: false } };

/** #1096 지점 주간보고 PDF(인쇄 모양 A4) — 브라우저 [인쇄 → PDF로 저장]. 앱 틀 없이 보고서만. 권한은 화면과 같음(없으면 404) */
export default async function BranchPrint({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = await currentUser();
  if (!u) redirect(`/login?next=${encodeURIComponent(`/branch-print/${id}`)}`);
  const r = await getReport(u, id).catch(() => null);
  if (!r) notFound();
  const x = r.report;
  return (
    <main className="mx-auto max-w-[210mm] bg-white p-[12mm] text-slate-900 print:p-0">
      <style>{'@page { size: A4; margin: 14mm 12mm; } @media print { .no-print { display: none !important } body { background: #fff } }'}</style>
      <div className="no-print mb-4 flex items-center justify-between gap-2 rounded-input bg-slate-50 p-2 text-sm">
        <span>{x.status === 'submitted' ? '제출한 보고서' : '초안(아직 제출 전)'} — 인쇄 창에서 &lsquo;PDF로 저장&rsquo;을 고르면 PDF 로 내려받습니다.</span>
        <PrintButton />
      </div>
      <ReportView unit={x.unit_name} day={x.report_day} start={x.period_start} end={x.period_end} body={x.body as Body} />
    </main>
  );
}
