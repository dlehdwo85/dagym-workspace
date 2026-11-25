import { handler, body, clientIp } from '@/lib/api';
import { addInput, addRequest, listRequests } from '@/lib/customerRequests';

/** #1175 고객 요청함(플랫폼 운영자만) — GET ?status=&category=&test=1(시험 회사 요청도) · POST {source: memo|mail, tenant?, title, body?} */
export const GET = handler(async ({ req, user }) => { const q = new URL(req.url).searchParams; return listRequests(user, { status: q.get('status'), category: q.get('category'), test: q.get('test') === '1' }); });
export const POST = handler(async ({ req, user }) => addRequest(user, await body(req, addInput), clientIp(req)));
