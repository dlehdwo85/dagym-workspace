import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { setListed } from '@/lib/sales/support';

/** #784 이번 주 신청 목록에 담기·빼기 */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => setListed(user, params.id, (await body(req, z.object({ on: z.boolean() }))).on));
