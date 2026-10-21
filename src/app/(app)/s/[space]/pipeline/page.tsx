import { notFound, redirect } from 'next/navigation';

/** 대표 10/21 12:00 영업 재편 3): '파이프라인' 메뉴 없음 — 진행 단계는 리드·거래처 안(단계별 보기). 예전 주소는 그리로 */
export default async function Page({ params }: { params: Promise<{ space: string }> }) {
  if ((await params).space !== 'sales') notFound();
  redirect('/s/sales/leads?view=stages');
}
