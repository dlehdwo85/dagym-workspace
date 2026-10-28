import { handler, body } from '@/lib/api';
import { handoff, handoffInput, handoffPeople } from '@/lib/sales/handoff';
import { bidSchedulePreview } from '@/lib/sales/bidTasks';

/** 대표 10/21 12:00 영업 재편 1): GET = 넘길 수 있는 담당자 목록(입찰이면 ?id= 로 만들 일정 미리 보기 — 242차 #761) · POST = [영업 진행으로 넘기기](리드·'영업 중'·담당 업무·일정·알림) */
export const GET = handler(async ({ req, user }) => {
  const sp = req.nextUrl.searchParams; const out = await handoffPeople(user, sp.get('kind'));
  const id = sp.get('id');
  return sp.get('kind') === 'bid' && id ? { ...out, schedule: await bidSchedulePreview(id) } : out;
});
export const POST = handler(async ({ req, user }) => handoff(user, await body(req, handoffInput)));
