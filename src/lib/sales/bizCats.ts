import { z } from 'zod';
import { db } from '../db';
import { badRequest, forbidden } from '../errors';
import { assertSpace } from '../spaces';
import { tenantOf, type SessionUser } from '../types';

/**
 * 대표 10/21 12:00 영업 재편 4): 회사 '관심 사업(카테고리)' — 공고 사업별 탭·필터·행 적합 배지의 유일한 근거.
 * 회사마다 자기 사업을 적는다(표 sales_business_categories). 코드에는 특정 회사 이름이 없다(상용화 규칙).
 */
export type BizCat = { id: string; key: string; name: string; color: string; keywords: string[]; sort: number; active: boolean };
export const bizCatsInput = z.object({ items: z.array(z.object({
  key: z.string().trim().regex(/^[a-z0-9가-힣_-]{1,40}$/).optional(), name: z.string().trim().min(1).max(40), color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).default('#2563EB'),
  keywords: z.array(z.string().trim().min(1).max(40)).max(50).default([]), active: z.boolean().default(true),
})).max(30) });

export async function listBizCats(tenant: string, all = false): Promise<BizCat[]> {
  return db()<BizCat[]>`select id, key, name, color, keywords, sort, active from sales_business_categories where tenant = ${tenant} ${all ? db()`` : db()`and active`} order by sort, name`;
}
export async function getBizCats(u: SessionUser) {
  await assertSpace(u, 'sales');
  return { items: await listBizCats(tenantOf(u), true), canEdit: ['owner', 'admin'].includes(u.role) };
}
const slug = (s: string) => { const b = s.toLowerCase().replace(/[^a-z0-9가-힣]+/g, '-').replace(/^-|-$/g, '').slice(0, 40); return b || `c${Math.random().toString(36).slice(2, 8)}`; };
/** 전체 교체(관리자): key 가 같으면 갱신, 빠진 것은 끔(기존 배지·리드 관심 사업이 가리킬 수 있어 지우지 않음) */
export async function saveBizCats(u: SessionUser, i: z.infer<typeof bizCatsInput>) {
  await assertSpace(u, 'sales');
  if (!['owner', 'admin'].includes(u.role)) throw forbidden('관리자만 바꿀 수 있습니다');
  const t = tenantOf(u); const sql = db();
  const keys = new Set<string>();
  const items = i.items.map((x, n) => { let k = x.key ?? slug(x.name); while (keys.has(k)) k = `${k}-${n}`; keys.add(k); return { ...x, key: k, sort: n + 1, keywords: [...new Set(x.keywords.map((w) => w.trim()).filter(Boolean))] }; });
  if (items.length !== new Set(items.map((x) => x.name)).size) throw badRequest('사업 이름이 겹칩니다');
  await sql.begin(async (tx) => {
    await tx`update sales_business_categories set active = false, updated_at = now() where tenant = ${t} and not (key = any(${[...keys]}::text[]))`;
    for (const x of items) await tx`insert into sales_business_categories (tenant, key, name, color, keywords, sort, active) values (${t}, ${x.key}, ${x.name}, ${x.color}, ${x.keywords}, ${x.sort}, ${x.active})
      on conflict (tenant, key) do update set name = excluded.name, color = excluded.color, keywords = excluded.keywords, sort = excluded.sort, active = excluded.active, updated_at = now()`;
  });
  return getBizCats(u);
}
const pick = (o: any, ...keys: string[]) => { for (const k of keys) { const v = o?.[k]; if (v !== undefined && v !== null && String(v).trim() !== '') return v; } return null; };
/**
 * 공고(원본 행)에 맞는 사업 키 — ① 원본의 사업 칸(fit_business·business_line 등)에 key·이름·검색어가 있으면 그것, 'both'/'all' 은 전부
 * ② 없으면 제목·단지·분류·검색어 칸에서 사업 검색어로 추정. 결과는 설정 순서.
 */
export function matchBiz(r: any, cats: BizCat[]): BizCat[] {
  if (!cats.length) return [];
  const explicit = JSON.stringify([pick(r, 'fit_business', 'business', 'business_line', 'related_business', 'target_business', 'brand', 'business_categories')]).toLowerCase();
  if (/"(both|all)"|\bboth\b|\ball\b/.test(explicit)) return cats;
  const hit = (text: string, c: BizCat) => text.includes(c.key.toLowerCase()) || text.includes(c.name.toLowerCase()) || c.keywords.some((k) => text.includes(k.toLowerCase()));
  const a = explicit !== '[null]' ? cats.filter((c) => hit(explicit, c)) : [];
  if (a.length) return a;
  const text = [pick(r, 'title', 'notice_title', 'bid_name', 'name'), pick(r, 'complex_name', 'facility_name'), pick(r, 'classification', 'category_label', 'lead_class'), pick(r, 'summary', 'description'),
    (() => { const k = pick(r, 'matched_keywords', 'keywords', 'keyword_hits'); return Array.isArray(k) ? k.join(' ') : k; })()].filter(Boolean).join(' ').toLowerCase();
  return text ? cats.filter((c) => c.keywords.some((k) => text.includes(k.toLowerCase()))) : [];
}
/** 예전 한 칸 호환: 하나면 그 key, 여럿이면 'both', 없으면 null */
export const bizKey = (m: BizCat[]) => (m.length === 1 ? m[0].key : m.length > 1 ? 'both' : null);
