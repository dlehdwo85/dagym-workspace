import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { OpsHistory } from '@/components/marketing/OpsHistory';

/** 운영실에서 옮겨 온 기록(관리자 — API 가 403) */
export default async function Page({ params }: { params: Promise<{ space: string }> }) {
  if ((await params).space !== 'marketing') notFound();
  return <Suspense><OpsHistory /></Suspense>;
}
