/**
 * #1181 상업화 마감 4번 · #1175 회사별 기능 켜기(설계 docs/research/COMMERCIAL_DESIGN_2026-11-26.md B):
 * '그 회사만을 위한 개발' 대신 회사마다 켜고 끄는 기능. 기본값은 이 파일(다짐 = 지금 동작), 바꾼 값만 tenant_features 에.
 * - customer: true 인 기능은 회사 관리자(대표·관리자)가 설정 › 쓰는 기능에서 끌 수 있다. 나머지는 플랫폼 운영자만.
 * - 'beta:이름' = 회사별 베타 기능(운영자만, 기본 꺼짐) — 코드에서 featureOn(tenant, 'beta:이름') 으로 본다.
 * 다음 묶음: 코드 곳곳의 tenant === 'default' 비교를 기능 이름으로 바꿔 이 표로 모은다(기본값이 지금 동작이라 결과 같음).
 */
import { z } from 'zod';
import { db, type Sql } from './db';
import { audit } from './log';
import { badRequest, forbidden, notFound } from './errors';
import { isAdmin } from './access';
import { tenantOf, type SessionUser } from './types';

type Def = { label: string; desc: string; customer: boolean; def: (tenant: string) => boolean };
export type FeatureKey = 'check';
export const FEATURES: Record<FeatureKey, Def> = {
  check: { label: '점검', desc: '점검 가이드·점검하기·보완 확인·점검 리포트(사이드바 메뉴와 홈 점검 칸)', customer: true, def: () => true },
};
const BETA = /^beta:[a-z0-9_-]{2,40}$/;
const known = (k: string): k is FeatureKey => Object.prototype.hasOwnProperty.call(FEATURES, k);

/** 회사 기능 켬/끔 — 바꾼 값이 없으면 기본값(베타는 꺼짐) */
export async function featureOn(tenant: string, key: FeatureKey | `beta:${string}`, sql: Sql = db()): Promise<boolean> {
  const [r] = await sql<{ enabled: boolean }[]>`select enabled from tenant_features where tenant = ${tenant} and key = ${key}`.catch(() => [] as { enabled: boolean }[]);
  if (r) return r.enabled;
  return known(key) ? FEATURES[key].def(tenant) : false;
}

/** 한 회사의 기능 표(화면용): 알려진 기능 + 켜 둔 베타 */
export async function featureList(tenant: string, opt: { customerOnly?: boolean } = {}) {
  const rows = await db()<{ key: string; enabled: boolean; note: string | null; updated_at: Date; by: string | null }[]>`
    select f.key, f.enabled, f.note, f.updated_at, u.name as by from tenant_features f left join users u on u.id = f.updated_by where f.tenant = ${tenant} order by f.key`;
  const m = new Map(rows.map((r) => [r.key, r]));
  const out = (Object.keys(FEATURES) as FeatureKey[]).filter((k) => !opt.customerOnly || FEATURES[k].customer).map((k) => {
    const r = m.get(k); const def = FEATURES[k].def(tenant);
    return { key: k, label: FEATURES[k].label, desc: FEATURES[k].desc, customer: FEATURES[k].customer, on: r ? r.enabled : def, def, changed: !!r, by: r?.by ?? null, at: r?.updated_at ?? null, note: r?.note ?? null };
  });
  if (!opt.customerOnly) for (const r of rows) if (BETA.test(r.key)) out.push({ key: r.key as FeatureKey, label: `베타 ${r.key.slice(5)}`, desc: r.note ?? '회사별 베타 기능', customer: false, on: r.enabled, def: false, changed: true, by: r.by, at: r.updated_at, note: r.note });
  return out;
}

export const featureInput = z.object({ key: z.string().trim().min(2).max(45), on: z.boolean().nullable(), note: z.string().trim().max(200).optional() });

/** 기능 켜기·끄기 — platform: 플랫폼 운영자(모든 기능·베타, on=null 이면 기본값으로), 아니면 회사 관리자(customer 기능만, 자기 회사) */
export async function setFeature(u: SessionUser, tenant: string, i: z.infer<typeof featureInput>, ip: string | null, opt: { platform: boolean }) {
  if (opt.platform) { if (!u.platformAdmin) throw notFound(); }
  else { if (!isAdmin(u) || u.isDemo) throw forbidden('대표·관리자만 바꿀 수 있습니다'); if (tenant !== tenantOf(u)) throw notFound(); }
  const beta = BETA.test(i.key);
  if (!known(i.key) && !(beta && opt.platform)) throw badRequest('바꿀 수 없는 기능입니다');
  if (known(i.key) && !opt.platform && !FEATURES[i.key].customer) throw forbidden('이 기능은 운영사가 켜고 끕니다');
  if (i.on === null && !opt.platform) throw badRequest('켬 또는 끔을 골라 주세요');
  const sql = db();
  const [t] = await sql<{ id: string }[]>`select id from tenants where id = ${tenant} and deleted_at is null`; if (!t) throw notFound();
  if (i.on === null) await sql`delete from tenant_features where tenant = ${tenant} and key = ${i.key}`;
  else await sql`insert into tenant_features (tenant, key, enabled, note, updated_by) values (${tenant}, ${i.key}, ${i.on}, ${i.note ?? null}, ${u.id})
    on conflict (tenant, key) do update set enabled = excluded.enabled, note = coalesce(excluded.note, tenant_features.note), updated_by = excluded.updated_by, updated_at = now()`;
  await audit(sql, u.id, 'feature.set', 'tenant', tenant, { key: i.key, on: i.on, by: opt.platform ? 'platform' : 'company' }, ip);
  return { key: i.key, on: i.on === null ? (known(i.key) ? FEATURES[i.key].def(tenant) : false) : i.on };
}
