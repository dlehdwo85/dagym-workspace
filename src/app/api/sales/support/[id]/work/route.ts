import { handler, body } from '@/lib/api';
import { saveWork, workInput } from '@/lib/sales/support';

/** #450 진행: 관심·신청 준비(담당 업무·체크리스트·마감 알림) → 신청 완료 → 선정·탈락(결과 메모)·포기 */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => saveWork(user, params.id, await body(req, workInput)));
