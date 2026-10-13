import { handler } from '@/lib/api';
import { denyDemo } from '@/lib/access';
import { createFeed, deleteFeed, feedInfo } from '@/lib/ics';

export const GET = handler(async ({ user }) => feedInfo(user));
/** 새 주소 만들기(이전 주소는 바로 못 씀) */
export const POST = handler(async ({ req, user }) => { denyDemo(user); return createFeed(user, process.env.APP_URL || req.nextUrl.origin); });
export const DELETE = handler(async ({ user }) => deleteFeed(user));
