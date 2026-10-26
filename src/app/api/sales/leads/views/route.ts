import { body, handler } from '@/lib/api';
import { db } from '@/lib/db';
import { getLeadViews, leadViewsInput, saveLeadViews } from '@/lib/sales/leadList';
import { assertSpace } from '@/lib/spaces';

/** 197차(#461): 영업 진행 목록 — 내 저장된 보기·열(기기 간 유지). GET = 읽기 · PUT = 준 칸만 바꿈 */
export const GET = handler(async ({ user }) => { await assertSpace(user, 'sales'); return getLeadViews(db(), user.id); });
export const PUT = handler(async ({ req, user }) => saveLeadViews(user, await body(req, leadViewsInput)));
