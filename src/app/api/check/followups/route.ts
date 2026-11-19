import { handler } from '@/lib/api';
import { listFollowups } from '@/lib/check/rounds';

/** 보완 요청 목록 — ?state=open|requested|waiting|closed &unit= */
export const GET = handler(async ({ req, user }) => listFollowups(user, { state: req.nextUrl.searchParams.get('state'), unitId: req.nextUrl.searchParams.get('unit') }));
