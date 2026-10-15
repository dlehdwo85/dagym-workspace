import { NextResponse, type NextRequest } from 'next/server';
import { STATE_COOKIE, isProvider, startInput, startOAuth } from '@/lib/oauth';

/** V29 소셜 로그인 시작: 서명한 상태 쿠키(10분) + 제공자 로그인 화면으로 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  const back = (msg: string) => NextResponse.redirect(new URL(`/login?oauth_error=${encodeURIComponent(msg)}`, req.nextUrl.origin), 303);
  if (!isProvider(provider)) return back('지원하지 않는 로그인 방법입니다');
  try {
    const { url, cookie } = startOAuth(provider, startInput.parse(Object.fromEntries(req.nextUrl.searchParams)));
    const res = NextResponse.redirect(url, 303);
    res.cookies.set({ name: STATE_COOKIE, value: cookie, httpOnly: true, sameSite: 'lax', secure: req.nextUrl.protocol === 'https:', path: '/api/auth/oauth', maxAge: 600 });
    return res;
  } catch (e: any) { return back(e?.message ?? '로그인을 시작하지 못했습니다'); }
}
