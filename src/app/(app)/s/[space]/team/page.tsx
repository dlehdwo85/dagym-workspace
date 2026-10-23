import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { Team } from '@/components/marketing/Team';

/** #499-7 AI 마케팅팀(운영실 위 역할·일정·기록·기억 + 기획 담당 오늘 주제) */
export default async function Page({ params }: { params: Promise<{ space: string }> }) {
  if ((await params).space !== 'marketing') notFound();
  return <Suspense><Team /></Suspense>;
}
