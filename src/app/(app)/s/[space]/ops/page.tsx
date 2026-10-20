import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { Ops } from '@/components/marketing/Ops';

/** 대표 10/20 20:00 ①②③ 마케팅 운영실(AI 마케터 승인 카드 · 광고 예산 계획 · 월 매출 목표) */
export default async function Page({ params }: { params: Promise<{ space: string }> }) {
  if ((await params).space !== 'marketing') notFound();
  return <Suspense><Ops /></Suspense>;
}
