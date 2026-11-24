'use client';
import { use } from 'react';
import { useSearchParams } from 'next/navigation';
import { TaskDetail } from '@/components/TaskDetail';
import { TaskViews } from '@/components/TaskViews';

/**
 * #1165(대표 11/24 "업무가 자꾸 전체 화면으로 뜹니다. 오른쪽 사이드바처럼"): 업무 주소(/tasks/:id)로 바로 들어와도
 * (새로 고침·메일·앱 푸시·뒤로가기·외부 링크) 업무 목록 + 오른쪽 패널로 그린다 — 가운데 전체 카드 없음.
 * 패널의 [크게 보기](새 탭)만 ?full=1 로 넓은 화면.
 */
export default function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const full = useSearchParams().get('full') === '1';
  return full ? <TaskDetail id={id} /> : <TaskViews title="업무" />;
}
