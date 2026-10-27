import { handler } from '@/lib/api';
import { awardStats } from '@/lib/sales/awardStats';

// 226차 #497 R21-4 낙찰 분석(경쟁업체) — ?days=30|90|180|365
export const GET = handler(async ({ req, user }) => awardStats(user, Number(req.nextUrl.searchParams.get('days') ?? 90)));
