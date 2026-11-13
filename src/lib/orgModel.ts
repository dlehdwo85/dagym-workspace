import { z } from 'zod';
import { db, type Sql } from './db';
import { badRequest } from './errors';
import { audit } from './log';
import { tenantOf, type SessionUser } from './types';

/**
 * 405차 #1026 범용화 조직 모델(대표 11/13 밤 확정 — 로컬 추천안): 표·권한 구조는 그대로 두고 화면만.
 *  · 기본 회사(다짐)·심사용 조직: 지금처럼 본사·지점·현장을 모두 쓴다(이 설정을 읽지 않음, 바꿀 수 없음).
 *  · 다른 회사: 기본은 '부서·팀'만 — 지점(조직) 고르기·조직 구성 화면을 숨기고 모두 가입 때 만든 조직 1곳에 속한다(초대하면 서버가 그 조직에 넣음).
 *    회사 정보에서 "지점이 여러 곳"을 켠 회사만 조직 구성·조직 고르기가 보인다.
 */
const FIXED = new Set(['default', 'demo']);
export const multiSiteFixed = (tenant: string) => FIXED.has(tenant);
/** 그 회사가 지점(조직)을 여러 곳 쓰는가 — col = tenants.multi_site */
export const multiSiteOf = (tenant: string, col: boolean | null | undefined) => (multiSiteFixed(tenant) ? true : !!col);
export async function multiSite(tenant: string, sql: Sql = db()) {
  if (multiSiteFixed(tenant)) return true;
  const [r] = await sql<{ multi_site: boolean | null }[]>`select multi_site from tenants where id = ${tenant}`;
  return !!r?.multi_site;
}
export async function orgModelView(u: SessionUser) {
  const t = tenantOf(u); const sql = db();
  const [n] = await sql<{ n: number }[]>`select count(*)::int as n from org_units where tenant = ${t} and active`;
  return { multiSite: await multiSite(t, sql), fixed: multiSiteFixed(t), units: n?.n ?? 0 };
}
export const orgModelInput = z.object({ multiSite: z.boolean() });
/** 켜기·끄기(권한 확인은 부르는 쪽). 끌 때 이미 조직이 2곳 이상이면 막는다 — 사람들이 어느 조직 소속인지가 화면에서 사라지므로 먼저 조직을 하나로 정리 */
export async function setMultiSite(u: SessionUser, i: z.infer<typeof orgModelInput>, ip: string | null) {
  const t = tenantOf(u);
  if (multiSiteFixed(t)) throw badRequest('이 회사의 조직 구성 방식은 바꾸지 않습니다');
  const sql = db();
  if (!i.multiSite) {
    const [n] = await sql<{ n: number }[]>`select count(*)::int as n from org_units where tenant = ${t} and active`;
    if ((n?.n ?? 0) > 1) throw badRequest(`사용 중인 조직이 ${n.n}곳입니다 — 조직 구성에서 하나만 남기고 '사용 안 함'으로 바꾼 뒤 꺼 주세요`);
  }
  await sql`update tenants set multi_site = ${i.multiSite} where id = ${t}`;
  await audit(sql, u.id, 'org.multi_site', 'tenant', null, { multiSite: i.multiSite }, ip).catch(() => {});
  return orgModelView(u);
}
