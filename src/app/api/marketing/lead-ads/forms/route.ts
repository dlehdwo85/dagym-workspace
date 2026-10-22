import { handler } from '@/lib/api';
import { leadForms } from '@/lib/metaLeads';

/** 광고 2차 ① 페이지의 리드 양식 목록(관리자, 시험 리드 보낼 양식 고르기) */
export const GET = handler(async ({ req, user }) => leadForms(user, req.nextUrl.searchParams.get('accountId') ?? ''));
