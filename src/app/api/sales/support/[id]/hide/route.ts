import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { setHidden } from '@/lib/sales/support';

/** #450 맞춤 목록에서 숨기기·되돌리기(회사 전체) */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => setHidden(user, params.id, (await body(req, z.object({ hidden: z.boolean() }))).hidden));
