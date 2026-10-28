import { handler } from '@/lib/api';
import { listDeletedEvents } from '@/lib/events';

/** 241차: 최근 지운 일정(내가 고칠 수 있는 것) — 지운 사람·때 */
export const GET = handler(async ({ req, user }) => listDeletedEvents(user, Number(new URL(req.url).searchParams.get('days')) || 30));
