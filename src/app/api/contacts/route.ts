import { handler, body, clientIp } from '@/lib/api';
import { contactInput, createContact, listContacts } from '@/lib/contacts';

/** V31 ① 회사 연락처: 목록·검색(?q=&tag=&trash=1) · 등록 */
export const GET = handler(async ({ req, user }) => { const q = req.nextUrl.searchParams; return listContacts(user, { q: q.get('q') ?? undefined, tag: q.get('tag') ?? undefined, trash: q.get('trash') === '1' }); });
export const POST = handler(async ({ req, user }) => createContact(user, await body(req, contactInput), clientIp(req)));
