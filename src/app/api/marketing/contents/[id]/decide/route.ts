import { handler, body, clientIp } from '@/lib/api';
import { decide, decideInput } from '@/lib/marketing';

/** 승인·수정 요청·보류(버전 단위) */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => decide(user, params.id, await body(req, decideInput), clientIp(req)));
