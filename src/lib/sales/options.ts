import { z } from 'zod';
import { db } from '../db';
import { isAdmin } from '../access';
import { assertSpace } from '../spaces';
import { badRequest, forbidden } from '../errors';
import { audit } from '../log';
import { tenantOf, type SessionUser } from '../types';
import { SALES_TEMPLATES, type SalesTerms, salesTemplateList, salesTermsFor, tenantIndustries } from './terms';

/** 영업 공간 회사별 선택 기능 — 입찰·공고 사용(null = 자동 → 켜짐). 끄면 화면·메뉴·카드·하단 탭에서 숨김(공용 수집 데이터는 그대로) */
export async function salesBidsOn(tenant: string) {
  const [t] = await db()<{ sales_bids: boolean | null }[]>`select sales_bids from tenants where id = ${tenant}`;
  return t?.sales_bids ?? true;
}
/** #408 회사 영업 용어(업종 템플릿) — null 이면 회사 업종으로 추정 */
export async function salesTerms(tenant: string): Promise<SalesTerms & { auto: boolean }> {
  const [t] = await db()<{ sales_template: string | null; industries: string[] | null; industry: string | null }[]>`select sales_template, industries, industry from tenants where id = ${tenant}`;
  return salesTermsFor(t?.sales_template, tenantIndustries(t));
}
export async function salesOptions(u: SessionUser) {
  await assertSpace(u, 'sales');
  const [t] = await db()<{ sales_bids: boolean | null; sales_template: string | null; industries: string[] | null; industry: string | null }[]>`select sales_bids, sales_template, industries, industry from tenants where id = ${tenantOf(u)}`;
  const terms = salesTermsFor(t?.sales_template, tenantIndustries(t));
  return { bids: t?.sales_bids ?? true, bidsAuto: t?.sales_bids == null, canEdit: isAdmin(u), template: { code: terms.template, label: terms.label, auto: terms.auto }, terms, templates: salesTemplateList() };
}
export const optionsInput = z.object({ bids: z.boolean().nullable().optional(), template: z.string().max(30).nullable().optional() });
export async function setSalesOptions(u: SessionUser, i: z.infer<typeof optionsInput>) {
  await assertSpace(u, 'sales');
  if (!isAdmin(u)) throw forbidden('영업 기능 설정은 관리자가 바꿉니다');
  if (i.template !== undefined && i.template !== null && !(SALES_TEMPLATES as readonly string[]).includes(i.template)) throw badRequest('없는 업종 템플릿입니다');
  if (i.bids !== undefined) await db()`update tenants set sales_bids = ${i.bids} where id = ${tenantOf(u)}`;
  if (i.template !== undefined) await db()`update tenants set sales_template = ${i.template} where id = ${tenantOf(u)}`;
  await audit(db(), u.id, 'sales.options', 'tenant', null, { bids: i.bids, template: i.template }).catch(() => {});
  return salesOptions(u);
}
