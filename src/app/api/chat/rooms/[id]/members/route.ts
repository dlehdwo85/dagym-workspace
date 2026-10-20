import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { addMembers, removeMember } from '@/lib/chat';

export const POST = handler<{ id: string }>(async ({ req, user, params }) => addMembers(user, params.id, (await body(req, z.object({ userIds: z.array(z.string().uuid()).min(1).max(100) }))).userIds));
/** 메신저 1차 A2: 내보내기(방장·관리자) */
export const DELETE = handler<{ id: string }>(async ({ req, user, params }) => removeMember(user, params.id, (await body(req, z.object({ userId: z.string().uuid() }))).userId));
