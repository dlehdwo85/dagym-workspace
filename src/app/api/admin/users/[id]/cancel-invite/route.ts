import { handler, clientIp } from '@/lib/api';
import { cancelInvite } from '@/lib/admin';

/** 로컬 11/21: 사용자·권한 [초대 취소] — 초대 링크 모두 취소 + 사용 중지(목록 '초대 취소됨') */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => cancelInvite(user, params.id, clientIp(req)));
