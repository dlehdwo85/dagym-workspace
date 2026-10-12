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
}

export async function activity(
  sql: Sql,
  entityType: 'task' | 'event' | 'attachment' | 'project',
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
