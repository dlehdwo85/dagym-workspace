import { handler, body, clientIp } from '@/lib/api';
import { getShareMode, setShareMode, shareModeInput } from '@/lib/shareMode';

/** #1129 자료실·업무 공개 방식(부서·팀별 / 회사 전체 공유) — 보기 = 회사 사람, 바꾸기 = 대표(바꾸기 전 영향 건수) */
export const GET = handler(async ({ user }) => getShareMode(user));
export const PUT = handler(async ({ req, user }) => setShareMode(user, await body(req, shareModeInput), clientIp(req)));
