import { z } from 'zod';
import { handler, body, clientIp } from '@/lib/api';
import { declineContract } from '@/lib/contracts';

export const POST = handler<{ token: string }>(async ({ req, params }) => { const i = await body(req, z.object({ code: z.string().trim().min(4).max(10), reason: z.string().trim().min(1).max(500) })); return declineContract(params.token, i.code, i.reason, clientIp(req), req.headers.get('user-agent')); }, { public: true });
