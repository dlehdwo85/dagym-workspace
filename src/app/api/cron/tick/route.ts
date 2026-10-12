import { NextResponse, type NextRequest } from 'next/server';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { timingSafeEqual } from 'node:crypto';
import { runTick } from '@/lib/jobs';
import { logError } from '@/lib/log';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const GITHUB_JWKS = createRemoteJWKSet(new URL('https://token.actions.githubusercontent.com/.well-known/jwks'));
const TICK_AUDIENCE = 'company-work-os-tick';

async function authorized(req: NextRequest): Promise<string | null> {
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

async function handle(req: NextRequest) {
  const who = await authorized(req);
  if (!who) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const reason = req.nextUrl.searchParams.get('reason') ?? who;
    return NextResponse.json(await runTick(reason));
  } catch (e) {
    await logError('tick', e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export const POST = handle;
export const GET = handle; // Vercel Cron 은 GET 으로 호출
