import { handler } from '@/lib/api';
import { screenTicket } from '@/lib/meetings';

/** 휴대폰 앱 화면 공유용 입장권(화면만 보내는 두 번째 접속) — 회의에 들어와 있고 화면 공유가 허락된 사람만 */
export const POST = handler<{ id: string }>(async ({ user, params }) => screenTicket(user, params.id));
