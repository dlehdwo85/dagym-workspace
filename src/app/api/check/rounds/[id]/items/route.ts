import { handler } from '@/lib/api';
import { roundItemSearch } from '@/lib/check/rounds';

/** 수시 점검에서 항목 찾기 — ?q= */
export const GET = handler<{ id: string }>(async ({ req, user, params }) => roundItemSearch(user, params.id, req.nextUrl.searchParams.get('q')));
