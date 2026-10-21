import { handler, body } from '@/lib/api';
import { addLeadEvent, leadEventInput } from '@/lib/sales/cutover';

/** 영업 재편 5): 리드 상세 '진행'·'일정' 탭에서 일정 추가(회사 공용 캘린더, lead_id 연결, 참석 = 리드 담당) */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => addLeadEvent(user, params.id, await body(req, leadEventInput)));
