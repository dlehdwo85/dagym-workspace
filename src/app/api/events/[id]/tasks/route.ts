import { handler, body } from '@/lib/api';
import { createTaskFromEvent, eventTaskInput, linkInput, linkTask, linkedTasks } from '@/lib/eventtasks';

/** 일정에 연결된 업무 / 기존 업무 연결(taskId) 또는 새 업무 만들기(title) */
export const GET = handler<{ id: string }>(async ({ user, params, req }) => ({ tasks: await linkedTasks(user, params.id, req.nextUrl.searchParams.get('occurrenceStart')) }));
export const POST = handler<{ id: string }>(async ({ req, user, params }) => {
  const raw = await req.json().catch(() => ({}));
  if (raw && typeof raw === 'object' && 'taskId' in raw) return linkTask(user, params.id, linkInput.parse(raw));
  return createTaskFromEvent(user, params.id, eventTaskInput.parse(raw));
}, { idempotent: true });
