import { handler, body, clientIp } from '@/lib/api';
import { leaveInput, leaveUser } from '@/lib/offboard';

/** 대표 10/20 7): 퇴사 처리(날짜·로그인 차단·세션 만료·팀/대화방 제거) + 바로 인수인계(선택) */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => leaveUser(user, params.id, await body(req, leaveInput), clientIp(req)));
