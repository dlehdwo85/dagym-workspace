import { body, handler } from '@/lib/api';
import { platformTrial, trialActionInput } from '@/lib/plans';

/** 17차: 체험 연장·종료·유료 전환 (플랫폼 운영자) */
export const POST = handler<{ tenant: string }>(async ({ req, user, params }) => platformTrial(user, params.tenant, await body(req, trialActionInput)));
