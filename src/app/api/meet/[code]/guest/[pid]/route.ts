import { handler } from '@/lib/api';
import { guestSeen, guestStatus } from '@/lib/meetings';

/** 손님 대기 화면(3초마다, 헤더 x-guest-secret): 허락되고 직원이 들어와 있으면 입장권 */
export const GET = handler<{ code: string; pid: string }>(async ({ req, params }) => guestStatus(params.code, params.pid, req.headers.get('x-guest-secret')), { public: true });
/** 회의 중 '아직 있음' · { leave: true } = 나가기 */
export const POST = handler<{ code: string; pid: string }>(async ({ req, params }) => { const b = await req.json().catch(() => ({})); return guestSeen(params.code, params.pid, req.headers.get('x-guest-secret'), b?.leave === true); }, { public: true });
