import { handler, body, clientIp } from '@/lib/api';
import { broadcast, broadcastInput } from '@/lib/customerOps';

/** #1163 ④ 여러 고객사에 메일·공지 — POST {tenants, channel, ad, title, body, send}(send = false 면 미리 보기만) */
export const POST = handler(async ({ req, user }) => broadcast(user, await body(req, broadcastInput), clientIp(req)));
