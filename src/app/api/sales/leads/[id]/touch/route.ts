import { handler, body } from '@/lib/api';
import { touchInput, touchLead } from '@/lib/metaLeads';

/** 광고 2차 ① 리드 상세 [전화]·[문자] 누름 = 리드 광고 신청의 첫 연락 시각(영업 공간) */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => touchLead(user, params.id, await body(req, touchInput)));
