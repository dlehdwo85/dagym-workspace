import type { Sql } from 'postgres';
import { db } from '../db';
import { INDUSTRY_PRESETS } from '../industries';
import { tenantOf, type SessionUser } from '../types';

/**
 * 상용화: AI 비서 문맥 = 이 회사 정보만(회사 이름·업종·회사가 적은 소개·고객·말투·상호) + 쓰는 사람 이름·직책.
 * 다른 회사(예: 다짐·하이링크)의 내용은 프롬프트에 넣지 않는다 — 새로 가입한 회사는 처음부터 자기 업종 기준.
 */
export type CompanyAi = { name: string; industry: string | null; business: string | null; customers: string | null; tone: string | null; cautions?: string | null; profiles: string[] };

export async function companyAi(u: SessionUser, sql: Sql = db()): Promise<CompanyAi> {
  const t = tenantOf(u);
  const [r] = await sql<{ name: string; industry: string | null; ai_business: string | null; ai_customers: string | null; ai_tone: string | null; ai_cautions: string | null }[]>`
    select name, industry, ai_business, ai_customers, ai_tone, ai_cautions from tenants where id = ${t}`;
  const profiles = (await sql<{ name: string }[]>`select name from company_profiles where tenant = ${t} order by is_default desc, key limit 5`).map((p) => p.name);
  return { name: r?.name ?? '', industry: r?.industry ?? null, business: r?.ai_business ?? null, customers: r?.ai_customers ?? null, tone: r?.ai_tone ?? null, cautions: r?.ai_cautions ?? null, profiles };
}

/** 프롬프트에 붙이는 [우리 회사] 단락 */
export function companyBlock(c: CompanyAi) {
  const guide = c.industry ? INDUSTRY_PRESETS[c.industry]?.guide : '';
  return [`[우리 회사] ${c.name || '(이름 없음)'}${c.industry ? ` · 업종: ${c.industry}` : ''}`,
    c.profiles.length ? `상호: ${c.profiles.join(', ')}` : '',
    c.business ? `사업 소개·방향: ${c.business}` : '',
    c.customers ? `주요 고객: ${c.customers}` : '',
    c.tone ? `말투: ${c.tone}` : '',
    c.cautions ? `주의할 점(지킬 것): ${c.cautions}` : '',
    guide ? `업종 기본: ${guide}` : ''].filter(Boolean).join('\n');
}

/** 쓰는 사람: 이름·직책 — 메일·문자 초안의 어조와 맺음말에 쓴다 */
export async function writerOf(u: SessionUser, sql: Sql = db()) {
  const [r] = await sql<{ name: string; title: string | null }[]>`select name, coalesce(nullif(title, ''), nullif(title_short, '')) title from users where id = ${u.id}`;
  return { name: r?.name ?? u.name, title: r?.title ?? null };
}
export const writerLine = (w: { name: string; title: string | null }) => `[쓰는 사람] ${w.name}${w.title ? ` (${w.title})` : ''}`;

/** 회사 정보 화면: AI 비서가 알아야 할 우리 회사(업종·사업 소개·주요 고객·말투) — 회사 정보·디자인 권한 */
export async function getAiProfile(u: SessionUser) {
  const { requireAnyMenu } = await import('../menuPerms');
  await requireAnyMenu(u, ['company', 'ops'], 'view');
  const c = await companyAi(u);
  return { name: c.name, industry: c.industry, business: c.business, customers: c.customers, tone: c.tone, cautions: c.cautions ?? null };
}
export async function saveAiProfile(u: SessionUser, i: { industry?: string | null; business?: string | null; customers?: string | null; tone?: string | null; cautions?: string | null }) {
  const { requireAnyMenu } = await import('../menuPerms');
  await requireAnyMenu(u, ['company', 'ops'], 'edit');
  const sql = db(); const t = tenantOf(u);
  const v = (x: string | null | undefined) => (x === undefined ? undefined : x?.trim() || null);
  const [cur] = await sql<{ industry: string | null; ai_business: string | null; ai_customers: string | null; ai_tone: string | null }[]>`select industry, ai_business, ai_customers, ai_tone from tenants where id = ${t}`;
  const n = { industry: v(i.industry) === undefined ? cur.industry : v(i.industry)!, business: v(i.business) === undefined ? cur.ai_business : v(i.business)!,
    customers: v(i.customers) === undefined ? cur.ai_customers : v(i.customers)!, tone: v(i.tone) === undefined ? cur.ai_tone : v(i.tone)! };
  await sql`update tenants set industry = ${n.industry}, ai_business = ${n.business}, ai_customers = ${n.customers}, ai_tone = ${n.tone} where id = ${t}`;
  if (i.cautions !== undefined) await sql`update tenants set ai_cautions = ${v(i.cautions) ?? null} where id = ${t}`;
  const { audit } = await import('../log');
  await audit(sql, u.id, 'company.ai_profile', null, null, { industry: n.industry }, null);
  return getAiProfile(u);
}
