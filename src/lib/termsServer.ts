import { z } from 'zod';
import { db, type Sql } from './db';
import { badRequest } from './errors';
import { audit } from './log';
import { ROLES, ROLE_NAME_MAX, TERMS_COMMON, isBaseTenant, roleNameOk, termsFor, type Terms, type TermsCustom } from './terms';
import { tenantOf, type SessionUser } from './types';

/** 회사가 정한 용어(역할 이름) 보관: app_settings 'terms:<회사>' — 기본 회사는 보관·조회하지 않는다(늘 지금 표현) */
const keyOf = (tenant: string) => `terms:${tenant}`;
export async function termsCustom(tenant: string, sql: Sql = db()): Promise<TermsCustom | null> {
  if (isBaseTenant(tenant)) return null;
  const [r] = await sql<{ value: TermsCustom }[]>`select value from app_settings where key = ${keyOf(tenant)}`;
  return r?.value ?? null;
}
/** 그 회사의 용어(서버 문구·메일·알림용) */
export async function termsOf(tenant: string | null | undefined, sql: Sql = db()): Promise<Terms> {
  if (isBaseTenant(tenant)) return termsFor(tenant);
  return termsFor(tenant, await termsCustom(tenant!, sql).catch(() => null));
}
export const termsOfUser = (u: SessionUser, sql: Sql = db()) => termsOf(tenantOf(u), sql);
/** 서버 오류 문구의 "대표에게 요청하세요" — 그 회사의 대표 이름으로 */
export async function ownerWord(u: SessionUser) { return (await termsOfUser(u).catch(() => termsFor(tenantOf(u)))).role.owner; }

/** 화면(회사 정보 › 역할 이름): 지금 값·회사가 정한 값·공통 기본값. fixed = 기본 회사(바꾸지 않음) */
export async function termsView(u: SessionUser) {
  const t = tenantOf(u); const custom = await termsCustom(t);
  return { terms: termsFor(t, custom), custom: custom ?? {}, defaults: TERMS_COMMON.role, fixed: isBaseTenant(t), max: ROLE_NAME_MAX };
}
export const termsInput = z.object({ role: z.record(z.enum(['owner', 'admin', 'dept_lead', 'site_manager', 'staff']), z.string().trim().max(40).nullable()) });
/** 역할 이름 저장(권한 확인은 부르는 쪽) — 비우면 공통 기본값으로. 같은 이름을 두 역할에 쓰면 구분이 안 되므로 막는다 */
export async function setTerms(u: SessionUser, i: z.infer<typeof termsInput>, ip: string | null) {
  const t = tenantOf(u);
  if (isBaseTenant(t)) throw badRequest('이 회사의 역할 이름은 바꾸지 않습니다');
  const cur = (await termsCustom(t)) ?? {};
  const role: Partial<Record<(typeof ROLES)[number], string>> = { ...(cur.role ?? {}) };
  for (const r of ROLES) {
    const v = i.role[r]; if (v === undefined) continue;
    if (v === null || v.trim() === '') { delete role[r]; continue; }
    if (!roleNameOk(v)) throw badRequest(`역할 이름은 한글·영문·숫자로 ${ROLE_NAME_MAX}자까지 적어 주세요`);
    role[r] = v.trim();
  }
  const next = termsFor(t, { role });
  const names = ROLES.map((r) => next.role[r]);
  if (new Set(names).size !== names.length) throw badRequest('역할 이름이 서로 겹칩니다 — 역할마다 다른 이름을 적어 주세요');
  const sql = db();
  await sql`insert into app_settings (key, value, updated_by) values (${keyOf(t)}, ${sql.json({ role } as never)}, ${u.id})
    on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`;
  await audit(sql, u.id, 'terms.roles', 'tenant', null, { role }, ip).catch(() => {});
  return termsView(u);
}
