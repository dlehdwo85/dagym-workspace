import { clientIp, handler } from '@/lib/api';
import { deleteReport, getReport, saveReport } from '@/lib/branchReport';

/** #1096 보고서 보기·고치기(초안만) */
export const GET = handler<{ id: string }>(async ({ user, params }) => getReport(user, params.id));
export const PUT = handler<{ id: string }>(async ({ req, user, params }) => saveReport(user, params.id, await req.json().catch(() => ({})), clientIp(req)));
/** D-01(대표 11/23): 지우기 — 초안 = 만든 사람·관리자, 제출본 = 대표만 · 휴지통 기록 30일 */
export const DELETE = handler<{ id: string }>(async ({ req, user, params }) => deleteReport(user, params.id, clientIp(req)));
