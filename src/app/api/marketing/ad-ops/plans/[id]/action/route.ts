import { handler, body } from '@/lib/api';
import { actPlan, planAction } from '@/lib/adOps';

/** 켜기(상한 검사)·끄기·하루 예산 변경 — 모두 변경 기록 */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => actPlan(user, params.id, await body(req, planAction)));
