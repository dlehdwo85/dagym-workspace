import { handler } from '@/lib/api';
import { retryLead } from '@/lib/metaLeads';

/** 광고 2차 ① 실패·건너뜀 신청 [다시 처리](관리자) */
export const POST = handler<{ id: string }>(async ({ user, params }) => retryLead(user, params.id));
