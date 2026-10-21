/**
 * 대표 10/20 15:05 (#101) 권한 배지 — 이름 옆에 영어 직책(CEO·Admin·Lead·Ops·Member·Guest).
 * 회사 설정(회사 정보·디자인)에서 영어(기본)/한글/끄기. 화면: 사용자 관리·담당자 칩·메신저 참여자·방 정보·댓글·프로필·명함.
 */
import { db } from './db';
import { audit } from './log';
import { badRequest } from './errors';
import { tenantOf, type Role, type SessionUser } from './types';

export { ROLE_BADGE_EN, GUEST_BADGE, ROLE_BADGE_MODES, ROLE_BADGE_MODE_LABEL, type RoleBadgeMode } from './roleBadgeConst';
import { ROLE_BADGE_EN, ROLE_BADGE_MODES, ROLE_BADGE_MODE_LABEL, type RoleBadgeMode } from './roleBadgeConst';

export async function getRoleBadge(u: SessionUser): Promise<{ mode: RoleBadgeMode; labels: Record<Role, string>; modeLabels: Record<RoleBadgeMode, string> }> {
  const [r] = await db()<{ role_badge: string | null }[]>`select role_badge from tenants where id = ${tenantOf(u)}`;
  return { mode: (ROLE_BADGE_MODES.includes(r?.role_badge as RoleBadgeMode) ? r!.role_badge : 'en') as RoleBadgeMode, labels: ROLE_BADGE_EN, modeLabels: ROLE_BADGE_MODE_LABEL };
}
/** 회사 정보·디자인 편집 권한(대표·관리자 등 메뉴 권한) */
export async function setRoleBadge(u: SessionUser, mode: string) {
  const { requireAnyMenu } = await import('./menuPerms');
  await requireAnyMenu(u, ['company', 'ops'], 'edit');
  if (!ROLE_BADGE_MODES.includes(mode as RoleBadgeMode)) throw badRequest('표시 방식이 올바르지 않습니다');
  const sql = db();
  await sql`update tenants set role_badge = ${mode} where id = ${tenantOf(u)}`;
  await audit(sql, u.id, 'role_badge.set', 'tenant', null, { mode }).catch(() => {});
  return getRoleBadge(u);
}
