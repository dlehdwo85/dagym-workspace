import { handler, body } from '@/lib/api';
import { handoff, handoffInput, handoffPeople } from '@/lib/sales/handoff';

/** 대표 10/21 12:00 영업 재편 1): GET = 넘길 수 있는 담당자 목록 · POST = [영업 진행으로 넘기기](리드·'영업 중'·담당 업무·일정·알림) */
export const GET = handler(async ({ req, user }) => handoffPeople(user, req.nextUrl.searchParams.get('kind')));
export const POST = handler(async ({ req, user }) => handoff(user, await body(req, handoffInput)));
