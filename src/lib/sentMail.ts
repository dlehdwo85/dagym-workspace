// 375차 #997(대표 11/06 "메일 보낸 것들만 따로 모아서 볼 수 있도록 사이드바에 만들어 주세요"): 보낸 메일 모아 보기.
// 발송은 모두 outbox 한 표(업무 메일·문자/카톡 기록·견적·AI 비서 문자·시스템 메일) — 지금까지는 업무 상세 메일 칸에서만 보였다.
// 범위: 직원 = 내가 보낸 것, 대표·관리자 = 회사 전체도. 다른 회사 줄은 404. 시스템 자동 메일(company_key 없는 메일 = queueSystemMail)은 기본 빼고 관리자만 켬
import { z } from 'zod';
import { db } from './db';
import { notFound } from './errors';
import { isAdmin } from './access';
import { tenantOf, type SessionUser } from './types';

export const sentKinds = ['mail', 'sms', 'quote', 'ai', 'system'] as const;
export type SentKind = (typeof sentKinds)[number];
export const SENT_KIND_LABEL: Record<SentKind, string> = { mail: '업무 메일', sms: '문자·카카오톡', quote: '견적서', ai: 'AI 비서', system: '자동 메일' };
export const sentStatuses = ['sent', 'scheduled', 'waiting', 'failed', 'canceled'] as const;
export const sentQuery = z.object({
  q: z.string().trim().max(100).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum(sentStatuses).optional(),
  kind: z.enum(sentKinds).optional(),
  scope: z.enum(['mine', 'all']).optional(),
  system: z.enum(['0', '1']).optional(),
  offset: z.coerce.number().int().min(0).max(5000).optional(),
});

/** 줄 종류 — 업무 메일 = 메일 경로 + 회사 명함(company_key) · 자동 메일 = 메일 경로인데 명함 없음(queueSystemMail) ·
 *  AI 비서 = 업무 없이 남긴 문자(AI 비서 draft_sms) · 문자·카톡 = 사람이 휴대폰으로 보내고 [보냈어요] 누른 기록 · 견적서 = quote:* */
const KIND_SQL = `case when o.channel like 'quote:%' then 'quote'
  when o.channel like 'email:%' and o.company_key is null then 'system'
  when o.channel like 'email:%' then 'mail'
  when o.channel = 'sms:handoff' and o.task_id is null then 'ai'
  else 'sms' end`;
/** 보이는 상태 — 예약(아직 시각 전) · 대기(보내는 중·다시 시도 대기·문자 보낼 시간) · 보냄 · 실패 · 취소 */
const STATUS_SQL = `case when o.status = 'sent' then 'sent' when o.status = 'failed' then 'failed' when o.status = 'canceled' then 'canceled'
  when o.status = 'queued' and o.scheduled_at is not null and o.scheduled_at > now() then 'scheduled' else 'waiting' end`;
const VIA = (channel: string, personal: boolean) => channel === 'email:workin' ? '워크인 메일' : channel === 'email:smtp' ? (personal ? '내 메일 계정' : '회사 메일 계정')
  : channel === 'sms:handoff' ? '휴대폰 문자' : channel === 'kakao:handoff' ? '카카오톡' : channel.startsWith('quote:') ? `견적서(${({ share: '링크', mail: '메일', sms: '문자', download: '내려받기', kakao: '카카오톡' } as Record<string, string>)[channel.slice(6)] ?? channel.slice(6)})` : channel;

function scopeOf(u: SessionUser, q: { scope?: string; system?: string }) {
  const admin = isAdmin(u);
  return { admin, all: admin && q.scope === 'all', system: admin && q.system === '1' };
}

export async function listSent(u: SessionUser, q: z.infer<typeof sentQuery>) {
  const sql = db(); const t = tenantOf(u); const s = scopeOf(u, q);
  const kindExpr = () => sql.unsafe(KIND_SQL), statusExpr = () => sql.unsafe(STATUS_SQL);
  const like = q.q ? `%${q.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
  const fromAt = q.from ? `${q.from}T00:00:00+09:00` : null, toAt = q.to ? `${q.to}T23:59:59.999+09:00` : null;
  const limit = 50, offset = q.offset ?? 0;
  const rows = await sql<any[]>`select o.id, o.channel, o.status as raw_status, ${statusExpr()} as status, ${kindExpr()} as kind, o.to_addrs, o.cc_addrs, o.bcc_addrs, o.subject,
      left(o.body_text, 140) as preview, jsonb_array_length(coalesce(o.files, '[]'::jsonb)) as files, o.as_link, o.task_id, tk.title as task_title,
      o.created_by, u.name as sender_name, o.from_name, o.account_user_id is not null as personal, o.sent_at, o.scheduled_at, o.created_at, o.last_error, o.attempts,
      coalesce(o.sent_at, o.scheduled_at, o.created_at) as at
    from outbox o join users u on u.id = o.created_by left join tasks tk on tk.id = o.task_id
    where o.tenant = ${t}
      ${s.all ? sql`` : sql`and o.created_by = ${u.id}`}
      ${s.system ? sql`` : sql`and not (o.channel like 'email:%' and o.company_key is null)`}
      ${q.kind ? sql`and ${kindExpr()} = ${q.kind}` : sql``}
      ${q.status ? sql`and ${statusExpr()} = ${q.status}` : sql``}
      ${fromAt ? sql`and coalesce(o.sent_at, o.scheduled_at, o.created_at) >= ${fromAt}::timestamptz` : sql``}
      ${toAt ? sql`and coalesce(o.sent_at, o.scheduled_at, o.created_at) <= ${toAt}::timestamptz` : sql``}
      ${like ? sql`and (coalesce(o.subject, '') ilike ${like} or array_to_string(o.to_addrs || o.cc_addrs, ' ') ilike ${like} or coalesce(tk.title, '') ilike ${like} or coalesce(o.from_name, '') ilike ${like})` : sql``}
    order by coalesce(o.sent_at, o.scheduled_at, o.created_at) desc, o.id desc limit ${limit + 1} offset ${offset}`;
  const items = rows.slice(0, limit).map((r) => ({ id: r.id, kind: r.kind as SentKind, kindLabel: SENT_KIND_LABEL[r.kind as SentKind], status: r.status, at: r.at, sentAt: r.sent_at, scheduledAt: r.scheduled_at,
    to: r.to_addrs as string[], toCount: (r.to_addrs?.length ?? 0) + (r.cc_addrs?.length ?? 0) + (r.bcc_addrs?.length ?? 0), subject: r.subject, preview: r.preview,
    sender: r.sender_name, senderId: r.created_by, mine: r.created_by === u.id, via: VIA(r.channel, r.personal), files: Number(r.files) || 0, asLink: r.as_link,
    task: r.task_id ? { id: r.task_id, title: r.task_title ?? '(지운 업무)' } : null, error: r.status === 'failed' ? r.last_error : null }));
  return { items, more: rows.length > limit, offset, admin: s.admin, scope: s.all ? 'all' : 'mine', system: s.system, kinds: sentKinds.filter((k) => k !== 'system' || s.admin).map((k) => ({ key: k, label: SENT_KIND_LABEL[k] })) };
}

/** 한 줄 상세 — 본문 전체·받는 사람 전체·첨부·오류. 남의 줄은 관리자만(아니면 404), 다른 회사는 404 */
export async function getSent(u: SessionUser, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();
  const sql = db(); const admin = isAdmin(u);
  const kindExpr = () => sql.unsafe(KIND_SQL), statusExpr = () => sql.unsafe(STATUS_SQL);
  const [r] = await sql<any[]>`select o.*, ${statusExpr()} as vstatus, ${kindExpr()} as kind, u.name as sender_name, tk.title as task_title, s.first_opened_at
    from outbox o join users u on u.id = o.created_by left join tasks tk on tk.id = o.task_id left join share_links s on s.id = o.share_id
    where o.id = ${id} and o.tenant = ${tenantOf(u)}`;
  if (!r || (r.created_by !== u.id && !admin) || (r.kind === 'system' && !admin)) throw notFound();
  const files = (Array.isArray(r.files) ? r.files : []).map((f: any) => ({ name: String(f?.name ?? ''), size: Number(f?.size) || null, attachmentId: f?.attachmentId ?? null }));
  return { id: r.id, kind: r.kind as SentKind, kindLabel: SENT_KIND_LABEL[r.kind as SentKind], status: r.vstatus, channel: r.channel, via: VIA(r.channel, !!r.account_user_id),
    to: r.to_addrs ?? [], cc: r.cc_addrs ?? [], bcc: r.bcc_addrs ?? [], fromName: r.from_name, fromEmail: r.from_email, replyTo: r.reply_to, subject: r.subject, body: r.body_text,
    files, asLink: r.as_link, sender: r.sender_name, mine: r.created_by === u.id, sentAt: r.sent_at, scheduledAt: r.scheduled_at, createdAt: r.created_at, attempts: r.attempts,
    error: r.last_error, errorKind: r.error_kind, openedAt: r.first_opened_at, task: r.task_id ? { id: r.task_id, title: r.task_title ?? '(지운 업무)' } : null,
    can: { retry: r.vstatus === 'failed' && r.channel.startsWith('email:') && r.kind !== 'system', reschedule: r.vstatus === 'scheduled' && (r.created_by === u.id || u.role === 'owner'),
      resend: !!r.task_id && ['mail', 'sms'].includes(r.kind) && (r.created_by === u.id || admin) } };
}
