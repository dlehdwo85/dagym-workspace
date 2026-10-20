import type { Sql } from 'postgres';
import { db } from '../db';
import { INDUSTRY_PRESETS } from '../industries';
import { tenantOf, type SessionUser } from '../types';

/**
 * 상용화: AI 비서 문맥 = 이 회사 정보만(회사 이름·업종·회사가 적은 소개·고객·말투·상호) + 쓰는 사람 이름·직책.
 * 다른 회사(예: 다짐·하이링크)의 내용은 프롬프트에 넣지 않는다 — 새로 가입한 회사는 처음부터 자기 업종 기준.
 */
export type CompanyAi = { name: string; industry: string | null; /** 대표 10/20: 업종 여러 개(첫 값 = 주 업종 industry) */ industries: string[]; business: string | null; customers: string | null; tone: string | null; cautions?: string | null; profiles: string[] };
export const industriesOf = (r: { industry?: string | null; industries?: string[] | null } | null | undefined) => { const a = (r?.industries ?? []).filter(Boolean); return a.length ? a : r?.industry ? [r.industry] : []; };

export async function companyAi(u: SessionUser, sql: Sql = db()): Promise<CompanyAi> {
  const t = tenantOf(u);
  const [r] = await sql<{ name: string; industry: string | null; industries: string[]; ai_business: string | null; ai_customers: string | null; ai_tone: string | null; ai_cautions: string | null }[]>`
    select name, industry, industries, ai_business, ai_customers, ai_tone, ai_cautions from tenants where id = ${t}`;
  const profiles = (await sql<{ name: string }[]>`select name from company_profiles where tenant = ${t} order by is_default desc, key limit 5`).map((p) => p.name);
  const inds = industriesOf(r);
  return { name: r?.name ?? '', industry: inds[0] ?? null, industries: inds, business: r?.ai_business ?? null, customers: r?.ai_customers ?? null, tone: r?.ai_tone ?? null, cautions: r?.ai_cautions ?? null, profiles };
}

/** 프롬프트에 붙이는 [우리 회사] 단락 */
export function companyBlock(c: CompanyAi) {
  const inds = c.industries?.length ? c.industries : c.industry ? [c.industry] : [];
  const guide = inds.map((i) => INDUSTRY_PRESETS[i]?.guide).filter(Boolean).join(' / '); // 업종 여러 개면 기본 안내도 모두
  return [`[우리 회사] ${c.name || '(이름 없음)'}${inds.length ? ` · 업종: ${inds.join('·')}` : ''}`,
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
  return { name: c.name, industry: c.industry, industries: c.industries, business: c.business, customers: c.customers, tone: c.tone, cautions: c.cautions ?? null };
}
export async function saveAiProfile(u: SessionUser, i: { industry?: string | null; industries?: string[]; business?: string | null; customers?: string | null; tone?: string | null; cautions?: string | null }) {
  const { requireAnyMenu } = await import('../menuPerms');
  await requireAnyMenu(u, ['company', 'ops'], 'edit');
  const sql = db(); const t = tenantOf(u);
  const v = (x: string | null | undefined) => (x === undefined ? undefined : x?.trim() || null);
  const [cur] = await sql<{ industry: string | null; industries: string[]; ai_business: string | null; ai_customers: string | null; ai_tone: string | null }[]>`select industry, industries, ai_business, ai_customers, ai_tone from tenants where id = ${t}`;
  // 업종: industries[] 가 오면 그대로(첫 값 = 주 업종), 예전 industry 하나만 오면 그 하나로
  const inds = i.industries !== undefined ? [...new Set(i.industries.map((x) => x.trim()).filter(Boolean))] : v(i.industry) === undefined ? industriesOf(cur) : v(i.industry) ? [v(i.industry)!] : [];
  const n = { industry: inds[0] ?? null, industries: inds, business: v(i.business) === undefined ? cur.ai_business : v(i.business)!,
    customers: v(i.customers) === undefined ? cur.ai_customers : v(i.customers)!, tone: v(i.tone) === undefined ? cur.ai_tone : v(i.tone)! };
  await sql`update tenants set industry = ${n.industry}, industries = ${n.industries}, ai_business = ${n.business}, ai_customers = ${n.customers}, ai_tone = ${n.tone} where id = ${t}`;
  if (i.cautions !== undefined) await sql`update tenants set ai_cautions = ${v(i.cautions) ?? null} where id = ${t}`;
  const { audit } = await import('../log');
  await audit(sql, u.id, 'company.ai_profile', null, null, { industry: n.industry, industries: n.industries }, null);
  return getAiProfile(u);
}
