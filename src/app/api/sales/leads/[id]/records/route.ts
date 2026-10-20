import { body, handler } from '@/lib/api';
import { addLeadRecord, recordInput } from '@/lib/sales/work';

/** S1-2 제안·계약 등록(리드에 딸린 기록) — 전환 전에는 409 */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => addLeadRecord(user, params.id, await body(req, recordInput)));
