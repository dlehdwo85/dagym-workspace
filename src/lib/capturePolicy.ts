// #626 화면 캡처 차단(대표 10/25 20:05 · 설계 docs/research/CAPTURE_BLOCK_DESIGN_2026-10-25.md): 정책 판정은 서버가 한 번 —
// 우리 회사(default)·체험(demo)·슈퍼관리자(SUPER_ADMIN_EMAILS)는 허용, 외부 고객사는 기본 차단(플랫폼 운영 › 회사 상세에서 회사별로 끔, 사유·감사 기록).
// 웹은 '캡처 불가'를 만들 수 없다(OS 캡처키·휴대폰 캡처·카메라는 브라우저가 모름): 워터마크·인쇄 차단·창 이탈 가림·자동화 브라우저 차단 = 억제 + 출처 추적.
// 실제 차단은 안드로이드 앱(FLAG_SECURE, 네이티브는 로컬). CAPTURE_BLOCK=0 전부 끔(개발) · 'noauto' = 자동화 감지·봇 로그인 거부만 끔(시험 서버 — Playwright·node fetch 가 막히지 않게) · 없으면(운영) 전부.
import { z } from 'zod';
import { db, type Sql } from './db';
import { notFound } from './errors';
import { audit } from './log';
import { INTERNAL_TENANT } from './customerScope';
import { superAdmin } from './superAdmin';
import { tenantOf, type SessionUser } from './types';

export type CapturePolicy = { block: boolean; automation: boolean; reason: 'env' | 'internal' | 'demo' | 'super_admin' | 'tenant_off' | 'on' };
export function capturePolicy(i: { tenant: string; override: boolean | null | undefined; email: string; platformAdmin: boolean }): CapturePolicy {
  const env = process.env.CAPTURE_BLOCK ?? '';
  const off = (reason: CapturePolicy['reason']): CapturePolicy => ({ block: false, automation: false, reason });
  if (env === '0') return off('env');
  if (i.tenant === INTERNAL_TENANT) return off('internal');
  if (i.tenant === 'demo') return off('demo');
  if (superAdmin(i.email, i.platformAdmin)) return off('super_admin');
  if (i.override === false) return off('tenant_off');
  return { block: true, automation: env !== 'noauto', reason: 'on' };
}
/** 세션 사용자의 정책(회사 스위치 포함) — 레이아웃 세션·/api/auth/me·사건 기록이 같은 판정을 쓴다 */
export async function captureFor(u: Pick<SessionUser, 'email' | 'platformAdmin' | 'tenant' | 'isDemo'>, sql: Sql = db()) {
  const t = tenantOf(u);
  const [row] = await sql<{ capture_block: boolean | null }[]>`select capture_block from tenants where id = ${t}`;
  return capturePolicy({ tenant: t, override: row?.capture_block, email: u.email, platformAdmin: !!u.platformAdmin });
}
/** 봇·헤드리스·스크립트 UA(외부 고객사 로그인 거부 대상) — 위장한 자동화는 못 잡는다 */
export const automatedUserAgent = (ua: string | null | undefined) =>
  !ua || /HeadlessChrome|PhantomJS|Puppeteer|Playwright|Selenium|python-requests|python-urllib|aiohttp|httpx\/|Go-http-client|Java\/|libwww|curl\/|Wget\/|Scrapy|\bbot\b|spider|crawler|node-fetch|undici|axios\//i.test(ua);

export const tenantCaptureInput = z.object({ on: z.boolean(), note: z.string().trim().max(200).optional() });
/** 플랫폼 운영(슈퍼관리자) › 회사 상세 '화면 캡처 차단' 스위치 — 끌 때 사유 한 줄(감사 기록). 우리 회사·체험은 정책상 늘 허용이라 스위치가 영향 없음 */
export async function setTenantCapture(u: SessionUser, tenant: string, i: z.infer<typeof tenantCaptureInput>, ip: string | null) {
  if (!superAdmin(u.email, !!u.platformAdmin)) throw notFound();
  const sql = db();
  const [t] = await sql<{ id: string }[]>`select id from tenants where id = ${tenant}`;
  if (!t) throw notFound('없는 회사입니다');
  const note = i.on ? null : (i.note ?? null);
  await sql`update tenants set capture_block = ${i.on}, capture_note = ${note} where id = ${tenant}`;
  await audit(sql, u.id, 'platform.capture_block', 'tenant', null, { tenant, on: i.on, note: i.note ?? null }, ip).catch(() => {});
  return { tenant, captureBlock: i.on, note };
}

export const captureEventInput = z.object({ kind: z.enum(['print', 'printscreen', 'automation', 'screenshot', 'recording']), path: z.string().max(300).optional() });
/** 화면이 감지한 사건만 기록(화면 내용·기기 식별값 없음, 주소는 경로만). 같은 사람·같은 종류 10분에 1건. 정책이 꺼진 사람(우리 회사 등)은 기록 안 함 */
export async function recordCaptureEvent(u: SessionUser, i: z.infer<typeof captureEventInput>, ip: string | null) {
  const sql = db();
  const policy = await captureFor(u, sql);
  if (!policy.block) return { recorded: false, skipped: 'off' as const };
  const [dup] = await sql<{ one: number }[]>`select 1 as one from audit_logs where actor_id = ${u.id} and action = 'security.capture_event' and detail->>'kind' = ${i.kind} and created_at > now() - interval '10 minutes' limit 1`;
  if (dup) return { recorded: false, skipped: 'recent' as const };
  const path = (i.path ?? '').split('?')[0].slice(0, 200) || null;
  await audit(sql, u.id, 'security.capture_event', 'tenant', null, { tenant: tenantOf(u), kind: i.kind, path }, ip);
  return { recorded: true };
}
/** 플랫폼 운영 회사 상세: 최근 30일 캡처 사건 수 */
export async function captureEventCount(tenant: string, sql: Sql = db()) {
  const [r] = await sql<{ n: number }[]>`select count(*)::int n from audit_logs where action = 'security.capture_event' and detail->>'tenant' = ${tenant} and created_at > now() - interval '30 days'`;
  return r?.n ?? 0;
}
