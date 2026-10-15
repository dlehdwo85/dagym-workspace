import { z } from 'zod';
import { handler, body, clientIp } from '@/lib/api';
import { undoImport } from '@/lib/taskImport';

/** V30 ① 방금 가져온 묶음 되돌리기(휴지통으로) */
export const POST = handler(async ({ req, user }) => undoImport(user, (await body(req, z.object({ importId: z.string().uuid() }))).importId, clientIp(req)));
