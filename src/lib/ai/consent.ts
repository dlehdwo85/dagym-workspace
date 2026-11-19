import { AsyncLocalStorage } from 'node:async_hooks';
import { z } from 'zod';
import { db, type Sql } from '../db';
import { HttpError } from '../errors';
import { audit } from '../log';
import type { SessionUser } from '../types';
import { AI_CONSENT_CODE, AI_CONSENT_KIND, AI_CONSENT_MSG, aiNoticeVersion } from './consentCopy';
import { sttConfigured } from './stt';

/**
 * AI 동의(대표 11/19 결정 — 애플 5.1.2): 사람이 누른 요청에서 바깥 AI(Anthropic·받아쓰기)로 내용이 나가기 전에 그 사람의 동의를 확인한다.
 * - 기록: consents(kind = 'ai_share', version = 안내 글 판). 가장 최근 줄이 지금 상태, 판이 바뀌면 다시 묻는다(none).
 * - 확인하는 곳 두 겹: ① assertAiRequest(사람이 쓰는 AI 기능의 공통 들머리 — 조용히 비켜 가는 흐름이 여기서 갈림)
 *   ② 바깥 호출 바로 앞(provider·stt·tts) — 요청을 보낸 사람을 handler 가 aiScope 에 적어 두고, 여기서 한 번 더 본다(빠진 들머리가 있어도 막힘).
 * - 사람이 누르지 않은 자동 작업(정기 작업·바깥에서 들어온 문의)은 회사 스위치(tenants.ai_auto)로 가린다 — companyAiAuto.
 */
export type AiConsentState = 'agreed' | 'declined' | 'none';
export const aiConsentVersion = () => aiNoticeVersion(sttConfigured());
/** 시험 서버 전용: 아직 정하지 않은 사람·회사를 '동의함·켜짐'으로 본다(기존 시험 수백 개가 AI 를 그대로 쓰게). 운영(Vercel)에서는 이 값을 줘도 듣지 않는다 */
const testDefault = () => process.env.AI_CONSENT_DEFAULT === 'agreed' && !process.env.VERCEL;

export async function aiConsentOf(userId: string, sql: Sql = db()) {
  const version = aiConsentVersion();
  const [c] = await sql<{ agreed: boolean; version: string; created_at: Date }[]>`
    select agreed, version, created_at from consents where user_id = ${userId} and kind = ${AI_CONSENT_KIND} order by created_at desc limit 1`;
  // 판이 달라졌으면(받는 곳이 늘었으면) 예전 동의는 지금 글에 대한 동의가 아니다 → 다시 묻는다. 거부는 판이 바뀌어도 거부로 둔다(다시 조르지 않음)
  const state: AiConsentState = !c ? (testDefault() ? 'agreed' : 'none') : !c.agreed ? 'declined' : c.version === version ? 'agreed' : 'none';
  return { state, at: c?.created_at ?? null, version, stt: sttConfigured() };
}

export const aiConsentInput = z.object({ agreed: z.boolean() });
export async function setAiConsent(u: SessionUser, i: z.infer<typeof aiConsentInput>, ip: string | null) {
  const sql = db();
  const version = aiConsentVersion();
  // consents 기본 키 = (사람·종류·판) — 같은 판이면 덮어쓰고 시각을 새로(바뀐 내역은 감사 기록에 남는다)
  await sql`insert into consents (user_id, kind, version, agreed) values (${u.id}, ${AI_CONSENT_KIND}, ${version}, ${i.agreed})
    on conflict (user_id, kind, version) do update set agreed = excluded.agreed, created_at = now()`;
  await audit(sql, u.id, i.agreed ? 'consent.ai_agree' : 'consent.ai_withdraw', 'user', u.id, { version }, ip);
  return aiConsentOf(u.id, sql);
}

export const aiConsentError = () => new HttpError(403, AI_CONSENT_CODE, AI_CONSENT_MSG);
/** 이 사람이 지금 글에 동의했는지 — 아니면 403 ai_consent(화면이 동의 창을 띄운다) */
export async function assertAiConsent(u: { id: string }, sql: Sql = db()) {
  if ((await aiConsentOf(u.id, sql)).state !== 'agreed') throw aiConsentError();
}

/** 요청을 보낸 사람(handler 가 적음). 정기 작업·공개 주소처럼 사람이 없으면 비어 있다 */
export const aiScope = new AsyncLocalStorage<{ userId?: string; ok?: Promise<void> }>();
/** 바깥 AI 호출 바로 앞: 요청을 보낸 사람이 있으면 그 사람의 동의를 본다(한 요청에 한 번만 조회). 사람이 없는 자동 작업은 지나간다(회사 스위치는 작업 들머리에서) */
export async function assertScopeConsent() {
  const s = aiScope.getStore();
  if (!s?.userId) return;
  s.ok ??= assertAiConsent({ id: s.userId });
  await s.ok;
}

/** 회사 스위치 '회사 자료 자동 AI 처리' — 사람이 누르지 않아도 도는 작업(문의 한 줄 요약 등)이 바깥 AI 를 써도 되는지 */
export async function companyAiAuto(tenant: string, sql: Sql = db()) {
  const [t] = await sql<{ ai_auto: boolean; ai_auto_at: Date | null }[]>`select ai_auto, ai_auto_at from tenants where id = ${tenant}`;
  if (t && !t.ai_auto_at && testDefault()) return true;
  return !!t?.ai_auto;
}
/** 관리 › 회사 정보의 스위치 보기 */
export async function getCompanyAiAuto(u: SessionUser) {
  const tenant = (await import('../plans')).tenantOfUser(u);
  const [t] = await db()<{ ai_auto: boolean; ai_auto_at: Date | null }[]>`select ai_auto, ai_auto_at from tenants where id = ${tenant}`;
  return { on: !!t?.ai_auto, at: t?.ai_auto_at ?? null };
}
export const aiAutoInput = z.object({ on: z.boolean() });
/** 켜기·끄기 — 회사 정보·디자인 편집 권한(다른 회사 설정과 같은 권한) */
export async function setCompanyAiAuto(u: SessionUser, i: z.infer<typeof aiAutoInput>, ip: string | null) {
  await (await import('../menuPerms')).requireAnyMenu(u, ['company', 'ops'], 'edit');
  const sql = db();
  const tenant = (await import('../plans')).tenantOfUser(u);
  await sql`update tenants set ai_auto = ${i.on}, ai_auto_at = now(), ai_auto_by = ${u.id} where id = ${tenant}`;
  await audit(sql, u.id, i.on ? 'tenant.ai_auto_on' : 'tenant.ai_auto_off', 'tenant', null, { tenant }, ip);
  return getCompanyAiAuto(u);
}
