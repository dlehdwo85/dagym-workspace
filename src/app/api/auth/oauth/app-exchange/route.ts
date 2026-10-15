import { NextResponse, type NextRequest } from 'next/server';
import { createSession, sessionCookie } from '@/lib/auth';
import { clientIp } from '@/lib/api';
import { HttpError } from '@/lib/errors';
import { exchangeHandoff, exchangeInput } from '@/lib/oauth';

/** 앱 소셜 로그인 복귀: 1회용 표 + 앱이 보관한 검증값 → 이 WebView 에 세션 쿠키 */
export async function POST(req: NextRequest) {
  try {
    const i = exchangeInput.parse(await req.json());
    const r = await exchangeHandoff(i);
    const { token, maxAge } = await createSession(r.userId, r.client, req.headers.get('user-agent'), { ip: clientIp(req), mfaPending: r.mfa });
    const res = NextResponse.json({ ok: true, mfa: r.mfa });
    res.cookies.set(sessionCookie(token, r.mfa ? 600 : maxAge));
    return res;
  } catch (e) {
    const msg = e instanceof HttpError ? e.message : '로그인 정보를 확인하지 못했습니다. 다시 시도해 주세요.';
    return NextResponse.json({ error: { code: 'bad_request', message: msg } }, { status: 400 });
  }
}
