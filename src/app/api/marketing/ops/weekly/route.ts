import { handler } from '@/lib/api';
import { isAdmin } from '@/lib/access';
import { forbidden } from '@/lib/errors';
import { assertSpace } from '@/lib/spaces';
import { tenantOf } from '@/lib/types';
import { weeklyProposal } from '@/lib/mktOps';

/** 대표 10/20 14:10 ④: 주간 운영 제안 카드 지금 만들기(관리자) — 월요일 자동과 같은 내용, 6일 안 이미 있으면 그 카드 */
export const POST = handler(async ({ user, req }) => { await assertSpace(user, 'marketing'); if (!isAdmin(user)) throw forbidden('대표·관리자만'); return weeklyProposal(tenantOf(user), user.id, { force: req.nextUrl.searchParams.get('force') === '1' }); });
