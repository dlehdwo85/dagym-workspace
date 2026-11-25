import { z } from 'zod';
import { handler, clientIp } from '@/lib/api';
import { checkNow, removeWatch, watchToTask } from '@/lib/sales/watch';

/** #1181: 원천 지우기(DELETE) · POST {action:'check'}(지금 받기) · POST {action:'task', itemId}(글 → 업무) */
export const DELETE = handler<{ id: string }>(async ({ req, user, params }) => removeWatch(user, z.string().uuid().parse(params.id), clientIp(req)));
export const POST = handler<{ id: string }>(async ({ req, user, params }) => {
  const raw = await req.json().catch(() => ({}));
  const action = z.enum(['check', 'task']).parse(raw?.action);
  if (action === 'check') return checkNow(user, z.string().uuid().parse(params.id));
  return watchToTask(user, z.string().uuid().parse(raw?.itemId));
});
