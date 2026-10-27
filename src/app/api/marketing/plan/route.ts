import { handler } from '@/lib/api';
import { mktPlanView } from '@/lib/mktAuto';

/** 대표 10/27 ⑤: 사용량·요금제 화면의 '마케팅 제작 요금제' — 고르기·한도 고치기는 PUT /api/marketing/auto 그대로 */
export const GET = handler(async ({ user }) => mktPlanView(user));
