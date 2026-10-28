import { handler } from '@/lib/api';
import { staffSeen } from '@/lib/meetings';

/** 회의 중 '아직 있음'(30초마다) · { leave: true } = 나가기 */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => { const b = await req.json().catch(() => ({})); return staffSeen(user, params.id, b?.leave === true); });
