import { handler, body, clientIp } from '@/lib/api';
import { signBody, signContract } from '@/lib/contracts';

/** 서명(그리기·도장 PNG) — 순서가 된 서명자만 */
export const POST = handler<{ token: string }>(async ({ req, params }) => signContract(params.token, await body(req, signBody), clientIp(req), req.headers.get('user-agent')), { public: true });
