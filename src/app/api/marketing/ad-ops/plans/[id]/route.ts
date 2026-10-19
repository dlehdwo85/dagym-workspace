import { handler, body } from '@/lib/api';
import { planInput, updatePlan } from '@/lib/adOps';

/** 세팅안 고치기(만들기 전·실패 뒤) */
export const PUT = handler<{ id: string }>(async ({ req, user, params }) => updatePlan(user, params.id, await body(req, planInput)));
