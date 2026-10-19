import { handler } from '@/lib/api';
import { recentActivity } from '@/lib/activity';

/** 로컬 10/19(대표) 홈 개편: 알림 › '활동' 탭 — 최근 30일 업무 생성·완료·댓글(보이는 업무만) */
export const GET = handler(async ({ user }) => ({ items: await recentActivity(user, { limit: 60 }) }));
