import { handler } from '@/lib/api';
import { db } from '@/lib/db';
import { assertSpace } from '@/lib/spaces';
import { tenantOf } from '@/lib/types';
import { similarLeads } from '@/lib/sales/cutover';

/** S2 2차: 새 리드 입력 중 비슷한 거래처 미리 보기(?name=) */
export const GET = handler(async ({ req, user }) => { await assertSpace(user, 'sales'); return { similar: await similarLeads(db(), tenantOf(user), req.nextUrl.searchParams.get('name') ?? '') }; });
