import { z } from 'zod';
import { db, type Sql } from './db';
import { forbidden, notFound } from './errors';
import { audit } from './log';
import { tenantOf, type Role, type SessionUser } from './types';

/**
 * V13 2번 메뉴 권한: 메뉴 × 등급 스위치 + 사람별 예외 (대표만 바꿈). 서버가 모든 API 에서 403/404 로 강제한다.
 * 단계: none < view < edit (AI 비서는 none/use)
 */
export const MENUS = {
  // V14 7번: 관리 메뉴 전체 — 조회 / 조회·편집 (편집이면 조회 포함) × 등급 + 사람별 예외. 꺼지면 사이드바에서 숨기고 서버도 404/403
  team_reports: { label: '주간 보고(모아보기)', levels: ['none', 'view', 'edit'], defaults: { owner: 'edit', admin: 'edit', dept_lead: 'none', site_manager: 'none', staff: 'none' } },
  revenue: { label: '매출', levels: ['none', 'view', 'edit'], defaults: { owner: 'edit', admin: 'none', dept_lead: 'none', site_manager: 'none', staff: 'none' } },
  admin_users: { label: '사용자 관리', levels: ['none', 'view', 'edit'], defaults: { owner: 'edit', admin: 'edit', dept_lead: 'none', site_manager: 'none', staff: 'none' } },
  ops: { label: '운영 상태(조직·감사·공휴일·결재선)', levels: ['none', 'view', 'edit'], defaults: { owner: 'edit', admin: 'edit', dept_lead: 'none', site_manager: 'none', staff: 'none' } },
  usage: { label: '사용량·요금제', levels: ['none', 'view', 'edit'], defaults: { owner: 'edit', admin: 'edit', dept_lead: 'none', site_manager: 'none', staff: 'none' } },
  // V13 4번: 자료실 3단계 — 보기 / 올리기·수정 / 삭제 (폴더별 권한은 library_folder_perms, 상속)
  library: { label: '자료실', levels: ['none', 'view', 'edit', 'delete'], defaults: { owner: 'delete', admin: 'delete', dept_lead: 'edit', site_manager: 'edit', staff: 'edit' } },
  // V14 15번 보안 등급: 내부 자료(기본 전 직원) · 기밀 자료(기본 대표만, 편집 = 등급 내리기·확인·열람 기록)
  library_internal: { label: '자료실: 내부 자료 열람', levels: ['none', 'view'], defaults: { owner: 'view', admin: 'view', dept_lead: 'view', site_manager: 'view', staff: 'view' } },
  confidential: { label: '기밀 자료 열람', levels: ['none', 'view', 'edit'], defaults: { owner: 'edit', admin: 'view', dept_lead: 'none', site_manager: 'none', staff: 'none' } },
  assistant: { label: 'AI 비서', levels: ['none', 'use'], defaults: { owner: 'use', admin: 'use', dept_lead: 'use', site_manager: 'use', staff: 'use' } },
  // V14 6번: 회사 AI 사용 내역(누가·언제·무슨 질문·비용) 조회 / 편집(삭제·보관 기간·한도) — 기본 대표만
  ai_logs: { label: 'AI 사용 내역', levels: ['none', 'view', 'edit'], defaults: { owner: 'edit', admin: 'none', dept_lead: 'none', site_manager: 'none', staff: 'none' } },
  // V14 8번 팀 업무: 자기 팀(팀원은 이 단계, 팀장은 조회 이상이면 편집까지) / 다른 팀 업무
  team_tasks: { label: '팀 업무(자기 팀)', levels: ['none', 'view', 'edit'], defaults: { owner: 'edit', admin: 'edit', dept_lead: 'view', site_manager: 'view', staff: 'view' } },
  team_tasks_all: { label: '다른 팀 업무 보기', levels: ['none', 'view', 'edit'], defaults: { owner: 'edit', admin: 'edit', dept_lead: 'none', site_manager: 'none', staff: 'none' } },
  // V14 1번 담당자 재배정: 아무 업무나 / 지시자는 자기가 지시한 업무만 / 담당자 본인의 넘기기(지시자 승인)
  reassign: { label: '업무 담당자 재배정', levels: ['none', 'use'], defaults: { owner: 'use', admin: 'use', dept_lead: 'none', site_manager: 'none', staff: 'none' } },
  reassign_requester: { label: '지시자는 자기 업무 재배정 가능', levels: ['none', 'use'], defaults: { owner: 'use', admin: 'use', dept_lead: 'use', site_manager: 'use', staff: 'use' } },
  reassign_handoff: { label: '담당자가 다른 사람에게 넘기기(지시자 승인)', levels: ['none', 'use'], defaults: { owner: 'use', admin: 'none', dept_lead: 'none', site_manager: 'none', staff: 'none' } },
  // V21 메일·문자 보내기: 실제 발송([보내기])은 기본 대표만, 사용자 관리에서 사람별로 켬. 메일 계정·명함 설정은 대표·본사 관리자
  send_external: { label: '외부 발송(메일·문자 보내기)', levels: ['none', 'use'], defaults: { owner: 'use', admin: 'none', dept_lead: 'none', site_manager: 'none', staff: 'none' } },
  mail_settings: { label: '메일 계정·명함 설정', levels: ['none', 'view', 'edit'], defaults: { owner: 'edit', admin: 'edit', dept_lead: 'none', site_manager: 'none', staff: 'none' } },
} as const;
export type MenuKey = keyof typeof MENUS;
export const LEVEL_LABEL: Record<string, string> = { none: '끔', view: '조회', edit: '조회·편집', use: '사용', delete: '삭제까지' };
/** 메뉴별 단계 이름 (자료실은 "올리기·수정") */
export const levelLabel = (menu: string, lv: string) => (menu === 'library' && lv === 'edit' ? '올리기·수정' : menu.startsWith('reassign') || menu === 'send_external' ? (lv === 'use' ? '켬' : '끔') : menu === 'assistant' ? (lv === 'use' ? '사용' : '끔') : LEVEL_LABEL[lv] ?? lv);
export const RANK: Record<string, number> = { none: 0, view: 1, use: 1, edit: 2, delete: 3 };
const topLevel = (menu: MenuKey) => MENUS[menu].levels[MENUS[menu].levels.length - 1] as string;
 /** 개인 공간(1인)에서는 관리·회사 메뉴를 숨긴다 */
const PERSONAL_OFF = new Set<string>(['team_reports', 'revenue', 'admin_users', 'ops', 'ai_logs', 'team_tasks', 'team_tasks_all', 'reassign_requester', 'reassign_handoff']);
const ROLES: Role[] = ['owner', 'admin', 'dept_lead', 'site_manager', 'staff'];

export async function menuLevel(u: SessionUser, menu: MenuKey, sql: Sql = db()): Promise<string> {
  if (u.isDemo && menu === 'revenue') return 'none';
  if ((menu === 'revenue' || menu === 'ops') && tenantOf(u) !== 'default') return 'none'; // 현장 매출·서버 운영은 기본 회사 전용
  if (u.personal && PERSONAL_OFF.has(menu)) return 'none'; // 개인 공간: 관리 메뉴 숨김
  if (u.role === 'owner' && !u.isDemo) return topLevel(menu); // 대표 본인 권한은 끌 수 없다(잠김 방지)
  const [o] = await sql<{ level: string }[]>`select level from menu_user_perms where menu = ${menu} and user_id = ${u.id}`;
  if (o) return o.level;
  const [r] = await sql<{ level: string }[]>`select level from menu_role_perms_t where tenant = ${tenantOf(u)} and menu = ${menu} and role = ${u.role}`;
  return r?.level ?? MENUS[menu].defaults[u.role];
}
export async function menuLevels(u: SessionUser) {
  const out: Record<string, string> = {};
  for (const m of Object.keys(MENUS) as MenuKey[]) out[m] = await menuLevel(u, m);
  return out;
}
/** 여러 메뉴 중 하나라도 need 이상이면 통과 (예: 조직 목록은 사용자 관리·운영 상태 어느 쪽이든 조회) */
export async function requireAnyMenu(u: SessionUser, menus: MenuKey[], need: 'view' | 'edit' = 'view', sql: Sql = db()) {
  for (const m of menus) if (RANK[await menuLevel(u, m, sql)] >= RANK[need]) return;
  return requireMenu(u, menus[0], need, sql);
}
/** need 보다 낮으면: 메뉴 자체가 안 보이는 사람은 404(있는 줄도 모르게), 보기만 되는 사람의 쓰기는 403 */
export async function requireMenu(u: SessionUser, menu: MenuKey, need: 'view' | 'edit' | 'use' | 'delete' = 'view', sql: Sql = db()) {
  const lv = await menuLevel(u, menu, sql);
  if (RANK[lv] >= RANK[need]) return lv;
  if (lv === 'none') throw notFound();
  throw forbidden(`${MENUS[menu].label}: ${levelLabel(menu, need)} 권한이 없습니다 — 대표에게 요청하세요`);
}

// ---------------- 대표 전용 설정 ----------------
const requireOwner = (u: SessionUser) => { if (u.role !== 'owner' || u.isDemo) throw forbidden('대표만 메뉴 권한을 바꿀 수 있습니다'); };
export async function menuMatrix(u: SessionUser) {
  requireOwner(u);
  const sql = db();
  const [roles, users] = await Promise.all([
    sql<{ menu: string; role: string; level: string }[]>`select menu, role, level from menu_role_perms_t where tenant = ${tenantOf(u)}`,
    sql`select p.menu, p.user_id, p.level, u.name from menu_user_perms p join users u on u.id = p.user_id where u.tenant = ${tenantOf(u)} order by u.name`,
  ]);
  const matrix: Record<string, Record<string, string>> = {};
  for (const [m, def] of Object.entries(MENUS)) {
    matrix[m] = {};
    for (const r of ROLES) matrix[m][r] = r === 'owner' ? topLevel(m as MenuKey) : roles.find((x) => x.menu === m && x.role === r)?.level ?? (def.defaults as Record<string, string>)[r];
  }
  return { menus: Object.entries(MENUS).map(([k, v]) => ({ key: k, label: v.label, levels: v.levels.map((l) => ({ value: l, label: levelLabel(k, l) })) })),
    roles: ROLES, matrix, overrides: users };
}
export const menuPermInput = z.object({
  menu: z.enum(Object.keys(MENUS) as [MenuKey, ...MenuKey[]]),
  role: z.enum(['owner', 'admin', 'dept_lead', 'site_manager', 'staff']).optional(),
  userId: z.string().uuid().optional(),
  level: z.string().nullable(),
});
export async function setMenuPerm(u: SessionUser, i: z.infer<typeof menuPermInput>, ip: string | null) {
  requireOwner(u);
  const sql = db();
  const levels = MENUS[i.menu].levels as readonly string[];
  if (i.level !== null && !levels.includes(i.level)) throw forbidden('없는 단계입니다');
  if (!!i.role === !!i.userId) throw forbidden('등급 또는 사람 중 하나를 고르세요');
  if (i.role) {
    if (i.role === 'owner') throw forbidden('대표 본인 권한은 끌 수 없습니다(잠김 방지)');
    if (i.level === null) await sql`delete from menu_role_perms_t where tenant = ${tenantOf(u)} and menu = ${i.menu} and role = ${i.role}`;
    else await sql`insert into menu_role_perms_t (tenant, menu, role, level, updated_by) values (${tenantOf(u)}, ${i.menu}, ${i.role}, ${i.level}, ${u.id})
      on conflict (tenant, menu, role) do update set level = excluded.level, updated_by = excluded.updated_by, updated_at = now()`;
  } else {
    const [t] = await sql<{ role: string }[]>`select role from users where id = ${i.userId!} and tenant = ${tenantOf(u)}`;
    if (!t) throw notFound();
    if (t.role === 'owner') throw forbidden('대표 본인 권한은 끌 수 없습니다(잠김 방지)');
    if (i.level === null) await sql`delete from menu_user_perms where menu = ${i.menu} and user_id = ${i.userId!}`;
    else await sql`insert into menu_user_perms (menu, user_id, level, updated_by) values (${i.menu}, ${i.userId!}, ${i.level}, ${u.id})
      on conflict (menu, user_id) do update set level = excluded.level, updated_by = excluded.updated_by, updated_at = now()`;
  }
  await audit(sql, u.id, 'menu_perm.set', i.userId ? 'user' : null, i.userId ?? null, { menu: i.menu, role: i.role ?? null, level: i.level }, ip);
  return { ok: true };
}
