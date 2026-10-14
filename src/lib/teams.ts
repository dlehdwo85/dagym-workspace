import { z } from 'zod';
import { db, type Sql } from './db';
import { badRequest, notFound } from './errors';
import { audit } from './log';
import { requireMenu } from './menuPerms';
import { todaySeoul } from './time';
import type { SessionUser } from './types';

/**
 * V14 8번 팀: 조직 구성(org_units — 본사·지점·현장, 데이터 접근 범위)과 별개인 업무 묶음(마케팅팀·운영팀…).
 * 한 사람이 여러 팀, 팀장 1명 이상. 팀을 만들면 팀 대화방이 자동으로 생기고 팀원이 바뀌면 대화방 멤버도 맞춘다.
 * 팀 관리 = 메뉴 권한 "사용자 관리"(조회/편집). 팀 업무 열람·편집 = "팀 업무"·"다른 팀 업무 보기"(access.ts).
 */
import { tenantOf } from './types';

export async function listTeams(u: SessionUser) {
  const sql = db();
  const teams = await sql`select t.id, t.name, t.color, t.parent_id,
      coalesce(json_agg(json_build_object('id', us.id, 'name', us.name, 'title', us.title, 'lead', m.is_lead) order by m.is_lead desc, us.name) filter (where us.id is not null), '[]') as members,
      bool_or(m.user_id = ${u.id}) as mine, bool_or(m.user_id = ${u.id} and m.is_lead) as i_lead,
      (select id from chat_rooms r where r.team_id = t.id) as room_id
    from teams t left join team_members m on m.team_id = t.id left join users us on us.id = m.user_id and us.status = 'active'
    where t.tenant = ${tenantOf(u)} and not t.archived group by t.id order by t.name`;
  return { teams };
}

export const teamInput = z.object({
  name: z.string().trim().min(1).max(40),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#0F766E'),
  members: z.array(z.object({ userId: z.string().uuid(), lead: z.boolean().default(false) })).max(200),
  /** R-16 상위 팀(관리 팀): 그 팀 구성원은 이 팀 업무 전체를 보고·고치고·배정 */
  parentId: z.string().uuid().nullable().optional(),
});
/** 상위 팀 검사: 같은 회사, 자기 자신·자기 하위 팀은 안 됨(순환 방지) */
async function checkParent(sql: Sql, u: SessionUser, teamId: string | null, parentId: string | null | undefined) {
  if (!parentId) return;
  const [p] = await sql`select 1 from teams where id = ${parentId} and tenant = ${tenantOf(u)} and not archived`;
  if (!p) throw badRequest('상위 팀이 없습니다');
  if (!teamId) return;
  const cyc = await sql`with recursive d as (select id from teams where id = ${teamId} union select c.id from teams c join d on c.parent_id = d.id) select 1 from d where id = ${parentId}`;
  if (cyc.length) throw badRequest('자기 자신이나 하위 팀을 상위 팀으로 정할 수 없습니다');
}
async function syncMembers(sql: Sql, u: SessionUser, teamId: string, members: z.infer<typeof teamInput>['members']) {
  if (!members.some((m) => m.lead)) throw badRequest('팀장을 1명 이상 정하세요');
  const ids = [...new Set(members.map((m) => m.userId))];
  const ok = await sql<{ id: string }[]>`select id from users where id = any(${ids}::uuid[]) and status = 'active' and tenant = ${tenantOf(u)}`;
  if (ok.length !== ids.length) throw badRequest('넣을 수 없는 사람이 있습니다');
  await sql`delete from team_members where team_id = ${teamId} and not (user_id = any(${ids}::uuid[]))`;
  for (const m of members) await sql`insert into team_members (team_id, user_id, is_lead) values (${teamId}, ${m.userId}, ${m.lead})
    on conflict (team_id, user_id) do update set is_lead = excluded.is_lead`;
  // 팀 대화방: 없으면 만들고 멤버를 팀원과 같게
  await sql`insert into chat_rooms (tenant, kind, name, team_id, created_by) select ${tenantOf(u)}, 'team', t.name, t.id, ${u.id} from teams t where t.id = ${teamId}
    on conflict (team_id) where team_id is not null do update set name = excluded.name`;
  const [room] = await sql<{ id: string }[]>`select id from chat_rooms where team_id = ${teamId}`;
  await sql`delete from chat_members where room_id = ${room.id} and not (user_id = any(${ids}::uuid[]))`;
  for (const id of ids) await sql`insert into chat_members (room_id, user_id) values (${room.id}, ${id}) on conflict do nothing`;
}
export async function createTeam(u: SessionUser, i: z.infer<typeof teamInput>, ip: string | null) {
  await requireMenu(u, 'admin_users', 'edit');
  const sql = db();
  return sql.begin(async (tx) => {
    await checkParent(tx as unknown as Sql, u, null, i.parentId);
    const [t] = await tx<{ id: string }[]>`insert into teams (tenant, name, color, created_by, parent_id) values (${tenantOf(u)}, ${i.name}, ${i.color}, ${u.id}, ${i.parentId ?? null}) returning id`
      .catch((e: any) => { throw e?.code === '23505' ? badRequest('같은 이름의 팀이 있습니다') : e; });
    await syncMembers(tx as unknown as Sql, u, t.id, i.members);
    await audit(tx as unknown as Sql, u.id, 'team.create', 'team', t.id, { name: i.name, members: i.members.length }, ip);
    return { id: t.id };
  });
}
export async function updateTeam(u: SessionUser, id: string, i: Partial<z.infer<typeof teamInput>> & { archived?: boolean }, ip: string | null) {
  await requireMenu(u, 'admin_users', 'edit');
  const sql = db();
  const [t] = await sql<{ id: string; name: string; color: string }[]>`select id, name, color from teams where id = ${id} and tenant = ${tenantOf(u)}`;
  if (!t) throw notFound('팀이 없습니다');
  return sql.begin(async (tx) => {
    if (i.parentId !== undefined) { await checkParent(tx as unknown as Sql, u, id, i.parentId); await tx`update teams set parent_id = ${i.parentId} where id = ${id}`; }
    await tx`update teams set name = ${i.name ?? t.name}, color = ${i.color ?? t.color}, archived = ${i.archived ?? false} where id = ${id}`;
    if (i.members) await syncMembers(tx as unknown as Sql, u, id, i.members);
    else if (i.name) await tx`update chat_rooms set name = ${i.name} where team_id = ${id}`;
    await audit(tx as unknown as Sql, u.id, i.archived ? 'team.archive' : 'team.update', 'team', id, { name: i.name, members: i.members?.length }, ip);
    return { ok: true };
  });
}

/** 홈 "우리 팀 오늘 할 일": 내가 속한 팀의 오늘 마감·기한 지남·진행 중 업무 (볼 수 있는 것만) */
export async function myTeamToday(u: SessionUser) {
  const sql = db();
  const teams = await sql<{ id: string; name: string; color: string }[]>`select t.id, t.name, t.color from teams t join team_members m on m.team_id = t.id
    where m.user_id = ${u.id} and not t.archived order by t.name`;
  if (!teams.length) return { teams: [], tasks: [] };
  const { listTasks, listQuery } = await import('./tasks');
  const today = todaySeoul();
  const out: any[] = [];
  for (const t of teams) {
    const r: any[] = await listTasks(u, listQuery.parse({ teamId: t.id, includeDone: '0', limit: 100 })).catch(() => []);
    for (const x of r) if (!x.due_date || x.due_date <= today || x.status === 'in_progress') out.push(x);
  }
  return { teams, tasks: out.slice(0, 50) };
}
