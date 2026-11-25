import { notFound } from 'next/navigation';
import { CheckHome } from '@/components/check/CheckGuide';
import { currentUser } from '@/lib/auth';
import { featureOn } from '@/lib/features';
import { tenantOf } from '@/lib/types';

/** 점검 1단계 — 점검 가이드(분야·공간·항목·기준 사진·개정 이력) · 직원 공유 양호 기준 · 템플릿. 권한이 없으면 공유된 양호 기준만
 *  #1181 회사별 기능 켜기: 점검을 끈 회사는 화면도 없음(404) */
export default async function CheckPage() {
  const user = await currentUser();
  if (user && !(await featureOn(tenantOf(user), 'check'))) notFound();
  return <CheckHome />;
}
