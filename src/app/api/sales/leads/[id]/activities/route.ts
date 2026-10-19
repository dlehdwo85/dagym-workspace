import { handler, body } from '@/lib/api';
import { activityInput, addActivity } from '@/lib/sales/cutover';

/** 상담 기록 추가(영업 전환 뒤) */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => addActivity(user, params.id, await body(req, activityInput)));
