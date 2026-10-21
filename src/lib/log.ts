import { db, type Sql } from './db';

export async function logError(source: string, err: unknown, context: Record<string, unknown> = {}) {
  const e = err as Error;
  console.error(`[${source}]`, e?.message ?? err, context);
  try {
    await db()`insert into error_logs (source, message, stack, context)
      values (${source}, ${String(e?.message ?? err).slice(0, 2000)}, ${e?.stack?.slice(0, 8000) ?? null}, ${db().json(context as never)})`;
  } catch {
    // DB 장애 시에도 원래 오류 처리를 막지 않는다
  }
  // V15 오류 알림: 플랫폼 운영자에게만(#104 ③ — 고객사 관리자에게는 가지 않음) 같은 출처는 30분에 1번(앱 푸시·알림함)
  try {
    const sql = db();
    const admins = (await sql<{ id: string }[]>`select id from users where platform_admin and status = 'active'`).map((x) => x.id);
    if (admins.length) {
      const { notify } = await import('./notifications');
      await notify(sql, { userIds: admins, type: 'server_error', title: `서버 오류 (${source})`, body: String(e?.message ?? err).slice(0, 140), link: '/admin/ops',
        entityType: null as never, entityId: null as never, actorId: null, dedupeKey: `err:${source}:${Math.floor(Date.now() / 1800000)}` });
    }
  } catch {}
}

export async function activity(
  sql: Sql,
  entityType: 'task' | 'event' | 'attachment' | 'project' | 'contact',
  entityId: string,
  actorId: string | null,
  action: string,
  changes: Record<string, unknown> = {},
) {
  await sql`insert into activities (entity_type, entity_id, actor_id, action, changes)
    values (${entityType}, ${entityId}, ${actorId}, ${action}, ${sql.json(changes as never)})`;
}

export async function audit(
  sql: Sql,
  actorId: string | null,
  action: string,
  targetType: string | null,
  targetId: string | null,
  detail: Record<string, unknown> = {},
  ip: string | null = null,
) {
  await sql`insert into audit_logs (actor_id, action, target_type, target_id, detail, ip)
    values (${actorId}, ${action}, ${targetType}, ${targetId}, ${sql.json(detail as never)}, ${ip})`;
}
