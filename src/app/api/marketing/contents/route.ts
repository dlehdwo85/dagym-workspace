import { handler, body } from '@/lib/api';
import { contentInput, createContent, listContents } from '@/lib/marketing';

/** V41 4-2 콘텐츠: 승인함(view=approvals)·캘린더(from~to) · 새 콘텐츠(v1 = 승인 대기) */
export const GET = handler(async ({ req, user }) => {
  const sp = req.nextUrl.searchParams;
  return listContents(user, { view: sp.get('view') ?? undefined, from: sp.get('from') ?? undefined, to: sp.get('to') ?? undefined, day: sp.get('day') ?? undefined });
});
export const POST = handler(async ({ req, user }) => createContent(user, await body(req, contentInput)));
