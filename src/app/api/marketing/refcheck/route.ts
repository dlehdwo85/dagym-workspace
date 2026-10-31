import { handler } from '@/lib/api';
import { refCheck } from '@/lib/mktRefCheck';

/** 295차 #835 레퍼런스 대조표: 승인 대기·수정 요청 글(?status=pending,changes,draft)을 레퍼런스 기준과 한 줄씩 — AI 호출 없음 */
export const GET = handler(async ({ req, user }) => refCheck(user, { status: (req.nextUrl.searchParams.get('status') ?? '').split(',').filter(Boolean), limit: Number(req.nextUrl.searchParams.get('limit')) || 100 }));
