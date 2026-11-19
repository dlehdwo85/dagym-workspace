import { handler, body, clientIp } from '@/lib/api';
import { agreementInput, createAgreement, listAgreements } from '@/lib/agreements';

/** 계약 관리 — 목록(?q= &tag= &state=open|soon|expired|… &owner=) · 등록 */
export const GET = handler(async ({ req, user }) => {
  const q = req.nextUrl.searchParams;
  return listAgreements(user, { q: q.get('q'), tag: q.get('tag'), state: q.get('state'), ownerId: q.get('owner') });
});
export const POST = handler(async ({ req, user }) => createAgreement(user, await body(req, agreementInput), clientIp(req)));
