import { handler, body } from '@/lib/api';
import { addCost, costInput } from '@/lib/sales/work';

/** S2 2차 ROI: 영업비용 입력(관리자) */
export const POST = handler(async ({ req, user }) => addCost(user, await body(req, costInput)));
