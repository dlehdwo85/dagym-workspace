import { createRemoteJWKSet, jwtVerify } from 'jose';
import { timingSafeEqual } from 'node:crypto';

const GITHUB_JWKS = createRemoteJWKSet(new URL('https://token.actions.githubusercontent.com/.well-known/jwks'));
const TICK_AUDIENCE = 'company-work-os-tick';

/** 정기 실행·App Store 심사 상태(#1177) 호출 인증: CRON_SECRET 또는 이 저장소 GitHub Actions 의 OIDC 토큰(audience company-work-os-tick) */
export async function cronAuthorized(req: Request): Promise<string | null> {
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;
  const secret = process.env.CRON_SECRET;
  if (secret && token.length === secret.length && timingSafeEqual(Buffer.from(token), Buffer.from(secret))) return 'secret';
  try {
    const { payload } = await jwtVerify(token, GITHUB_JWKS, { issuer: 'https://token.actions.githubusercontent.com', audience: TICK_AUDIENCE });
    if (payload.repository === (process.env.SCHEDULER_REPO ?? 'dlehdwo85/dagym-workspace')) return 'github-oidc';
  } catch { /* 무효 토큰 */ }
  return null;
}
