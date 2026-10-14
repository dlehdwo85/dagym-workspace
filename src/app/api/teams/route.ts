import { handler, body, clientIp } from '@/lib/api';
import { createTeam, listTeams, teamInput } from '@/lib/teams';

/** V14 8번 팀 목록(모두) · 만들기(사용자 관리 편집) */
export const GET = handler(async ({ user }) => listTeams(user));
export const POST = handler(async ({ req, user }) => createTeam(user, await body(req, teamInput), clientIp(req)));
