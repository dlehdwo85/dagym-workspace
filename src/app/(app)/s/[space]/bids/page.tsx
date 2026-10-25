import { notFound, redirect } from 'next/navigation';

/** #611(대표 10/25 ⑦): 입찰·공고 화면은 영업기회 허브 '입찰' 탭으로 합쳐짐 — 옛 주소(메일·알림·즐겨찾기)는 허브 입찰 탭으로 넘김(탭 → bt · 검색어 → bq · 사업 → bz · 상세 id 그대로) */
export default async function Page({ params, searchParams }: { params: Promise<{ space: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  if ((await params).space !== 'sales') notFound();
  const sp = await searchParams;
  const q = new URLSearchParams({ tab: 'bids' });
  if (sp.tab) q.set('bt', sp.tab);
  if (sp.q) q.set('bq', sp.q);
  if (sp.biz) q.set('bz', sp.biz);
  if (sp.id) q.set('id', sp.id);
  redirect(`/s/sales/hub?${q}`);
}
