import { handler, body, clientIp } from '@/lib/api';
import { contractInput, createContract, listContracts } from '@/lib/contracts';

/** #116 전자계약서: 목록(?userId=&status=) · 만들어 보내기(서식·대상 직원·서명자·코드 전달 방식) */
export const GET = handler(async ({ req, user }) => { const q = req.nextUrl.searchParams; return listContracts(user, { userId: q.get('userId') ?? undefined, status: q.get('status') ?? undefined }); });
export const POST = handler(async ({ req, user }) => createContract(user, await body(req, contractInput), clientIp(req)), { idempotent: true });
