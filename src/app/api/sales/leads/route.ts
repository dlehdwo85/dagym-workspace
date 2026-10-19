import { handler, body } from '@/lib/api';
import { createLead, leadCreate } from '@/lib/sales/cutover';

/** 새 리드(영업 전환 뒤 — 전에는 409) */
export const POST = handler(async ({ req, user }) => createLead(user, await body(req, leadCreate)));
