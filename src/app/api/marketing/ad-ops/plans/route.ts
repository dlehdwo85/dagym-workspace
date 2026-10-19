import { handler, body } from '@/lib/api';
import { createPlan, planInput } from '@/lib/adOps';

/** 세팅안 만들기(아직 네이버에는 안 만듦) */
export const POST = handler(async ({ req, user }) => createPlan(user, await body(req, planInput)));
