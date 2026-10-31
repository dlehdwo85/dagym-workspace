// V30 ② 공지(게시판) + 읽음 확인 — 대상(전체/팀/사람)에게 알림·푸시, 읽은 사람/안 읽은 사람, 안 읽은 사람에게 다시 알림(하루 1번), 예약 게시(정기 실행), 상단 고정·중요, 자료실 첨부.
// 쓰기 = 메뉴 권한 notices(기본 대표·관리자·부서장·현장 관리자), 읽기 = 대상에 든 사람 + 관리자. 다른 회사 404.
import { z } from 'zod';
import { db, type Sql } from './db';
import { badRequest, forbidden, notFound } from './errors';
import { isAdmin, denyDemo } from './access';
import { RANK, menuLevel } from './menuPerms';
import { audit } from './log';
import { tenantOf, type SessionUser } from './types';

export const audienceInput = z.object({ type: z.enum(['all', 'teams', 'users']), ids: z.array(z.string().uuid()).max(200).default([]) });
export const noticeInput = z.object({
  title: z.string().trim().min(1, '제목을 넣어 주세요').max(200),
  body: z.string().max(20000).default(''),
  pinned: z.boolean().optional(),
  important: z.boolean().optional(),
  audience: audienceInput.default({ type: 'all', ids: [] }),
  fileIds: z.array(z.string().uuid()).max(20).optional(),
  /** 예약 게시 시각(비우면 바로) */
  publishAt: z.string().datetime({ offset: true }).optional().nullable(),
});
type Audience = z.infer<typeof audienceInput>;

async function canWrite(u: SessionUser, sql: Sql = db()) { return isAdmin(u) || RANK[await menuLevel(u, 'notices', sql)] >= RANK.use; }
/** 대상 사람 id 목록(작성자 제외 안 함) — 전체 = 회사 활성 사용자, 팀 = 팀원(하위 팀 포함 안 함), 사람 = 지정 */
export async function audienceUsers(sql: Sql, tenant: string, a: Audience): Promise<string[]> {
  if (a.type === 'all') return (await sql<{ id: string }[]>`select id from users where tenant = ${tenant} and status = 'active'`).map((r) => r.id);
  if (a.type === 'teams') {
    if (!a.ids.length) return [];
    return (await sql<{ user_id: string }[]>`select distinct m.user_id from team_members m join teams t on t.id = m.team_id join users us on us.id = m.user_id
      where t.tenant = ${tenant} and t.id = any(${a.ids}::uuid[]) and us.status = 'active'`).map((r) => r.user_id);
  }
  if (!a.ids.length) return [];
  return (await sql<{ id: string }[]>`select id from users where tenant = ${tenant} and id = any(${a.ids}::uuid[]) and status = 'active'`).map((r) => r.id);
}
/** 내가 볼 수 있는 공지 조건: 전체 · 내 팀 · 나 지정 · 내가 쓴 것 · 관리자 */
function visibleSql(sql: Sql, u: SessionUser) {
  if (isAdmin(u)) return sql`true`;
  return sql`(a.created_by = ${u.id} or a.audience->>'type' = 'all'
    or (a.audience->>'type' = 'teams' and exists (select 1 from team_members m where m.user_id = ${u.id} and m.team_id::text in (select jsonb_array_elements_text(a.audience->'ids'))))
    or (a.audience->>'type' = 'users' and a.audience->'ids' ? ${u.id}))`;
}
const ROW = (sql: Sql, u: SessionUser) => sql`a.id, a.title, a.body, a.pinned, a.important, a.audience, a.file_ids, a.publish_at, a.published, a.reminded_at, a.remind_count, a.created_by, a.created_at, a.updated_at,
  us.name as created_by_name, (r.user_id is not null) as read, r.read_at`;

export async function listNotices(u: SessionUser, f: { unread?: boolean; limit?: number } = {}) {
  const sql = db(); const t = tenantOf(u);
  const rows = await sql<any[]>`select ${ROW(sql, u)} from announcements a left join users us on us.id = a.created_by left join announcement_reads r on r.announcement_id = a.id and r.user_id = ${u.id}
    where a.tenant = ${t} and a.deleted_at is null and (a.published or a.created_by = ${u.id} or ${isAdmin(u)}) and ${visibleSql(sql, u)} ${f.unread ? sql`and r.user_id is null and a.published and a.created_by <> ${u.id}` : sql``}
    order by a.pinned desc, a.important desc, a.publish_at desc limit ${f.limit ?? 100}`;
  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int n from announcements a left join announcement_reads r on r.announcement_id = a.id and r.user_id = ${u.id}
    where a.tenant = ${t} and a.deleted_at is null and a.published and r.user_id is null and a.created_by <> ${u.id} and ${visibleSql(sql, u)}`;
  return { notices: rows.map((r) => ({ ...r, body: String(r.body).slice(0, 300), bodyMore: String(r.body).length > 300 })), unread: n, canWrite: await canWrite(u, sql) };
}
export async function getNotice(u: SessionUser, id: string, opt: { markRead?: boolean } = {}) {
  const sql = db(); const t = tenantOf(u);
  const [a] = await sql<any[]>`select ${ROW(sql, u)} from announcements a left join users us on us.id = a.created_by left join announcement_reads r on r.announcement_id = a.id and r.user_id = ${u.id}
    where a.id = ${id} and a.tenant = ${t} and a.deleted_at is null and ${visibleSql(sql, u)}`;
  if (!a || (!a.published && a.created_by !== u.id && !isAdmin(u))) throw notFound('공지가 없습니다');
  if (opt.markRead && !a.read && a.published) { await sql`insert into announcement_reads (announcement_id, user_id) values (${id}, ${u.id}) on conflict do nothing`; a.read = true; a.read_at = new Date(); }
  const files = a.file_ids?.length ? await sql<{ id: string; title: string; file_name: string; size_bytes: string; mime_type: string }[]>`select id, title, file_name, size_bytes, mime_type from library_files where id = any(${a.file_ids}::uuid[]) and deleted_at is null` : [];
  const mine = a.created_by === u.id || isAdmin(u);
  return { notice: a, files, canEdit: mine, canSeeReads: mine };
}
/** 읽음 현황(작성자·관리자): 읽은 사람·안 읽은 사람 */
export async function noticeReads(u: SessionUser, id: string) {
  const { notice, canSeeReads } = await getNotice(u, id);
  if (!canSeeReads) throw forbidden('작성자 또는 관리자만 읽음 현황을 볼 수 있습니다');
  const sql = db();
  const targets = (await audienceUsers(sql, tenantOf(u), notice.audience)).filter((x) => x !== notice.created_by);
  const people = targets.length ? await sql<{ id: string; name: string; title: string | null; read_at: Date | null }[]>`select us.id, us.name, us.title, r.read_at from users us left join announcement_reads r on r.announcement_id = ${id} and r.user_id = us.id
    where us.id = any(${targets}::uuid[]) order by r.read_at nulls first, us.name` : [];
  return { read: people.filter((p) => p.read_at), unread: people.filter((p) => !p.read_at), total: people.length, remindedAt: notice.reminded_at, remindCount: notice.remind_count };
}
async function notifyAudience(sql: Sql, tenant: string, a: { id: string; title: string; important: boolean; audience: Audience; created_by: string | null }, opt: { remind?: boolean } = {}) {
  const { notify } = await import('./notifications');
  let ids = await audienceUsers(sql, tenant, a.audience);
  if (opt.remind) { const read = (await sql<{ user_id: string }[]>`select user_id from announcement_reads where announcement_id = ${a.id}`).map((r) => r.user_id); ids = ids.filter((x) => !read.includes(x)); }
  // 로컬 10/20 알림 다이어트: 공지 푸시는 중요 공지·다시 알림만, 일반 공지는 목록·홈 카드
  return notify(sql, { push: !!(a.important || opt.remind), userIds: ids, type: 'announcement', title: `${opt.remind ? '[다시 알림] ' : ''}${a.important ? '[중요] ' : ''}공지: ${a.title}`, body: opt.remind ? '아직 읽지 않은 공지입니다. 열어서 확인해 주세요.' : '새 공지가 올라왔습니다.',
    link: `/notices/${a.id}`, entityType: 'announcement', entityId: a.id, actorId: a.created_by, dedupeKey: opt.remind ? `notice-remind:${a.id}:${Date.now()}` : `notice:${a.id}` });
}
export async function createNotice(u: SessionUser, i: z.infer<typeof noticeInput>, ip: string | null) {
  denyDemo(u);
  const sql = db(); const t = tenantOf(u);
  if (!(await canWrite(u, sql))) throw forbidden('공지 쓰기 권한이 없습니다. 대표에게 요청하세요(설정 > 메뉴 권한 > 공지 쓰기)');
  if (i.audience.type !== 'all' && !i.audience.ids.length) throw badRequest('대상 팀 또는 사람을 골라 주세요');
  if (i.fileIds?.length) { const { loadLibraryFile } = await import('./library'); for (const f of i.fileIds) await loadLibraryFile(u, f, 'meta'); }
  const at = i.publishAt ? new Date(i.publishAt) : new Date();
  const scheduled = at.getTime() > Date.now() + 60_000;
  const [a] = await sql<any[]>`insert into announcements (tenant, title, body, pinned, important, audience, file_ids, publish_at, published, created_by)
    values (${t}, ${i.title}, ${i.body}, ${!!i.pinned}, ${!!i.important}, ${sql.json(i.audience as never)}, ${i.fileIds ?? []}, ${scheduled ? at : sql`now()`}, ${!scheduled}, ${u.id}) returning id, title, important, audience, created_by, publish_at`;
  if (!scheduled) await notifyAudience(sql, t, a);
  await audit(sql, u.id, 'notice.create', 'announcement', a.id, { title: i.title, scheduled }, ip);
  return { id: a.id, scheduled, publishAt: a.publish_at, link: `/notices/${a.id}` };
}
export async function updateNotice(u: SessionUser, id: string, i: Partial<z.infer<typeof noticeInput>>, ip: string | null) {
  const { notice, canEdit } = await getNotice(u, id);
  if (!canEdit) throw forbidden('작성자 또는 관리자만 고칠 수 있습니다');
  const sql = db();
  const at = i.publishAt === undefined ? null : i.publishAt ? new Date(i.publishAt) : new Date();
  const scheduled = at ? at.getTime() > Date.now() + 60_000 : null;
  await sql`update announcements set title = ${i.title ?? notice.title}, body = ${i.body ?? notice.body}, pinned = ${i.pinned ?? notice.pinned}, important = ${i.important ?? notice.important},
    audience = ${i.audience ? sql.json(i.audience as never) : notice.audience}, file_ids = ${i.fileIds ?? notice.file_ids}, ${at ? sql`publish_at = ${at}, published = ${!scheduled},` : sql``} updated_at = now() where id = ${id}`;
  if (at && !scheduled && !notice.published) { const [a] = await sql<any[]>`select id, title, important, audience, created_by from announcements where id = ${id}`; await notifyAudience(sql, tenantOf(u), a); }
  await audit(sql, u.id, 'notice.update', 'announcement', id, { title: i.title }, ip);
  return getNotice(u, id);
}
export async function deleteNotice(u: SessionUser, id: string, ip: string | null) {
  const { canEdit } = await getNotice(u, id);
  if (!canEdit) throw forbidden('작성자 또는 관리자만 지울 수 있습니다');
  await db()`update announcements set deleted_at = now() where id = ${id}`;
  await audit(db(), u.id, 'notice.delete', 'announcement', id, {}, ip);
  return { ok: true };
}
export async function markRead(u: SessionUser, id: string) { await getNotice(u, id, { markRead: true }); return { ok: true }; }
/** 안 읽은 사람에게 다시 알림 — 하루 1번 */
export async function remindUnread(u: SessionUser, id: string, ip: string | null) {
  const { notice, canSeeReads } = await getNotice(u, id);
  if (!canSeeReads) throw forbidden('작성자 또는 관리자만 다시 알릴 수 있습니다');
  if (notice.reminded_at && Date.now() - new Date(notice.reminded_at).getTime() < 24 * 3600_000) throw badRequest('다시 알림은 하루에 한 번만 보낼 수 있습니다');
  const sql = db();
  const made = await notifyAudience(sql, tenantOf(u), notice, { remind: true });
  await sql`update announcements set reminded_at = now(), remind_count = remind_count + 1 where id = ${id}`;
  await audit(sql, u.id, 'notice.remind', 'announcement', id, { n: made.length }, ip);
  return { ok: true, notified: made.length };
}
/** 정기 실행: 예약 게시 시각이 된 공지를 게시하고 알림 */
export async function noticesJob() {
  const sql = db();
  const due = await sql<any[]>`update announcements set published = true where not published and deleted_at is null and publish_at <= now() returning id, tenant, title, important, audience, created_by`;
  for (const a of due) await notifyAudience(sql, a.tenant, a).catch(() => null);
  return { published: due.length };
}
