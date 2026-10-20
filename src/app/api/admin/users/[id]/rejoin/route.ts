import { handler, clientIp } from '@/lib/api';
import { rejoinUser } from '@/lib/offboard';

/** 대표 10/20 7): 복직(퇴사일부터 30일 안) */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => rejoinUser(user, params.id, clientIp(req)));
