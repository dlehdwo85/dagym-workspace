import { handler, body, clientIp } from '@/lib/api';
import { deleteNotice, getNotice, noticeInput, updateNotice } from '@/lib/announcements';

/** 열면 읽음 처리(?peek=1 이면 안 함) */
export const GET = handler<{ id: string }>(async ({ req, user, params }) => getNotice(user, params.id, { markRead: req.nextUrl.searchParams.get('peek') !== '1' }));
export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => updateNotice(user, params.id, await body(req, noticeInput.partial()), clientIp(req)));
export const DELETE = handler<{ id: string }>(async ({ req, user, params }) => deleteNotice(user, params.id, clientIp(req)));
