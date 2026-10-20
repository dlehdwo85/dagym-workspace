import { z } from 'zod';
import { handler, body, clientIp } from '@/lib/api';
import { deleteLead, leadPatch, updateLead } from '@/lib/sales/cutover';

/** 리드 수정(상태·사유·다음 연락일·메모·담당·S2 2차 폼 칸) — 전환 전(writes_open=false)에는 409 */
export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => updateLead(user, params.id, await body(req, leadPatch)));
/** S2 2차: 리드 삭제(사유 필수·감사·소프트) */
export const DELETE = handler<{ id: string }>(async ({ req, user, params }) => deleteLead(user, params.id, (await body(req, z.object({ reason: z.string().trim().min(1, '삭제 사유를 적어 주세요').max(500) }))).reason, clientIp(req)));
