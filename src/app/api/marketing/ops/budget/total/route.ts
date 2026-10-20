import { handler, body } from '@/lib/api';
import { budgetTotalInput, setBudgetTotal } from '@/lib/mktOps';

/** 대표 02:30 ③ [예산 총액 적기]: 대표가 적은 월 광고 예산 총액(회사 설정) + 그 달 월 운영 목표 광고비 연동 */
export const PUT = handler(async ({ req, user }) => setBudgetTotal(user, await body(req, budgetTotalInput)));
