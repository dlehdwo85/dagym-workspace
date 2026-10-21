import { handler } from '@/lib/api';
import { todayDigest } from '@/lib/sales/digest';

/** 오늘 다이제스트(보냈으면 보낸 것, 아니면 지금 기준 미리보기) */
export const GET = handler(async ({ user }) => todayDigest(user));
