import { z } from 'zod';
import { body, handler } from '@/lib/api';
import { db } from '@/lib/db';
import { tenantOf } from '@/lib/types';

const n = z.number().int().min(0).max(100000).optional();
const input = z.object({
  event: z.enum(['received', 'cancel', 'lost', 'done']), where: z.enum(['task', 'chat']).optional(), kind: z.enum(['photo', 'video', 'camera', 'file']).optional(),
  count: n, bytes: z.number().min(0).max(1e12).optional(), sec: z.number().min(0).max(86400).nullable().optional(), ok: n, fail: n, firstError: z.string().max(160).nullable().optional(),
  kinds: z.object({ heic: n, jpeg: n, png: n, video: n, other: n }).optional(), ua: z.string().max(200).optional(), app: z.boolean().optional(),
});
/** 248차 #780: 휴대폰 사진 고르기 진단 — 받음·취소·화면 다시 열림·끝(파일 이름·사진 내용 없음). 오류 기록 표에 'diag:pick' 으로(알림 없음) · 한 사람 한 시간 60건까지 */
export const POST = handler(async ({ req, user }) => {
  const i = await body(req, input); const sql = db();
  const [{ c }] = await sql<{ c: number }[]>`select count(*)::int c from error_logs where source = 'diag:pick' and context->>'userId' = ${user.id} and created_at > now() - interval '1 hour'`;
  if (c >= 60) return { ok: false };
  const msg = `${i.event}${i.count != null ? ` ${i.count}개` : ''}${i.sec != null ? ` · ${i.sec}초` : ''}${i.fail ? ` · 실패 ${i.fail}` : ''}`;
  await sql`insert into error_logs (source, message, context) values ('diag:pick', ${msg}, ${sql.json({ ...i, userId: user.id, tenant: tenantOf(user) } as never)})`;
  return { ok: true };
});
