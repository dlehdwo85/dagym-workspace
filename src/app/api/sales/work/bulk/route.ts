import { z } from 'zod';
import { body, handler } from '@/lib/api';
import { WORK_KINDS, bulkWork } from '@/lib/sales/work';

/** 대표 10/20 14:15 ④ 일괄: 허브·입찰에서 여러 건 체크 → [영업 진행으로](또는 다른 상태) → 업무 n건 */
export const POST = handler(async ({ req, user }) => bulkWork(user, await body(req, z.object({ kind: z.enum(WORK_KINDS), ids: z.array(z.string().min(1).max(100)).min(1).max(100), status: z.string().max(30), nextDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), reason: z.string().trim().max(300).nullable().optional() }))));
