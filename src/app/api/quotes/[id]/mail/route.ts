import { handler, body, clientIp } from '@/lib/api';
import { quoteMail, quoteMailInput } from '@/lib/quotes';

/** 메일로 보내기(PDF 첨부, 기존 보관함) — 업무에 연결된 견적서만 */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => quoteMail(user, params.id, await body(req, quoteMailInput), clientIp(req)));
