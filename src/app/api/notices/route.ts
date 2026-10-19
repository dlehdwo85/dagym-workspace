import { handler, body, clientIp } from '@/lib/api';
import { createNotice, listNotices, noticeInput } from '@/lib/announcements';

/** V30 ② 공지: 목록(?unread=1 안 읽은 것만) · 쓰기(예약 게시·대상·첨부) */
export const GET = handler(async ({ req, user }) => listNotices(user, { unread: req.nextUrl.searchParams.get('unread') === '1', limit: Number(req.nextUrl.searchParams.get('limit')) || undefined }));
export const POST = handler(async ({ req, user }) => createNotice(user, await body(req, noticeInput), clientIp(req)), { idempotent: true });
