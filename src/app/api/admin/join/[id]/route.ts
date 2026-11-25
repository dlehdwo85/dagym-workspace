import { z } from 'zod';
import { handler, clientIp } from '@/lib/api';
import { approveInput, approveJoin, approvePreview, rejectInput, rejectJoin } from '@/lib/joinLinks';

/** #1176 합류 신청 하나 — GET 승인 미리 보기(요금 구간이 바뀌는지) · POST {action: approve(역할·부서·팀) | reject(사유)} */
export const GET = handler<{ id: string }>(async ({ user, params }) => approvePreview(user, params.id));
export const POST = handler<{ id: string }>(async ({ req, user, params }) => {
  const raw = await req.json().catch(() => ({}));
  const action = z.enum(['approve', 'reject']).parse(raw?.action);
  return action === 'approve' ? approveJoin(user, params.id, approveInput.parse(raw), clientIp(req)) : rejectJoin(user, params.id, rejectInput.parse(raw), clientIp(req));
});
