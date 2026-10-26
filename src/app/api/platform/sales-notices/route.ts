import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { db } from '@/lib/db';
import { notFound } from '@/lib/errors';
import { audit } from '@/lib/log';
import { refitNotices } from '@/lib/sales/collectors/store';
import { lookupNotices } from '@/lib/sales/noticeDiag';

export const maxDuration = 60;
/** 185차(로컬 10/26 19:20 A4): 플랫폼 운영자 — 공고 번호·제목으로 영업 DB 줄 찾기(사라진·합쳐진 줄 포함, 원천·판정·목록에서 빠지는 이유) */
export const GET = handler(async ({ req, user }) => {
  if (!user.platformAdmin) throw notFound();
  const u = new URL(req.url);
  return lookupNotices({ no: u.searchParams.get('no'), q: u.searchParams.get('q') });
});
/** 지금 규칙으로 '관련 아님' 줄 다시 판정(올리기만) — 수집기 실행 때도 자동으로 돎. days = 처음 본 때 기준 최근 n일(기본 120) */
const input = z.object({ refit: z.literal(true), days: z.number().int().min(1).max(1100).optional() });
export const POST = handler(async ({ req, user }) => {
  if (!user.platformAdmin) throw notFound();
  const i = await body(req, input);
  const r = await refitNotices({ days: i.days });
  await audit(db(), user.id, 'platform.sales_notices.refit', 'sales_src_rows', null, { days: i.days ?? 120, checked: r.checked, raised: r.raised, reopened: r.reopened }).catch(() => {});
  return { checked: r.checked, raised: r.raised, reopened: r.reopened };
});
