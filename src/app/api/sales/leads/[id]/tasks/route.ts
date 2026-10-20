import { handler, body } from '@/lib/api';
import { addLeadTask, leadTaskInput } from '@/lib/sales/cutover';

/** S2 2차: 리드 상세 '업무' 탭에서 업무 추가(space sales, lead_id 연결) */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => addLeadTask(user, params.id, await body(req, leadTaskInput)));
