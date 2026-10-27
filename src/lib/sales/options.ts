import { z } from 'zod';
import { db } from '../db';
import { isAdmin } from '../access';
import { assertSpace } from '../spaces';
import { badRequest, forbidden } from '../errors';
import { audit } from '../log';
import { tenantOf, type SessionUser } from '../types';
import { HIDEABLE_STAGES, LEAD_STAGES, SALES_TEMPLATES, STAGE_LABEL_MAX, type SalesTerms, salesTemplateList, salesTermsFor, tenantIndustries } from './terms';

/** 영업 공간 회사별 선택 기능 — 입찰·공고 사용(null = 자동 → 켜짐). 끄면 화면·메뉴·카드·하단 탭에서 숨김(공용 수집 데이터는 그대로) */
export async function salesBidsOn(tenant: string) {
  const [t] = await db()<{ sales_bids: boolean | null }[]>`select sales_bids from tenants where id = ${tenant}`;
  return t?.sales_bids ?? true;
}
/** #408 회사 영업 용어(업종 템플릿) — null 이면 회사 업종으로 추정 */
export async function salesTerms(tenant: string): Promise<SalesTerms & { auto: boolean }> {
  const [t] = await db()<{ sales_template: string | null; industries: string[] | null; industry: string | null; sales_stages: unknown }[]>`select sales_template, industries, industry, sales_stages from tenants where id = ${tenant}`;
  return salesTermsFor(t?.sales_template, tenantIndustries(t), t?.sales_stages);
}
export async function salesOptions(u: SessionUser) {
  await assertSpace(u, 'sales');
  const [t] = await db()<{ sales_bids: boolean | null; sales_template: string | null; industries: string[] | null; industry: string | null; sales_stages: unknown }[]>`select sales_bids, sales_template, industries, industry, sales_stages from tenants where id = ${tenantOf(u)}`;
  const terms = salesTermsFor(t?.sales_template, tenantIndustries(t), t?.sales_stages);
  return { bids: t?.sales_bids ?? true, bidsAuto: t?.sales_bids == null, canEdit: isAdmin(u), template: { code: terms.template, label: terms.label, auto: terms.auto }, terms, templates: salesTemplateList() };
}
/** 207차: 단계 표시 이름·색·숨김 — null = 기본 이름으로 되돌림 */
const stageInput = z.object({ label: z.string().trim().max(STAGE_LABEL_MAX, `단계 이름은 ${STAGE_LABEL_MAX}자까지`).optional(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(), hidden: z.boolean().optional() });
export const optionsInput = z.object({ bids: z.boolean().nullable().optional(), template: z.string().max(30).nullable().optional(), stages: z.record(z.string(), stageInput).nullable().optional() });
/** 단계 설정 검사 → 저장할 값(기본과 다른 것만) */
function stagesToSave(stages: Record<string, z.infer<typeof stageInput>>) {
  const keys = LEAD_STAGES as readonly string[]; const out: Record<string, { label?: string; color?: string; hidden?: true }> = {}; const seen = new Map<string, string>();
  for (const [k, v] of Object.entries(stages)) if (!keys.includes(k)) throw badRequest(`없는 단계입니다: ${k}`);
  for (const k of keys) {
    const v = stages[k] ?? {}; const label = v.label?.trim() || k;
    const norm = label.replace(/\s+/g, '').toLowerCase();
    if (seen.has(norm)) throw badRequest(`단계 이름 '${label}'이(가) '${seen.get(norm)}'와(과) 겹칩니다`);
    seen.set(norm, label);
    if (v.hidden && !HIDEABLE_STAGES.has(k)) throw badRequest(`'${label}' 단계는 숨길 수 없습니다 — 처음·종결 단계는 규칙이 걸려 있어 이름·색만 바꿉니다`);
    const o: { label?: string; color?: string; hidden?: true } = {};
    if (label !== k) o.label = label;
    if (v.color) o.color = v.color.toLowerCase();
    if (v.hidden) o.hidden = true;
    if (Object.keys(o).length) out[k] = o;
  }
  if (keys.filter((k) => HIDEABLE_STAGES.has(k)).every((k) => out[k]?.hidden)) throw badRequest('진행 단계를 모두 숨길 수는 없습니다 — 하나 이상 남겨 두세요');
  return Object.keys(out).length ? out : null;
}
export async function setSalesOptions(u: SessionUser, i: z.infer<typeof optionsInput>) {
  await assertSpace(u, 'sales');
  if (!isAdmin(u)) throw forbidden('영업 기능 설정은 관리자가 바꿉니다');
  if (i.template !== undefined && i.template !== null && !(SALES_TEMPLATES as readonly string[]).includes(i.template)) throw badRequest('없는 업종 템플릿입니다');
  if (i.bids !== undefined) await db()`update tenants set sales_bids = ${i.bids} where id = ${tenantOf(u)}`;
  if (i.template !== undefined) await db()`update tenants set sales_template = ${i.template} where id = ${tenantOf(u)}`;
  const stages = i.stages === undefined ? undefined : i.stages === null ? null : stagesToSave(i.stages);
  if (stages !== undefined) await db()`update tenants set sales_stages = ${stages ? db().json(stages) : null} where id = ${tenantOf(u)}`;
  await audit(db(), u.id, 'sales.options', 'tenant', null, { bids: i.bids, template: i.template, stages: stages === undefined ? undefined : stages ? Object.keys(stages) : 'reset' }).catch(() => {});
  return salesOptions(u);
}
