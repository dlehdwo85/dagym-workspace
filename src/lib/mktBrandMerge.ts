import { z } from 'zod';
import { db } from './db';
import { isAdmin } from './access';
import { assertSpace } from './spaces';
import { badRequest, forbidden, notFound } from './errors';
import { zUuid } from './api';
import { audit } from './log';
import { tenantOf, type SessionUser } from './types';

/**
 * #754(대표 10/28 '다짐과 DAGYM 은 같은 브랜드'): 브랜드 합치기 — 합칠 브랜드(from)의 시안·콘텐츠·광고 계정·캠페인 연결·광고 계획·목표·주간 규칙·AI 마케팅팀 기록 등
 * mkt_brands 를 가리키는 모든 칸을 남길 브랜드(into)로 옮기고, from 이름·찾는 낱말은 into 의 찾는 낱말로(광고 캠페인 이름 판정), 키트의 빈 칸은 from 값으로 채운 뒤 from 을 지움.
 * 가리키는 표는 DB 에서 찾음(새 표가 생겨도 빠지지 않게). 같은 달 목표가 둘 다 있으면 into 것을 남김. 광고 예산 비중은 더함. 되돌리기 없음 — 관리자만
 */
export const brandMergeInput = z.object({ into: zUuid });
type Brand = Record<string, any>;
const union = (a: unknown, b: unknown) => [...new Set([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])].map((x) => String(x).trim()).filter(Boolean))];
const emptyJson = (v: unknown) => v == null || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v as object).length) || (Array.isArray(v) && !v.length);

export async function mergeBrand(u: SessionUser, fromId: string, i: z.infer<typeof brandMergeInput>) {
  await assertSpace(u, 'marketing');
  if (!isAdmin(u)) throw forbidden('브랜드 합치기는 관리자가 합니다');
  if (!/^[0-9a-f-]{36}$/i.test(fromId)) throw notFound();
  if (fromId === i.into) throw badRequest('같은 브랜드끼리는 합칠 수 없습니다');
  const t = tenantOf(u);
  const out = await db().begin(async (tx) => {
    const rows = await tx<Brand[]>`select * from mkt_brands where tenant = ${t} and id in (${fromId}, ${i.into}) for update`;
    const from = rows.find((b) => b.id === fromId), into = rows.find((b) => b.id === i.into);
    if (!from || !into) throw notFound('브랜드를 찾을 수 없습니다');
    // 같은 달 목표가 둘 다 있으면 남길 브랜드 것을 둠(목표 표는 회사·브랜드·달마다 하나)
    const dropGoals = await tx`delete from mkt_goals g where g.tenant = ${t} and g.brand_id = ${fromId}
      and exists (select 1 from mkt_goals x where x.tenant = g.tenant and x.brand_id = ${i.into} and x.month = g.month) returning g.id`;
    const refs = await tx<{ tbl: string; col: string }[]>`select c.conrelid::regclass::text as tbl, a.attname as col from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey) where c.contype = 'f' and c.confrelid = 'mkt_brands'::regclass order by 1, 2`;
    const moved: Record<string, number> = {};
    for (const r of refs) {
      if (!/^[a-z_][a-z0-9_.]*$/.test(r.tbl) || !/^[a-z_][a-z0-9_]*$/.test(r.col)) continue; // DB 카탈로그 이름만(따옴표가 필요한 이름은 없음)
      const res = await tx.unsafe(`update ${r.tbl} set ${r.col} = $1 where ${r.col} = $2`, [i.into, fromId]);
      if (res.count) moved[r.tbl] = (moved[r.tbl] ?? 0) + res.count;
    }
    // 광고 예산 브랜드별 계획(jsonb [{brandId, monthly…}]) — from 줄을 into 로(같은 달에 둘 다 있으면 금액 더함)
    const budgets = await tx<{ id: string; brand_plan: any[] }[]>`select id, brand_plan from mkt_ad_budgets where tenant = ${t} and jsonb_typeof(brand_plan) = 'array' and brand_plan::text like ${`%${fromId}%`}`;
    for (const b of budgets) {
      const plan: any[] = []; for (const x of b.brand_plan) {
        const id = String(x?.brandId ?? '') === fromId ? i.into : x?.brandId; const same = plan.find((y) => y?.brandId && y.brandId === id);
        if (same && id === i.into) { same.monthly = Number(same.monthly ?? 0) + Number(x?.monthly ?? 0); continue; }
        plan.push({ ...x, ...(x?.brandId ? { brandId: id } : {}) });
      }
      await tx`update mkt_ad_budgets set brand_plan = ${tx.json(plan)} where id = ${b.id}`;
    }
    // 키트: 찾는 낱말 = into 것 + from 이름 + from 찾는 낱말 · 목록 칸은 합침 · 빈 칸은 from 값으로 · 광고 비중은 더함
    const aliases = union(into.ad_aliases, [from.name, ...(from.ad_aliases ?? [])]).filter((x) => x !== into.name);
    const txt = (k: string) => (String(into[k] ?? '').trim() ? into[k] : from[k] ?? null);
    const js = (k: string) => (emptyJson(into[k]) ? from[k] ?? into[k] : into[k]);
    const share = into.ad_share == null && from.ad_share == null ? null : Number(into.ad_share ?? 0) + Number(from.ad_share ?? 0);
    await tx`update mkt_brands set ad_aliases = ${aliases}::text[], banned_words = ${union(into.banned_words, from.banned_words)}::text[], colors = ${union(into.colors, from.colors)}::text[],
      topic_pool = ${union(into.topic_pool, from.topic_pool)}::text[], tone = ${txt('tone')}, intro = ${txt('intro')}, products = ${txt('products')}, weekly_topic = ${txt('weekly_topic')}, ad_note = ${txt('ad_note')},
      ad_priority = ${into.ad_priority ?? from.ad_priority ?? null}, ad_share = ${share}, voice = ${tx.json(js('voice') ?? {})}, video = ${tx.json(js('video') ?? {})}, feed = ${tx.json(js('feed') ?? {})},
      facts = ${tx.json(js('facts') ?? {})}, examples = ${tx.json(js('examples') ?? [])} where id = ${i.into}`;
    await tx`delete from mkt_brands where id = ${fromId}`;
    return { from: { id: from.id, name: from.name }, into: { id: into.id, name: into.name }, moved, goalsDropped: dropGoals.length, budgets: budgets.length, aliases };
  });
  await audit(db(), u.id, 'marketing.brand_merge', 'mkt_brand', i.into, { from: out.from, into: out.into, moved: out.moved, goalsDropped: out.goalsDropped }).catch(() => {});
  return out;
}
