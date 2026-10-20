import { notFound } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { isSpace, userSpaces } from '@/lib/spaces';
import { MarketingHome } from '@/components/marketing/Home';
import { SalesHome } from '@/components/sales/SalesSrc';

export const dynamic = 'force-dynamic';

/** V41 공간 첫 화면: 영업 = 영업 현황, 마케팅 = 홈(로컬 10/19: 예전 운영실 사이트로 가는 버튼 없음 — 게시는 워크인 안에서) */
export default async function SpaceHome({ params }: { params: Promise<{ space: string }> }) {
  const { space } = await params;
  const u = await currentUser();
  if (!u || !isSpace(space) || space === 'work' || !(await userSpaces(u)).includes(space)) notFound();
  return space === 'sales' ? <SalesHome /> : <MarketingHome />;
}
