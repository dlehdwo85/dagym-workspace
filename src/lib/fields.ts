import { z } from 'zod';
import { db } from './db';
import { atLeast, isUuid, loadTaskForUser } from './access';
import { badRequest, forbidden, notFound } from './errors';
import { activity } from './log';
import { getProjectOrThrow } from './tasks';
import type { SessionUser } from './types';
import { zUuid } from './api';

/** B-11 프로젝트별 사용자 지정 필드. 숫자 집계는 합계/평균/최소/최대 선택, 퍼센트는 기본 평균(Asana 는 퍼센트도 합계로 보여 170% 같은 값이 나옴) */
export const fieldInput = z.object({
  name: z.string().trim().min(1).max(40),
  type: z.enum(['select', 'number', 'percent', 'date', 'person', 'text']),
  options: z.array(z.object({ id: z.string().min(1).max(20), label: z.string().trim().min(1).max(30), color: z.string().regex(/^#[0-9a-fA-F]{6}$/) })).max(20).optional(),
  aggregate: z.enum(['none', 'sum', 'avg', 'min', 'max']).optional(),
  sort: z.number().optional(),
});
type Field = { id: string; project_id: string; name: string; type: string; options: { id: string; label: string; color: string }[]; aggregate: string };

const DEFAULT_AGG: Record<string, string> = { number: 'sum', percent: 'avg' };

async function editable(u: SessionUser, projectId: string) {
  const p = await getProjectOrThrow(u, projectId);
  if (p.limited || !(atLeast(u, 'site_manager') || p.owner_id === u.id)) throw forbidden('필드는 프로젝트 담당자나 관리자가 관리합니다');
}

export async function listFields(u: SessionUser, projectId: string) {
  await getProjectOrThrow(u, projectId);
  return db()<Field[]>`select id, project_id, name, type, options, aggregate, sort from project_fields where project_id = ${projectId} order by sort, created_at`;
}

export async function createField(u: SessionUser, projectId: string, i: z.infer<typeof fieldInput>) {
  await editable(u, projectId);
  if (i.type === 'select' && !i.options?.length) throw badRequest('선택형 필드는 선택지가 필요합니다');
  const agg = ['number', 'percent'].includes(i.type) ? (i.aggregate ?? DEFAULT_AGG[i.type]) : 'none';
  const sql = db();
  const [f] = await sql<{ id: string }[]>`insert into project_fields (project_id, name, type, options, aggregate, sort)
    values (${projectId}, ${i.name}, ${i.type}, ${sql.json((i.options ?? []) as never)}, ${agg},
      ${i.sort ?? sql`coalesce((select max(sort) from project_fields where project_id = ${projectId}), 0) + 1`}) returning id`;
  return { id: f.id };
}

async function loadField(id: string) {
  if (!isUuid(id)) throw notFound('필드가 없습니다');
  const [f] = await db()<Field[]>`select * from project_fields where id = ${id}`;
  if (!f) throw notFound('필드가 없습니다');
  return f;
}

export async function updateField(u: SessionUser, id: string, i: Partial<z.infer<typeof fieldInput>>) {
  const f = await loadField(id);
  await editable(u, f.project_id);
  if (i.type && i.type !== f.type) throw badRequest('필드 종류는 바꿀 수 없습니다. 새 필드를 만드세요.');
  const sql = db();
  const agg = ['number', 'percent'].includes(f.type) ? (i.aggregate ?? f.aggregate) : 'none';
  await sql`update project_fields set name = ${i.name ?? f.name}, options = ${sql.json((i.options ?? f.options) as never)}, aggregate = ${agg},
    sort = ${i.sort ?? sql`sort`} where id = ${id}`;
  return { ok: true };
}

export async function deleteField(u: SessionUser, id: string) {
  const f = await loadField(id);
  await editable(u, f.project_id);
  await db()`delete from project_fields where id = ${id}`;
  return { ok: true };
}

/** 업무의 필드 값 설정 (업무 수정 권한 + 같은 프로젝트 필드만, 형식 검사) */
export async function setFieldValue(u: SessionUser, taskId: string, fieldId: string, value: unknown) {
  const sql = db();
  const { task, perms } = await loadTaskForUser(u, taskId, sql);
  if (!perms.edit) throw forbidden();
  const f = await loadField(fieldId);
  if (f.project_id !== task.project_id) throw badRequest('이 업무의 프로젝트 필드가 아닙니다');
  let v: unknown = value;
  if (v === '' || v === undefined) v = null;
  if (v !== null) {
    switch (f.type) {
      case 'number': v = z.number().finite().parse(v); break;
      case 'percent': v = z.number().min(0).max(100).parse(v); break;
      case 'date': v = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(v); break;
      case 'person': v = zUuid.parse(v); if (!(await sql`select 1 from users where id = ${v as string} and status = 'active'`).length) throw badRequest('없는 사용자입니다'); break;
      case 'select': if (!f.options.some((o) => o.id === v)) throw badRequest('없는 선택지입니다'); break;
      case 'text': v = z.string().max(500).parse(v); break;
    }
  }
  const [before] = await sql`select value from task_field_values where task_id = ${taskId} and field_id = ${fieldId}`;
  if (v === null) await sql`delete from task_field_values where task_id = ${taskId} and field_id = ${fieldId}`;
  else await sql`insert into task_field_values (task_id, field_id, value) values (${taskId}, ${fieldId}, ${sql.json(v as never)})
    on conflict (task_id, field_id) do update set value = excluded.value, updated_at = now()`;
  await activity(sql, 'task', taskId, u.id, 'field_changed', { field: f.name, from: before?.value ?? null, to: v });
  return { ok: true };
}

/** 필드 집계 (섹션별 + 전체). 빈 값은 집계에서 뺀다 */
export async function fieldSummary(u: SessionUser, projectId: string) {
  const fields = await listFields(u, projectId);
  const sql = db();
  const rows = await sql<{ field_id: string; section_id: string | null; v: number }[]>`
    select fv.field_id, t.section_id, (fv.value #>> '{}')::numeric::float8 as v
    from task_field_values fv join tasks t on t.id = fv.task_id join project_fields f on f.id = fv.field_id
    where f.project_id = ${projectId} and f.type in ('number','percent') and t.deleted_at is null and t.parent_id is null`;
  const agg = (vals: number[], how: string) => {
    if (!vals.length || how === 'none') return null;
    if (how === 'sum') return vals.reduce((a, b) => a + b, 0);
    if (how === 'avg') return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
    if (how === 'min') return Math.min(...vals);
    return Math.max(...vals);
  };
  return fields.filter((f) => ['number', 'percent'].includes(f.type)).map((f) => {
    const mine = rows.filter((r) => r.field_id === f.id);
    const bySection: Record<string, number | null> = {};
    for (const s of new Set(mine.map((r) => r.section_id ?? 'none'))) bySection[s] = agg(mine.filter((r) => (r.section_id ?? 'none') === s).map((r) => r.v), f.aggregate);
    return { fieldId: f.id, name: f.name, type: f.type, aggregate: f.aggregate, total: agg(mine.map((r) => r.v), f.aggregate), count: mine.length, bySection };
  });
}
