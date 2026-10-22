import { handler, body } from '@/lib/api';
import { sendTestLead, testLeadInput } from '@/lib/metaLeads';

/** 광고 2차 ① [시험 리드 보내기](관리자) — Meta test_leads API 로 시험 리드를 만들고 바로 처리 */
export const POST = handler(async ({ req, user }) => sendTestLead(user, await body(req, testLeadInput)));
