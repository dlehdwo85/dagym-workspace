import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { Goals } from '@/components/marketing/Goals';

/** 대표 10/20 18:00 ② 월 운영 목표(마케팅 공간) */
export default async function Page({ params }: { params: Promise<{ space: string }> }) {
  if ((await params).space !== 'marketing') notFound();
  return <Suspense><Goals /></Suspense>;
}
