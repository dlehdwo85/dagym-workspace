import type { Metadata } from 'next';
import { MeetRoom } from '@/components/meet/MeetRoom';

// 219차 워크인 화상회의 주소(로그인 없이도 열림 — 손님은 이름만, 같은 회사 직원은 직원 입장). 기능 스위치가 꺼져 있으면 서버가 404
export const metadata: Metadata = { title: '화상회의 · 워크인', robots: { index: false, follow: false } };

export default async function MeetPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <MeetRoom code={code} />;
}
