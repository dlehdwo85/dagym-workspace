import { handler } from '@/lib/api';
import { metaLeadForms } from '@/lib/metaAuto';

/** 페이지의 리드 양식 목록(고르기용) */
export const GET = handler(async ({ req, user }) => metaLeadForms(user, new URL(req.url).searchParams.get('pageAccountId') ?? ''));
