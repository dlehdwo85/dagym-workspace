// #1129(대표 11/23 '두 가지 다 고를 수 있게, 고르는 건 자료실 설정에서'): 자료실·업무 공개 방식 — 회사 설정 하나
//  · 'team'(기본 · 지금 동작): 업무는 부서·팀 단위, 자료실 '우리 팀' 자료는 그 팀만
//  · 'company'(회사 전체 공유): 같은 회사 사람이 다른 부서·팀 업무와 '우리 팀' 자료도 봄(보기·댓글만 — 고치기 권한은 그대로)
//  항상 막힘: 격리 팀('회사 안의 작은 회사'), 기밀 등급, 내 파일, 다른 회사. 항목마다: share = null(회사 설정 따름)·'team'·'company'
//  바꾸기 = 대표만(회사 전체에 보이는 범위가 바뀌므로), 바꾸기 전 영향 건수 미리 보기, 감사 기록
import { z } from 'zod';
import { db } from './db';
import { badRequest, forbidden, notFound } from './errors';
import { audit } from './log';
import { loadTaskForUser } from './access';
import { tenantOf, type SessionUser } from './types';

export type ShareMode = 'team' | 'company';
export const shareModeInput = z.object({ mode: z.enum(['team', 'company']) });
export const itemShareInput = z.object({ share: z.enum(['team', 'company']).nullable() });

const canSet = (u: SessionUser) => u.role === 'owner' && !u.isDemo && !u.support;

/** 회사 설정에 따라 보이는 범위가 바뀌는 항목 수(항목마다 정한 것은 빼고) — 바꾸기 전 미리 보기 */
async function affected(tenant: string) {
  const sql = db();
  const [r] = await sql<{ tasks: number; files: number; pinned_tasks: number; pinned_files: number }[]>`select
    (select count(*)::int from tasks t where t.deleted_at is null and t.share is null and (
      (t.team_id is null and exists (select 1 from org_units cu where cu.id = t.org_unit_id and cu.tenant = ${tenant} and not cu.is_demo))
      or (t.team_id is not null and exists (select 1 from teams ct where ct.id = t.team_id and ct.tenant = ${tenant} and not ct.isolated and not ct.archived)))) as tasks,
    (select count(*)::int from library_files f where f.tenant = ${tenant} and f.deleted_at is null and f.scope = 'team' and f.share is null
      and exists (select 1 from teams st where st.id = f.team_id and not st.isolated and not st.archived)) as files,
    (select count(*)::int from tasks t where t.deleted_at is null and t.share is not null and (
      exists (select 1 from org_units cu where cu.id = t.org_unit_id and cu.tenant = ${tenant}) or exists (select 1 from teams ct where ct.id = t.team_id and ct.tenant = ${tenant}))) as pinned_tasks,
    (select count(*)::int from library_files f where f.tenant = ${tenant} and f.deleted_at is null and f.share is not null) as pinned_files`;
  return { tasks: r.tasks, files: r.files, pinnedTasks: r.pinned_tasks, pinnedFiles: r.pinned_files };
}

export async function getShareMode(u: SessionUser) {
  const t = tenantOf(u);
  const [r] = await db()<{ share_mode: ShareMode }[]>`select share_mode from tenants where id = ${t}`;
  const mode = r?.share_mode ?? 'team';
  return { mode, canEdit: canSet(u), ...(canSet(u) ? { affected: await affected(t) } : {}) };
}

export async function setShareMode(u: SessionUser, i: z.infer<typeof shareModeInput>, ip: string | null) {
  if (!canSet(u)) throw forbidden('공개 방식은 대표만 바꿀 수 있습니다');
  const sql = db();
  const t = tenantOf(u);
  const [r] = await sql<{ share_mode: ShareMode }[]>`select share_mode from tenants where id = ${t}`;
  if (!r) throw notFound();
  if (r.share_mode === i.mode) return { mode: i.mode, changed: false };
  const a = await affected(t);
  await sql`update tenants set share_mode = ${i.mode} where id = ${t}`;
  await audit(sql, u.id, 'org.share_mode', 'tenant', t, { from: r.share_mode, to: i.mode, tasks: a.tasks, files: a.files }, ip);
  return { mode: i.mode, changed: true, affected: a };
}

/** 업무 한 건의 공개 범위 — 그 업무를 고칠 수 있는 사람(요청자·담당자) 또는 대표·관리자 */
export async function setTaskShare(u: SessionUser, taskId: string, i: z.infer<typeof itemShareInput>, ip: string | null) {
  const { task, perms } = await loadTaskForUser(u, taskId);
  if (!perms.edit && !['owner', 'admin'].includes(u.role)) throw forbidden('이 업무의 공개 범위는 요청자·담당자·관리자만 바꿀 수 있습니다');
  const sql = db();
  const [cur] = await sql<{ share: string | null }[]>`select share from tasks where id = ${task.id}`;
  await sql`update tasks set share = ${i.share} where id = ${task.id}`;
  await audit(sql, u.id, 'task.share', 'task', task.id, { from: cur?.share ?? null, to: i.share }, ip);
  return { ok: true, share: i.share };
}

/** '우리 팀' 자료 한 건의 공개 범위 — 올린 사람 또는 대표·관리자 */
export async function setFileShare(u: SessionUser, fileId: string, i: z.infer<typeof itemShareInput>, ip: string | null) {
  const { loadLibraryFile } = await import('./library');
  const f = await loadLibraryFile(u, fileId, 'meta');
  if (f.scope !== 'team') throw badRequest("공개 범위는 '우리 팀' 자료에만 정합니다(회사 전체·내 파일은 옮기기로 바꿉니다)");
  if (f.created_by !== u.id && !['owner', 'admin'].includes(u.role)) throw forbidden('올린 사람 또는 관리자만 바꿀 수 있습니다');
  const sql = db();
  await sql`update library_files set share = ${i.share} where id = ${f.id}`;
  await audit(sql, u.id, 'library.share', 'library_file', f.id, { from: f.share ?? null, to: i.share }, ip);
  return { ok: true, share: i.share };
}
