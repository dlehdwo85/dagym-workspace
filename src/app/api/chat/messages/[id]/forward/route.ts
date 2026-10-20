import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { forwardMessage } from '@/lib/chat';

/** 메신저 1차 B5: 메시지 전달(여러 방) */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => forwardMessage(user, params.id, (await body(req, z.object({ roomIds: z.array(z.string().uuid()).min(1).max(10) }))).roomIds));
