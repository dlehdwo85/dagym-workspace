'use client';
import { use } from 'react';
import { TaskDetail } from '@/components/TaskDetail';

export default function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <TaskDetail id={id} />;
}
