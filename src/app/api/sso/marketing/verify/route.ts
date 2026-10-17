import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { verifyMarketingToken } from '@/lib/sso';
import { HttpError } from '@/lib/errors';

/** V41 4-1: 마케팅 운영실 서버 → 워크인 토큰 확인(서버끼리, 헤더 x-sso-secret = MARKETING_SSO_SECRET). 로그인 쿠키 없음 */
export async function POST(req: NextRequest) {
  const s = process.env.MARKETING_SSO_SECRET || '';
  const h = Buffer.from(req.headers.get('x-sso-secret') ?? '');
  if (s.length < 32 || h.length !== Buffer.byteLength(s) || !timingSafeEqual(h, Buffer.from(s))) return NextResponse.json({ error: { code: 'forbidden', message: '확인 권한이 없습니다' } }, { status: 403 });
  try {
    const { token } = await req.json().catch(() => ({ token: '' }));
    return NextResponse.json(await verifyMarketingToken(token));
  } catch (e: any) {
    const st = e instanceof HttpError ? e.status : 500;
    return NextResponse.json({ error: { code: e.code ?? 'error', message: e.message } }, { status: st });
  }
}
