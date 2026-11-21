import { body, clientIp, handler } from '@/lib/api';
import { generateMonthly, monthlyInput } from '@/lib/branchReport';

/** #1096 2단계 월간 초안(양식 B·C) — 그 달 제출된 주간보고로. C(시설별 이용 현황)·미완료는 프로그램이 계산, B 세 칸만 AI. 초안만, 제출은 사람이 */
export const POST = handler(async ({ req, user }) => generateMonthly(user, await body(req, monthlyInput), clientIp(req)));
