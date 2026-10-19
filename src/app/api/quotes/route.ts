import { handler, body, clientIp } from '@/lib/api';
import { createQuote, listQuotes, quoteInput } from '@/lib/quotes';

/** V19 2장 견적서: 목록(?company=&taskId=) · 만들기(PDF 1페이지 → 자료실 "견적서", 업무 첨부) */
export const GET = handler(async ({ req, user }) => listQuotes(user, { company: req.nextUrl.searchParams.get('company') ?? undefined, taskId: req.nextUrl.searchParams.get('taskId') ?? undefined }));
export const POST = handler(async ({ req, user }) => createQuote(user, await body(req, quoteInput), clientIp(req)));
