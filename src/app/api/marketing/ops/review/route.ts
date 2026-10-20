import { handler } from '@/lib/api';
import { isAdmin } from '@/lib/access';
import { assertSpace } from '@/lib/spaces';
import { forbidden } from '@/lib/errors';
import { tenantOf } from '@/lib/types';
import { opsReview, opsStatus } from '@/lib/mktOps';

/** 대표 03:00 ② AI 마케터 상시 운영: 지금 상태(정상/주의/조치 필요)·신호·최근 검토 / [지금 검토](관리자, 1시간 제한 무시) */
export const GET = handler(async ({ user }) => { await assertSpace(user, 'marketing'); return { review: await opsStatus(tenantOf(user)) }; });
export const POST = handler(async ({ user }) => { await assertSpace(user, 'marketing'); if (!isAdmin(user)) throw forbidden('대표·관리자만'); return opsReview(tenantOf(user), new Date(), { force: true }); });
