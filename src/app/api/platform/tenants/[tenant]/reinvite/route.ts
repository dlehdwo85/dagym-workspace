import { handler, clientIp } from '@/lib/api';
import { reinviteOwner } from '@/lib/platformAdmin';

/** 플랫폼 운영: 대표 초대 메일 다시 보내기 */
export const POST = handler<{ tenant: string }>(async ({ req, user, params }) => reinviteOwner(user, params.tenant, clientIp(req)));
