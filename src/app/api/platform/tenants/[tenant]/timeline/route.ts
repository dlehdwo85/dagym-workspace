import { handler } from '@/lib/api';
import { companyTimeline } from '@/lib/customerOps';

/** #1163 ③ 회사 타임라인 — GET ?kinds=pay,refund,… (비우면 전부, 플랫폼 운영자만) */
export const GET = handler<{ tenant: string }>(async ({ req, user, params }) => companyTimeline(user, params.tenant, req.nextUrl.searchParams.get('kinds')));
