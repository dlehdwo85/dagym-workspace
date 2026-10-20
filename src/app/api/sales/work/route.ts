import { body, handler } from '@/lib/api';
import { saveWork, workInput } from '@/lib/sales/work';

/** S1-2 진행 기록 쓰기(입찰·신규단지·준공 시설·협력사): 상태·메모·다음 연락일 — 전환 전에는 409 */
export const POST = handler(async ({ req, user }) => saveWork(user, await body(req, workInput)));
