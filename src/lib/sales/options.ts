import { z } from 'zod';
import { db } from '../db';
import { isAdmin } from '../access';
import { assertSpace } from '../spaces';
import { forbidden } from '../errors';
import { audit } from '../log';
import { tenantOf, type SessionUser } from '../types';

/** 영업 공간 회사별 선택 기능 — 입찰·공고 사용(null = 자동 → 켜짐). 끄면 화면·메뉴·카드·하단 탭에서 숨김(공용 수집 데이터는 그대로) */
export async function salesBidsOn(tenant: string) {
  const [t] = await db()<{ sales_bids: boolean | null }[]>`select sales_bids from tenants where id = ${tenant}`;
  return t?.sales_bids ?? true;
}
export async function salesOptions(u: SessionUser) {
  await assertSpace(u, 'sales');
  const [t] = await db()<{ sales_bids: boolean | null }[]>`select sales_bids from tenants where id = ${tenantOf(u)}`;
  return { bids: t?.sales_bids ?? true, bidsAuto: t?.sales_bids == null, canEdit: isAdmin(u) };
}
export const optionsInput = z.object({ bids: z.boolean().nullable() });
export async function setSalesOptions(u: SessionUser, i: z.infer<typeof optionsInput>) {
  await assertSpace(u, 'sales');
  if (!isAdmin(u)) throw forbidden('영업 기능 설정은 관리자가 바꿉니다');
  await db()`update tenants set sales_bids = ${i.bids} where id = ${tenantOf(u)}`;
  await audit(db(), u.id, 'sales.options', 'tenant', null, { bids: i.bids }).catch(() => {});
  return salesOptions(u);
}
