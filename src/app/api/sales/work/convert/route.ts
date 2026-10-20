import { body, handler } from '@/lib/api';
import { convertInput, convertToLead } from '@/lib/sales/work';

/** S1-2 [진행영업으로 넘기기]: 비슷한 이름 리드가 있으면 { similar } (force 로 그래도 새로 만들기) → { leadId } */
export const POST = handler(async ({ req, user }) => convertToLead(user, await body(req, convertInput)));
