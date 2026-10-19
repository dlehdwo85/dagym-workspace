import { handler } from '@/lib/api';
import { noticeReads } from '@/lib/announcements';

/** 읽음 현황(작성자·관리자) */
export const GET = handler<{ id: string }>(async ({ user, params }) => noticeReads(user, params.id));
