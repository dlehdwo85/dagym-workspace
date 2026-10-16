import { handler, body, clientIp } from '@/lib/api';
import { memberSpacesInput, setMemberSpaces } from '@/lib/spaces';

/** V41 공간: 직원별 공간 배정(업무는 늘) */
export const PUT = handler(async ({ req, user }) => setMemberSpaces(user, await body(req, memberSpacesInput), clientIp(req)));
