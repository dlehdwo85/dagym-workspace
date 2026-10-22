import { handler, body } from '@/lib/api';
import { setTargetCpa, targetCpaInput } from '@/lib/adLeads';

/** 광고 최적화 1차 ③ 목표 전환당 비용(원, 관리자, null = 기간 평균) */
export const PUT = handler(async ({ req, user }) => setTargetCpa(user, await body(req, targetCpaInput)));
