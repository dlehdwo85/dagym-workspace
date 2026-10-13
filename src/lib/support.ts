import { z } from 'zod';
import { db } from './db';
import { badRequest, notFound } from './errors';
import { notify } from './notifications';
import { tenantOf } from './library';
import type { SessionUser } from './types';

/** V12 3번 도움말·문의: 앱 안에서 문의 → 플랫폼 운영 화면 접수함 → 답변하면 문의한 사람에게 알림 */
export const ticketInput = z.object({
  category: z.enum(['question', 'bug', 'billing', 'idea']).default('question'),
  subject: z.string().trim().min(2).max(120), body: z.string().trim().min(2).max(5000), page: z.string().max(300).optional(),
});
export async function createTicket(u: SessionUser, i: z.infer<typeof ticketInput>) {
  const sql = db();
  const [t] = await sql<{ id: string }[]>`insert into support_tickets (tenant, user_id, category, subject, body, page) values (${tenantOf(u)}, ${u.id}, ${i.category}, ${i.subject}, ${i.body}, ${i.page ?? null}) returning id`;
  const admins = (await sql<{ id: string }[]>`select id from users where platform_admin and status = 'active'`).map((x) => x.id);
  await notify(sql, { userIds: admins, type: 'usage_alert', title: `새 문의: ${i.subject}`, body: `${u.name} · ${i.body.slice(0, 80)}`, link: '/platform#support',
    entityType: null as never, entityId: null as never, actorId: u.id, dedupeKey: `ticket:${t.id}` });
  return { id: t.id };
}
export async function myTickets(u: SessionUser) {
  return { tickets: await db()`select id, category, subject, body, status, answer, answered_at, created_at from support_tickets where user_id = ${u.id} order by created_at desc limit 50` };
}
export async function allTickets(u: SessionUser) {
  if (!u.platformAdmin) throw notFound();
  return { tickets: await db()`select t.*, u.name as user_name, u.email as user_email from support_tickets t left join users u on u.id = t.user_id order by (t.status = 'open') desc, t.created_at desc limit 200` };
}
export async function answerTicket(u: SessionUser, id: string, answer: string, close: boolean) {
  if (!u.platformAdmin) throw notFound();
  if (!answer.trim()) throw badRequest('답변을 입력하세요');
  const sql = db();
  const [t] = await sql<{ user_id: string | null; subject: string }[]>`update support_tickets set answer = ${answer.trim()}, status = ${close ? 'closed' : 'answered'}, answered_by = ${u.id}, answered_at = now()
    where id = ${id} returning user_id, subject`;
  if (!t) throw notFound();
  if (t.user_id) await notify(sql, { userIds: [t.user_id], type: 'usage_alert', title: `문의 답변: ${t.subject}`, body: answer.trim().slice(0, 120), link: '/help',
    entityType: null as never, entityId: null as never, actorId: u.id, dedupeKey: `ticket-ans:${id}:${Date.now()}` });
  return { ok: true };
}
