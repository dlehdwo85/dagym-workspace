import { z } from 'zod';
import { handler, body, clientIp } from '@/lib/api';
import { signView } from '@/lib/contracts';

/** 접속 코드 확인 → 본문·서명자 현황 */
export const POST = handler<{ token: string }>(async ({ req, params }) => { const i = await body(req, z.object({ code: z.string().trim().min(4).max(10) })); return signView(params.token, i.code, clientIp(req), req.headers.get('user-agent')); }, { public: true });
