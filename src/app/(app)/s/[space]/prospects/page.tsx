import { notFound } from 'next/navigation';
import { Prospects } from '@/components/sales/Prospects';

/** V41 단계 3 영업 공간 화면(공간 권한은 앱 레이아웃에서 404) */
export default async function Page({ params }: { params: Promise<{ space: string }> }) {
  if ((await params).space !== 'sales') notFound();
  return <Prospects />;
}
