import { notFound } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { branchReportOn } from '@/lib/branchReport';
import { tenantOf } from '@/lib/types';
import { BranchReports } from '@/components/branch/BranchReports';

/** #1096 지점 주간보고 — 다짐 전용(다른 회사·체험 회사는 404) */
export default async function Page() {
  const u = await currentUser();
  if (!u || u.isDemo || !branchReportOn(tenantOf(u))) notFound();
  return <BranchReports />;
}
