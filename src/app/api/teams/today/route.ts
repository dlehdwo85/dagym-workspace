import { handler } from '@/lib/api';
import { myTeamToday } from '@/lib/teams';

/** 홈 "우리 팀 오늘의 일정" */
export const GET = handler(async ({ user }) => myTeamToday(user));
