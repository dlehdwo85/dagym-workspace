import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { reactMessage } from '@/lib/chat';

/** V14 25번: 메시지 반응 켜고 끄기 */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => reactMessage(user, params.id, (await body(req, z.object({ emoji: z.string().max(8) }))).emoji));
