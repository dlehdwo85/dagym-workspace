import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { db } from '@/lib/db';
import { recordStep } from '@/lib/funnel';
import { tenantOf } from '@/lib/types';

/**
 * V15 첫 로그인 안내 → V32 3: ③ 연락 채널(회사를 만든 사람에게만 "가입 이메일을 회신 주소로?"·휴대폰) · ④ 동료 초대 완료 표시 · 끝내기(공간 대표만)
 * 초대받아 합류한 직원에게는 묻지 않는다(V32 6) — 화면이 회사 대표에게만 띄움 + 서버도 대표만 기록
 */
export const POST = handler(async ({ req, user }) => {
  const i = await body(req, z.object({
    name: z.string().trim().min(1).max(50).optional(), title: z.string().trim().max(50).optional(), done: z.boolean().optional(),
    channels: z.object({ replyTo: z.enum(['signup', 'other']), workEmail: z.string().trim().email('이메일 형식이 아닙니다').max(200).optional(), phone: z.string().trim().max(40).optional() }).optional(),
    invited: z.boolean().optional(),
  }));
  const sql = db(); const t = tenantOf(user);
  const [own] = await sql<{ id: string }[]>`select id from tenants where id = ${t} and owner_user_id = ${user.id}`;
  if (i.name || i.title !== undefined) await sql`update users set name = coalesce(${i.name ?? null}, name), title = coalesce(${i.title ?? null}, title), updated_at = now() where id = ${user.id}`;
  if (i.channels && own) {
    const work = i.channels.replyTo === 'signup' ? user.email : i.channels.workEmail;
    await sql`update users set work_email = coalesce(${work ?? null}, work_email), phone = coalesce(nullif(${i.channels.phone ?? ''}, ''), phone), updated_at = now() where id = ${user.id}`;
    await recordStep('channels_done', { tenant: t }, sql);
  }
  if (i.invited && own) await recordStep('invite_done', { tenant: t }, sql);
  if (i.done) await sql`update tenants set onboarded_at = coalesce(onboarded_at, now()) where id = ${t} and owner_user_id = ${user.id}`;
  return { ok: true };
});

/** V32 3 연결 상태(홈 "연결하면 좋아요"·첫 로그인 안내) */
export const GET = handler(async ({ user }) => {
  const sql = db(); const t = tenantOf(user);
  const { pickChannel } = await import('@/lib/mailbox');
  const [[me], [{ n }], [k]] = await Promise.all([
    sql<{ work_email: string | null; phone: string | null; email: string }[]>`select work_email, phone, email from users where id = ${user.id}`,
    sql<{ n: number }[]>`select count(*)::int n from users where tenant = ${t} and status in ('active', 'invited')`,
    sql<{ x: number }[]>`select 1 x from user_identities where user_id = ${user.id} and provider = 'kakao' limit 1`,
  ]);
  return { email: me?.email ?? user.email, workEmail: me?.work_email ?? null, phone: me?.phone ?? null, mailChannel: await pickChannel(t, sql), kakaoLinked: !!k, people: n,
    admin: ['owner', 'admin'].includes(user.role) };
});
