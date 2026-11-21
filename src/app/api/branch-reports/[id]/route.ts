import { clientIp, handler } from '@/lib/api';
import { getReport, saveReport } from '@/lib/branchReport';

/** #1096 보고서 보기·고치기(초안만) */
export const GET = handler<{ id: string }>(async ({ user, params }) => getReport(user, params.id));
export const PUT = handler<{ id: string }>(async ({ req, user, params }) => saveReport(user, params.id, await req.json().catch(() => ({})), clientIp(req)));
