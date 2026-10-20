import { handler } from '@/lib/api';
import { deleteRecord } from '@/lib/sales/work';

/** S2 2차: 제안·계약·비용 기록 삭제 */
export const DELETE = handler<{ id: string }>(async ({ user, params }) => deleteRecord(user, params.id));
