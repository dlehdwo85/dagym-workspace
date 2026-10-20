import { handler, body } from '@/lib/api';
import { isAdmin } from '@/lib/access';
import { forbidden } from '@/lib/errors';
import { tenantOf } from '@/lib/types';
import { opsView, propose, proposeInput } from '@/lib/mktOps';

/** 대표 10/20 20:00 ① 마케팅 운영실(AI 마케터): 화면 · [AI 마케터 제안 받기](관리자) */
export const GET = handler(async ({ req, user }) => opsView(user, req.nextUrl.searchParams.get('month') ?? undefined));
export const POST = handler(async ({ req, user }) => { if (!isAdmin(user)) throw forbidden('대표·관리자만'); const i = await body(req, proposeInput); return propose(tenantOf(user), i.kinds, user.id); });
