import { createRemoteJWKSet, decodeJwt, importPKCS8, jwtVerify, SignJWT, type JWTPayload } from 'jose';
import { db } from './db';
import { decrypt, encrypt } from './crypto';

/**
 * 299차 #858(대표 10/31 '애플로 로그인 개발 진행해주세요'): Apple로 로그인(웹·안드로이드·아이폰 시스템 브라우저 공용 — Services ID 로).
 * - 운영 환경 변수(값은 대표가 Vercel 에, 저장소에 쓰지 않음): APPLE_TEAM_ID · APPLE_SERVICES_ID · APPLE_KEY_ID · APPLE_PRIVATE_KEY(.p8 내용). 넷 다 있어야 버튼이 보임.
 * - 돌아올 때 POST(form_post) → 콜백이 같은 주소 GET 으로 넘김(로그인 세션 쿠키가 실리게). 이름은 처음 한 번만 옴.
 * - 클라이언트 비밀 = 키로 서명한 짧은 JWT(ES256) · id_token 은 Apple 공개 키로 서명·발급자·대상 확인.
 * - 토큰(refresh)은 암호화 보관 → 계정 삭제·연결 끊기 때 해지(App Store 5.1.1(v)).
 * - OAUTH_TEST_BASE 가 있으면 모든 주소를 그 서버로(가짜 Apple 시험용).
 */
export const APPLE_ISS = 'https://appleid.apple.com';
export function appleEnv() {
  const teamId = process.env.APPLE_TEAM_ID?.trim() ?? '', servicesId = process.env.APPLE_SERVICES_ID?.trim() ?? '', keyId = process.env.APPLE_KEY_ID?.trim() ?? '';
  const privateKey = (process.env.APPLE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n').trim();
  if (!teamId || !servicesId || !keyId || !privateKey) return null;
  const t = process.env.OAUTH_TEST_BASE?.replace(/\/$/, '');
  const base = t ? `${t}/oauth/apple` : `${APPLE_ISS}/auth`;
  return { teamId, servicesId, keyId, privateKey, auth: `${base}/authorize`, token: `${base}/token`, keys: `${base}/keys`, revoke: `${base}/revoke` };
}
type Env = NonNullable<ReturnType<typeof appleEnv>>;

const jwks = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
const keySet = (url: string) => { let k = jwks.get(url); if (!k) { k = createRemoteJWKSet(new URL(url)); jwks.set(url, k); } return k; };

/** 클라이언트 비밀(5분) — Apple 이 요구하는 ES256 JWT */
async function clientSecret(e: Env) {
  const key = await importPKCS8(e.privateKey, 'ES256');
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({}).setProtectedHeader({ alg: 'ES256', kid: e.keyId }).setIssuer(e.teamId).setSubject(e.servicesId).setAudience(APPLE_ISS)
    .setIssuedAt(now).setExpirationTime(now + 300).sign(key);
}

/** Apple 이 보낸 JWT(id_token·서버 알림) 확인 — 서명·발급자·대상 */
export async function verifyApple(token: string): Promise<JWTPayload> {
  const e = appleEnv();
  if (!e) throw new Error('Apple 로그인이 설정되지 않았습니다');
  const { payload } = await jwtVerify(token, keySet(e.keys), { issuer: APPLE_ISS, audience: e.servicesId });
  return payload;
}

/**
 * 로컬 11/21 #1094: 애플 로그인이 '최종 단계에서 실패'했는데 이유가 서버에 남지 않았다(실패하면 null 만).
 * 실패 이유를 짧은 코드로 남긴다 — 비밀값·인가 코드·토큰·이메일은 남기지 않음(애플이 돌려준 error 이름, 상태 번호, id_token 의 aud·iss·만료 시각만).
 */
export class AppleLoginFail extends Error {
  constructor(public reason: string, public detail: Record<string, string | number | null> = {}) { super(`apple:${reason}`); }
}
/** 인가 코드 → 토큰 → id_token 확인 → 프로필(이메일·고유 번호) + 해지용 토큰(암호화) */
export async function appleProfile(code: string, redirectUri: string) {
  const e = appleEnv();
  if (!e) throw new AppleLoginFail('not_configured');
  let secret: string;
  try { secret = await clientSecret(e); } catch (x) { throw new AppleLoginFail('key_parse', { msg: String((x as Error)?.message ?? '').slice(0, 80) }); } // .p8 모양이 틀림
  const form = new URLSearchParams({ grant_type: 'authorization_code', client_id: e.servicesId, client_secret: secret, code, redirect_uri: redirectUri });
  let r: Response;
  try { r = await fetch(e.token, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form, signal: AbortSignal.timeout(10_000) }); }
  catch (x) { throw new AppleLoginFail('token_network', { msg: String((x as Error)?.name ?? '') }); }
  const j = await r.json().catch(() => ({})) as { id_token?: string; refresh_token?: string; error?: string; error_description?: string };
  // invalid_client = 키·팀 ID·키 ID·서비스 ID 가 맞지 않음 · invalid_grant = 코드가 틀림·만료·이미 씀, 또는 redirect_uri 가 인증 때와 다름
  if (!r.ok || !j.id_token) throw new AppleLoginFail(`token_${String(j.error ?? r.status).replace(/[^a-z0-9_]/gi, '').slice(0, 40)}`, { status: r.status, redirect: redirectUri });
  let c: JWTPayload;
  try { c = await verifyApple(j.id_token); }
  catch (x) {
    let claims: JWTPayload = {}; try { claims = decodeJwt(j.id_token); } catch { /* 모양부터 틀림 */ }
    const aud = Array.isArray(claims.aud) ? claims.aud.join(',') : claims.aud ?? null;
    throw new AppleLoginFail('id_token', { code: String((x as { code?: string })?.code ?? '').slice(0, 60), msg: String((x as Error)?.message ?? '').slice(0, 100),
      aud: aud ? String(aud).slice(0, 80) : null, expectAud: e.servicesId, iss: claims.iss ? String(claims.iss).slice(0, 60) : null, exp: typeof claims.exp === 'number' ? claims.exp : null, now: Math.floor(Date.now() / 1000) });
  }
  if (!c?.sub) throw new AppleLoginFail('no_sub');
  const email = typeof c.email === 'string' ? c.email : null;
  return { subject: String(c.sub), email, emailVerified: c.email_verified === true || c.email_verified === 'true', name: null as string | null,
    secret: j.refresh_token ? encrypt(j.refresh_token) : null };
}

/**
 * 로컬 11/21 #1094 운영 자가 점검(플랫폼 운영자 전용): 가짜 인가 코드로 애플 토큰 주소를 불러, 돌아오는 error 로 설정을 가린다.
 * invalid_grant = 클라이언트 비밀 서명은 받아들여짐(키·팀 ID·키 ID·서비스 ID 맞음) · invalid_client = 그 넷 중 하나가 틀림. 실제 로그인·계정은 건드리지 않음.
 */
export async function appleSelfCheck(redirectUri: string) {
  const e = appleEnv();
  if (!e) return { configured: false as const, verdict: 'Apple 로그인 환경 변수 4개(APPLE_TEAM_ID·APPLE_SERVICES_ID·APPLE_KEY_ID·APPLE_PRIVATE_KEY) 중 빠진 것이 있습니다' };
  let secret: string;
  try { secret = await clientSecret(e); } catch (x) { return { configured: true as const, ok: false, error: 'key_parse', verdict: `APPLE_PRIVATE_KEY(.p8 내용)를 읽지 못했습니다 — 줄바꿈·머리줄 확인 (${String((x as Error)?.message ?? '').slice(0, 80)})` }; }
  const form = new URLSearchParams({ grant_type: 'authorization_code', client_id: e.servicesId, client_secret: secret, code: 'workin-selfcheck-not-a-real-code', redirect_uri: redirectUri });
  const r = await fetch(e.token, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form, signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!r) return { configured: true as const, ok: false, error: 'network', verdict: '애플 토큰 주소에 닿지 못했습니다(잠시 뒤 다시)' };
  const j = await r.json().catch(() => ({})) as { error?: string };
  const err = String(j.error ?? r.status);
  const verdict = err === 'invalid_grant' ? '정상 — 클라이언트 비밀 서명을 애플이 받아들였습니다(키·팀 ID·키 ID·서비스 ID 맞음). 실제 로그인이 실패하면 redirect 주소(애플 개발자 화면의 Return URL)와 id_token 확인 쪽을 보세요.'
    : err === 'invalid_client' ? '설정 문제 — 애플이 클라이언트를 거절했습니다. APPLE_TEAM_ID·APPLE_KEY_ID·APPLE_SERVICES_ID 가 애플 개발자 화면과 같은지, 키가 그 서비스 ID 의 "Sign in with Apple" 에 연결돼 있는지 확인하세요.'
    : `예상 밖 응답(${err}) — 애플 상태를 확인하세요.`;
  return { configured: true as const, ok: err === 'invalid_grant', error: err, servicesId: e.servicesId, teamId: e.teamId, keyId: e.keyId, redirectUri, verdict };
}

/** 처음 한 번 오는 이름(form 의 user JSON) — 한글이면 성+이름, 아니면 이름 성 */
export function appleName(user: string | null | undefined): string | null {
  if (!user) return null;
  try {
    const n = (JSON.parse(user) as { name?: { firstName?: string; lastName?: string } }).name ?? {};
    const f = String(n.firstName ?? '').trim(), l = String(n.lastName ?? '').trim();
    if (!f && !l) return null;
    return (/[가-힣]/.test(f + l) ? `${l}${f}` : `${f} ${l}`).trim().slice(0, 50);
  } catch { return null; }
}

/** 해지 — 계정 삭제·연결 끊기 때(실패해도 삭제는 계속, 기록만) */
export async function revokeApple(secretEnc: string | null | undefined) {
  const e = appleEnv();
  if (!e || !secretEnc) return false;
  let token: string; try { token = decrypt(secretEnc); } catch { return false; }
  const form = new URLSearchParams({ client_id: e.servicesId, client_secret: await clientSecret(e), token, token_type_hint: 'refresh_token' });
  const r = await fetch(e.revoke, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form, signal: AbortSignal.timeout(10_000) }).catch(() => null);
  return !!r?.ok;
}
/** 이 사람의 Apple 연결 해지(응답 뒤) — 계정 삭제 */
export async function revokeAppleFor(tx: any, userId: string) {
  const rows: { secret: string | null }[] = await tx`select secret from user_identities where user_id = ${userId} and provider = 'apple' and secret is not null`;
  if (!rows.length) return;
  (await import('./later')).runLater('appleRevoke', async () => ({ revoked: (await Promise.all(rows.map((r) => revokeApple(r.secret)))).filter(Boolean).length }));
}

/** Apple 서버 알림(연결 끊기·Apple 계정 삭제·이메일 중계 켬/끔) — 끊기·삭제면 우리 쪽 연결도 지움 */
export async function appleNotify(payload: string) {
  const c = await verifyApple(payload);
  const ev = (typeof c.events === 'string' ? JSON.parse(c.events) : c.events) as { type?: string; sub?: string } | undefined;
  if (!ev?.sub || !ev.type) return { ok: true, type: null };
  if (ev.type === 'consent-revoked' || ev.type === 'account-delete') await db()`delete from user_identities where provider = 'apple' and subject = ${ev.sub}`;
  return { ok: true, type: ev.type };
}
