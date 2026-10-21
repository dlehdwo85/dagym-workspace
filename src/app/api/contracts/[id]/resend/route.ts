import { z } from 'zod';
import { handler, body, clientIp, zUuid } from '@/lib/api';
import { resendContract } from '@/lib/contracts';

/** #116 다시 보내기(링크·접속 코드 새로 발급, 지금 차례 서명자) */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => { const i = await body(req, z.object({ signerId: zUuid.optional() })); return resendContract(user, params.id, i.signerId, clientIp(req)); });
