import { z } from 'zod';
import { db, type Sql } from './db';
import { badRequest, notFound } from './errors';
import { audit } from './log';
import { requireMenu } from './menuPerms';
import { todaySeoul } from './time';
import { GENERIC_ORG, KIND_LABEL, LEAD_TITLE, ORG_KINDS, PARENT_KINDS, canParent, eulReul, topAllowed, type OrgKind } from './orgKinds';
import type { SessionUser } from './types';

/**
 * V14 8번 팀: 조직 구성(org_units — 본사·지점·현장, 데이터 접근 범위)과 별개인 업무 묶음(마케팅팀·운영팀…).
 * 한 사람이 여러 팀, 팀장 1명 이상. 팀을 만들면 팀 대화방이 자동으로 생기고 팀원이 바뀌면 대화방 멤버도 맞춘다.
 * 팀 관리 = 메뉴 권한 "사용자 관리"(조회/편집). 팀 업무 열람·편집 = "팀 업무"·"다른 팀 업무 보기"(access.ts).
 */
import { tenantOf } from './types';

export async function listTeams(u: SessionUser) {
  const sql = db();
  // 대표 10/20 15:15 재정비: 트리(부서 › 하위 부서 › 팀) — path(경로 "영업부 › 영업1팀")·depth 로 들여쓰기, 경로순 정렬
  const teams = await sql`with recursive tr as (
      select t.id, t.name::text as path, 0 as depth, t.name::text as sort_key from teams t where t.tenant = ${tenantOf(u)} and not t.archived and t.parent_id is null
      union all select c.id, tr.path || ' › ' || c.name, tr.depth + 1, tr.sort_key || '/' || c.name from teams c join tr on c.parent_id = tr.id where not c.archived)
    select t.id, t.name, t.color, t.parent_id, t.kind, t.isolated, t.default_spaces, (select p.name from teams p where p.id = t.parent_id) as parent_name, tr.path, tr.depth,
      nullif(left(tr.path, greatest(length(tr.path) - length(t.name) - 3, 0)), '') as parent_path,
      coalesce(json_agg(json_build_object('id', us.id, 'name', us.name, 'title', us.title, 'lead', m.is_lead, 'primary', m.is_primary) order by m.is_lead desc, us.name) filter (where us.id is not null), '[]') as members,
      bool_or(m.user_id = ${u.id}) as mine, bool_or(m.user_id = ${u.id} and m.is_lead) as i_lead,
      (select id from chat_rooms r where r.team_id = t.id) as room_id
    from teams t join tr on tr.id = t.id left join team_members m on m.team_id = t.id left join users us on us.id = m.user_id and us.status = 'active'
    where t.tenant = ${tenantOf(u)} and not t.archived group by t.id, tr.path, tr.depth, tr.sort_key order by tr.sort_key`;
  // 대표 10/20 4): 업무 화면 팀 칩 — 이 사람이 업무를 볼 수 있는 팀(관리자 전체 · 자기 팀(팀 업무 조회 이상) · 하위 팀 · 격리 아니면 다른 팀 전체 권한 또는 지정 팀)
  const { isAdmin } = await import('./access');
  let visible: Set<string> | null = null;
  if (!isAdmin(u)) {
    const { menuLevel } = await import('./menuPerms');
    const { teamScope, subTeamsSql } = await import('./access');
    const sc = await teamScope(u, sql);
    const own = await menuLevel(u, 'team_tasks', sql), all = sc.isolated ? 'none' : await menuLevel(u, 'team_tasks_all', sql);
    const sub = new Set((await sql<{ id: string }[]>`select id from (${subTeamsSql(sql, u)}) s`).map((r) => r.id));
    const grants = sc.isolated ? new Set<string>() : new Set((await sql<{ team_id: string }[]>`select team_id from team_view_grants where user_id = ${u.id}`).map((r) => r.team_id));
    visible = new Set(teams.filter((t: any) => all !== 'none' || sub.has(t.id) || grants.has(t.id) || (t.mine && own !== 'none')).map((t: any) => t.id));
  }
  return { teams: teams.map((t: any) => ({ ...t, visible: visible ? visible.has(t.id) : true })) };
}

export const teamInput = z.object({
  name: z.string().trim().min(1).max(40),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#0F766E'),
  /** 구성원(장 1명). 비우면 '장 없음'으로 남는다(조직도 틀을 먼저 만들고 사람은 나중에) */
  members: z.array(z.object({ userId: z.string().uuid(), lead: z.boolean().default(false) })).max(200),
  /** 위 단위. 종류마다 올 수 있는 위 단위가 정해져 있다(orgKinds PARENT_KINDS) */
  parentId: z.string().uuid().nullable().optional(),
  /** P2 조직 개편(대표 10/26): hq 본사 · division 사업부 · dept 부서 · team 팀. 비우면 위 단위가 있으면 팀, 없으면 부서 */
  kind: z.enum(ORG_KINDS).optional(),
  /** 격리('회사 안의 작은 회사'): 비우면 팀은 켜짐·그 밖은 꺼짐 */
  isolated: z.boolean().optional(),
  /** 이 부서·팀으로 초대할 때 제안하는 공간 */
  defaultSpaces: z.array(z.enum(['work', 'sales', 'marketing'])).max(3).optional(),
  /** 본사로 만들거나 바꿀 때: 지금 맨 위에 있는 사업부·부서를 본사 아래로 옮긴다 */
  adoptTopLevel: z.boolean().optional(),
});
const kindOf = (i: { kind?: OrgKind; parentId?: string | null }): OrgKind => i.kind ?? (i.parentId ? 'team' : 'dept');
/**
 * #680 위 단위·종류 검사: 같은 회사 · 종류별로 올 수 있는 위 단위(본사 › 사업부 › 부서 › 팀, 부서 아래 부서 가능) · 본사는 회사에 1곳·맨 위 ·
 * 팀 아래 조직 없음(아래 단위와 맞는지) · 자기 자신·자기 하위로 옮기기 금지
 */
async function checkPlacement(sql: Sql, u: SessionUser, teamId: string | null, parentId: string | null | undefined, kind: OrgKind) {
  const tn = tenantOf(u);
  const [hq] = await sql<{ name: string }[]>`select name from teams where tenant = ${tn} and kind = 'hq' and not archived and id is distinct from ${teamId}::uuid`;
  if (kind === 'hq') {
    if (parentId) throw badRequest('본사는 맨 위에만 둡니다 — 위 단위를 비우세요');
    if (hq) throw badRequest(`본사는 회사에 1곳만 둡니다 — 지금 본사: ${hq.name}`);
  }
  if (!parentId) {
    if (!topAllowed(kind, !!hq)) throw badRequest(kind === 'team' ? '팀은 부서(또는 본사·사업부) 아래에 만듭니다 — 먼저 부서를 만들거나 위 단위를 고르세요' : `본사가 있으면 ${KIND_LABEL[kind]}는 본사 아래에 둡니다 — 위 단위를 고르세요`);
  } else {
    const [p] = await sql<{ kind: OrgKind; name: string }[]>`select kind, name from teams where id = ${parentId} and tenant = ${tn} and not archived`;
    if (!p) throw badRequest('위 단위가 없습니다');
    if (!canParent(p.kind, kind)) throw badRequest(p.kind === 'team' ? '팀 아래에는 조직을 둘 수 없습니다 — 위 단위로 본사·사업부·부서를 고르세요'
      : `${KIND_LABEL[kind]}는 ${PARENT_KINDS[kind].map((k) => KIND_LABEL[k]).join('·')} 아래에 둡니다`);
    if (teamId) {
      const cyc = await sql`with recursive d as (select id from teams where id = ${teamId} union select c.id from teams c join d on c.parent_id = d.id) select 1 from d where id = ${parentId}`;
      if (cyc.length) throw badRequest('자기 자신이나 자기 아래 단위를 위 단위로 정할 수 없습니다');
    }
  }
  if (teamId) {
    const kids = await sql<{ name: string; kind: OrgKind }[]>`select name, kind from teams where parent_id = ${teamId} and not archived order by name`;
    const bad = kids.find((c) => !canParent(kind, c.kind));
    if (bad) throw badRequest(kind === 'team' ? `팀 아래에는 조직을 둘 수 없습니다 — 먼저 '${bad.name}'${eulReul(bad.name)} 다른 곳으로 옮기세요`
      : `${KIND_LABEL[kind]} 아래에는 ${KIND_LABEL[bad.kind]}${eulReul(KIND_LABEL[bad.kind])} 둘 수 없습니다 — 먼저 '${bad.name}'${eulReul(bad.name)} 옮기세요`);
  }
}
async function syncMembers(sql: Sql, u: SessionUser, teamId: string, members: z.infer<typeof teamInput>['members'], kind: OrgKind) {
  // #681: 구성원이 있으면 장 1명은 정한다(비워 두면 '장 없음' — 조직도 틀만 먼저 만들 때)
  if (members.length && !members.some((m) => m.lead)) throw badRequest(`${LEAD_TITLE[kind]}${eulReul(LEAD_TITLE[kind])} 1명 정하세요`);
  const ids = [...new Set(members.map((m) => m.userId))];
  const ok = ids.length ? await sql<{ id: string }[]>`select id from users where id = any(${ids}::uuid[]) and status = 'active' and tenant = ${tenantOf(u)}` : [];
  if (ok.length !== ids.length) throw badRequest('넣을 수 없는 사람이 있습니다');
  await sql`delete from team_members where team_id = ${teamId} and not (user_id = any(${ids}::uuid[]))`;
  for (const m of members) await sql`insert into team_members (team_id, user_id, is_lead) values (${teamId}, ${m.userId}, ${m.lead})
    on conflict (team_id, user_id) do update set is_lead = excluded.is_lead`;
  // 재정비: 소속이 하나뿐인 사람은 그곳이 주 소속
  await sql`update team_members m set is_primary = true where m.team_id = ${teamId} and not exists (select 1 from team_members x where x.user_id = m.user_id and x.is_primary)`;
  await syncRoom(sql, u, teamId, ids);
}
/** 팀 대화방: 없으면 만들고 멤버를 구성원과 같게 */
async function syncRoom(sql: Sql, u: SessionUser, teamId: string, ids: string[]) {
  await sql`insert into chat_rooms (tenant, kind, name, team_id, created_by) select ${tenantOf(u)}, 'team', t.name, t.id, ${u.id} from teams t where t.id = ${teamId}
    on conflict (team_id) where team_id is not null do update set name = excluded.name`;
  const [room] = await sql<{ id: string }[]>`select id from chat_rooms where team_id = ${teamId}`;
  await sql`delete from chat_members where room_id = ${room.id} and not (user_id = any(${ids}::uuid[]))`;
  for (const id of ids) await sql`insert into chat_members (room_id, user_id) values (${room.id}, ${id}) on conflict do nothing`;
}
/** 본사로 만들거나 바꿀 때 맨 위에 있던 사업부·부서를 본사 아래로(이관) — 옮긴 이름 목록 */
async function adoptTop(sql: Sql, u: SessionUser, hqId: string) {
  const moved = await sql<{ name: string }[]>`update teams set parent_id = ${hqId} where tenant = ${tenantOf(u)} and parent_id is null and id <> ${hqId} and not archived
    and kind in ('division', 'dept') returning name`;
  return moved.map((r) => r.name);
}
/** 단위 하나 만들기(만들기 화면·조직도 틀 공용): 행 + 팀 일정(캘린더) + 구성원·대화방 */
async function insertUnit(tx: Sql, u: SessionUser, i: { name: string; color: string; parentId: string | null; kind: OrgKind; isolated: boolean; defaultSpaces: string[]; members: z.infer<typeof teamInput>['members'] }) {
  const [t] = await tx<{ id: string }[]>`insert into teams (tenant, name, color, created_by, parent_id, kind, isolated, default_spaces)
    values (${tenantOf(u)}, ${i.name}, ${i.color}, ${u.id}, ${i.parentId}, ${i.kind}, ${i.isolated}, ${i.defaultSpaces}) returning id`
    .catch((e: any) => { throw e?.code === '23505' ? badRequest(e?.constraint_name === 'teams_one_hq_uq' ? '본사는 회사에 1곳만 둡니다' : `같은 이름의 조직이 있습니다: ${i.name}`) : e; });
  // 팀 일정(팀 캘린더): 장 편집·구성원 조회·위 단위 구성원 편집·본사 전체
  await tx`insert into calendars (tenant, type, team_id, name, color) values (${tenantOf(u)}, 'team', ${t.id}, ${i.name + ' 일정'}, ${i.color})`;
  await syncMembers(tx, u, t.id, i.members, i.kind);
  return t.id;
}
export async function createTeam(u: SessionUser, i: z.infer<typeof teamInput>, ip: string | null) {
  await requireMenu(u, 'admin_users', 'edit');
  const sql = db();
  return sql.begin(async (tx) => {
    const kind = kindOf(i);
    await checkPlacement(tx as unknown as Sql, u, null, i.parentId, kind);
    const id = await insertUnit(tx as unknown as Sql, u, { name: i.name, color: i.color, parentId: i.parentId ?? null, kind, isolated: kind === 'team' ? i.isolated ?? true : false, defaultSpaces: i.defaultSpaces ?? ['work'], members: i.members });
    const moved = kind === 'hq' && i.adoptTopLevel ? await adoptTop(tx as unknown as Sql, u, id) : [];
    await audit(tx as unknown as Sql, u.id, 'team.create', 'team', id, { name: i.name, kind, members: i.members.length, ...(moved.length ? { moved } : {}) }, ip);
    return { id, moved };
  });
}
export async function updateTeam(u: SessionUser, id: string, i: Partial<z.infer<typeof teamInput>> & { archived?: boolean }, ip: string | null) {
  await requireMenu(u, 'admin_users', 'edit');
  const sql = db();
  const [t] = await sql<{ id: string; name: string; color: string; kind: OrgKind; parent_id: string | null; archived: boolean }[]>`select id, name, color, kind, parent_id, archived from teams where id = ${id} and tenant = ${tenantOf(u)}`;
  if (!t) throw notFound('팀이 없습니다');
  return sql.begin(async (tx) => {
    const kind = i.kind ?? t.kind;
    const parentId = i.parentId === undefined ? t.parent_id : i.parentId;
    // 이름·색·구성원만 고칠 때는 위치 검사를 다시 하지 않는다(예전 규칙으로 만든 조직도 그대로 고칠 수 있게) — 종류·위 단위가 실제로 바뀔 때만
    if (kind !== t.kind || parentId !== t.parent_id) {
      await checkPlacement(tx as unknown as Sql, u, id, parentId, kind);
      await tx`update teams set parent_id = ${parentId}, kind = ${kind}, isolated = case when ${kind} = 'team' then isolated else false end where id = ${id}`;
    }
    if (i.archived && !t.archived) {
      const [kid] = await tx<{ name: string }[]>`select name from teams where parent_id = ${id} and not archived order by name limit 1`;
      if (kid) throw badRequest(`아래 단위('${kid.name}')가 있어 보관할 수 없습니다 — 먼저 옮기거나 보관하세요`);
    }
    await tx`update teams set name = ${i.name ?? t.name}, color = ${i.color ?? t.color}, archived = ${i.archived ?? false},
      isolated = case when kind = 'team' then coalesce(${i.isolated ?? null}, isolated) else false end, default_spaces = coalesce(${i.defaultSpaces ?? null}, default_spaces) where id = ${id}`
      .catch((e: any) => { throw e?.code === '23505' ? badRequest(e?.constraint_name === 'teams_one_hq_uq' ? '본사는 회사에 1곳만 둡니다' : `같은 이름의 조직이 있습니다: ${i.name ?? t.name}`) : e; });
    await tx`update calendars set name = ${(i.name ?? t.name) + ' 일정'}, color = ${i.color ?? t.color} where type = 'team' and team_id = ${id}`;
    if (i.members) await syncMembers(tx as unknown as Sql, u, id, i.members, kind);
    else if (i.name) await tx`update chat_rooms set name = ${i.name} where team_id = ${id}`;
    const moved = kind === 'hq' && i.adoptTopLevel ? await adoptTop(tx as unknown as Sql, u, id) : [];
    await audit(tx as unknown as Sql, u.id, i.archived ? 'team.archive' : 'team.update', 'team', id, { name: i.name, kind: kind !== t.kind ? kind : undefined, parentId: parentId !== t.parent_id ? parentId : undefined, members: i.members?.length, ...(moved.length ? { moved } : {}) }, ip);
    return { ok: true, moved };
  });
}

/**
 * [일반 기업 조직도로 시작](대표 10/26 16:40 ⑧): 조직이 하나도 없는 회사에만 — 본사(만든 사람이 대표) › 경영지원부(회계팀·총무팀) · 영업부(영업1팀·영업2팀) · 마케팅부.
 * 업종과 상관없는 기본 틀이라 이름·구성은 만든 뒤 바로 고친다. 팀은 격리 꺼짐(회사 안의 작은 회사는 필요한 팀만 켬)
 */
export async function startGenericOrg(u: SessionUser, ip: string | null) {
  await requireMenu(u, 'admin_users', 'edit');
  const sql = db();
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${'org-template:' + tenantOf(u)}))`; // 두 번 눌러도 한 번만
    const [has] = await tx`select 1 from teams where tenant = ${tenantOf(u)} and not archived limit 1`;
    if (has) throw badRequest('이미 조직도가 있습니다 — 조직도 틀은 조직이 하나도 없을 때만 쓸 수 있습니다');
    const COLORS = ['#0F766E', '#2563EB', '#EA580C', '#7C3AED', '#DB2777', '#16a34a', '#475569'];
    let n = 0;
    type Node = { name: string; kind: OrgKind; children?: Node[] };
    const make = async (node: Node, parentId: string | null): Promise<number> => {
      const id = await insertUnit(tx as unknown as Sql, u, { name: node.name, color: COLORS[n++ % COLORS.length], parentId, kind: node.kind, isolated: false, defaultSpaces: ['work'],
        members: node.kind === 'hq' ? [{ userId: u.id, lead: true }] : [] });
      let c = 1;
      for (const ch of node.children ?? []) c += await make(ch, id);
      return c;
    };
    const created = await make(GENERIC_ORG, null);
    await audit(tx as unknown as Sql, u.id, 'team.template', 'team', null, { template: 'generic', created }, ip);
    return { ok: true, created };
  });
}

/** 홈 "우리 팀 오늘의 일정": 내가 속한 팀의 오늘 마감·기한 지남·진행 중 업무 (볼 수 있는 것만) */
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

/**
 * 대표 10/20 15:15 재정비: 사람의 소속 = 주 소속 1개 + 겸직 n개 (초대·사용자 편집에서 '소속' 하나로). 팀 대화방 멤버도 맞춘다.
 * primaryTeamId 를 비우면 첫 번째(기존 주 소속이 남아 있으면 그것)가 주 소속.
 */
export async function setUserTeams(sql: Sql, tenant: string, userId: string, teamIds: string[], primaryTeamId?: string | null) {
  const ids = [...new Set(teamIds)];
  if (primaryTeamId && !ids.includes(primaryTeamId)) ids.unshift(primaryTeamId);
  if (ids.length) {
    const ok = await sql<{ id: string }[]>`select id from teams where id = any(${ids}::uuid[]) and tenant = ${tenant} and not archived`;
    if (ok.length !== ids.length) throw badRequest('없는 부서·팀이 포함되어 있습니다');
  }
  const removed = await sql<{ team_id: string }[]>`delete from team_members where user_id = ${userId} and not (team_id = any(${ids}::uuid[])) returning team_id`;
  for (const id of ids) await sql`insert into team_members (team_id, user_id, is_lead) values (${id}, ${userId}, false) on conflict (team_id, user_id) do nothing`;
  const primary = primaryTeamId ?? (await sql<{ team_id: string }[]>`select team_id from team_members where user_id = ${userId} and is_primary`)[0]?.team_id ?? ids[0] ?? null;
  await sql`update team_members set is_primary = (team_id = ${primary}) where user_id = ${userId}`;
  for (const r of removed) await sql`delete from chat_members cm using chat_rooms r where cm.room_id = r.id and r.team_id = ${r.team_id} and cm.user_id = ${userId}`;
  if (ids.length) await sql`insert into chat_members (room_id, user_id) select id, ${userId} from chat_rooms where team_id = any(${ids}::uuid[]) on conflict do nothing`;
  return { teamIds: ids, primaryTeamId: primary };
}
