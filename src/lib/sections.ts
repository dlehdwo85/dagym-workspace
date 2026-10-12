import { z } from 'zod';
import { db } from './db';
import { atLeast, isUuid } from './access';
import { forbidden, notFound } from './errors';
import { activity } from './log';
import { getProjectOrThrow } from './tasks';
import type { SessionUser } from './types';

export const sectionInput = z.object({ name: z.string().trim().min(1).max(60), sort: z.number().optional() });

/** 섹션 편집: 프로젝트 담당자 또는 현장 관리자 이상(프로젝트 조직 접근 필요) */
async function assertEditable(u: SessionUser, projectId: string) {
  const p = await getProjectOrThrow(u, projectId);
  if (p.limited || !(atLeast(u, 'site_manager') || p.owner_id === u.id)) throw forbidden('섹션은 프로젝트 담당자나 관리자가 편집합니다');
  return p;
}

export async function listSections(u: SessionUser, projectId: string) {
  await getProjectOrThrow(u, projectId);
  return db()`select id, name, sort from project_sections where project_id = ${projectId} order by sort, created_at`;
}

export async function createSection(u: SessionUser, projectId: string, i: z.infer<typeof sectionInput>) {
  await assertEditable(u, projectId);
  const sql = db();
  const [s] = await sql<{ id: string }[]>`insert into project_sections (project_id, name, sort)
    values (${projectId}, ${i.name}, ${i.sort ?? sql`coalesce((select max(sort) from project_sections where project_id = ${projectId}), 0) + 1`}) returning id`;
  await activity(sql, 'project', projectId, u.id, 'section_created', { name: i.name });
  return { id: s.id };
}

async function loadSection(id: string) {
  if (!isUuid(id)) throw notFound('섹션이 없습니다');
  const [s] = await db()<{ id: string; project_id: string; name: string }[]>`select id, project_id, name from project_sections where id = ${id}`;
  if (!s) throw notFound('섹션이 없습니다');
  return s;
}

export async function updateSection(u: SessionUser, id: string, i: Partial<z.infer<typeof sectionInput>>) {
  const s = await loadSection(id);
  await assertEditable(u, s.project_id);
  const sql = db();
  await sql`update project_sections set name = ${i.name ?? s.name}, sort = coalesce(${i.sort ?? null}, sort) where id = ${id}`;
  if (i.name && i.name !== s.name) await activity(sql, 'project', s.project_id, u.id, 'section_renamed', { from: s.name, to: i.name });
  return { ok: true };
}

/** 섹션 삭제: 업무는 지우지 않고 '섹션 없음'으로 옮긴다 */
export async function deleteSection(u: SessionUser, id: string) {
  const s = await loadSection(id);
  await assertEditable(u, s.project_id);
  const sql = db();
  await sql`delete from project_sections where id = ${id}`;
  await activity(sql, 'project', s.project_id, u.id, 'section_deleted', { name: s.name });
  return { ok: true };
}
