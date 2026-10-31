import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT, type JWTPayload } from 'jose';
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

/** 인가 코드 → 토큰 → id_token 확인 → 프로필(이메일·고유 번호) + 해지용 토큰(암호화) */
export async function appleProfile(code: string, redirectUri: string) {
  const e = appleEnv();
  if (!e) throw new Error('Apple 로그인이 설정되지 않았습니다');
  const form = new URLSearchParams({ grant_type: 'authorization_code', client_id: e.servicesId, client_secret: await clientSecret(e), code, redirect_uri: redirectUri });
  const r = await fetch(e.token, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form, signal: AbortSignal.timeout(10_000) });
  const j = await r.json().catch(() => ({})) as { id_token?: string; refresh_token?: string };
  if (!r.ok || !j.id_token) return null;
  const c = await verifyApple(j.id_token).catch(() => null);
  if (!c?.sub) return null;
  const email = typeof c.email === 'string' ? c.email : null;
  return { subject: String(c.sub), email, emailVerified: c.email_verified === true || c.email_verified === 'true', name: null as string | null,
    secret: j.refresh_token ? encrypt(j.refresh_token) : null };
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
