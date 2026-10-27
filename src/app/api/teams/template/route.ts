import { handler, clientIp } from '@/lib/api';
import { startGenericOrg } from '@/lib/teams';

/** P2 조직 개편(대표 10/26 ⑧): [일반 기업 조직도로 시작] — 조직이 하나도 없는 회사만(사용자 관리 편집) */
export const POST = handler(async ({ req, user }) => startGenericOrg(user, clientIp(req)));
