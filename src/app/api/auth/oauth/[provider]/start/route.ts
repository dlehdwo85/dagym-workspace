import { NextResponse, type NextRequest } from 'next/server';
import { STATE_COOKIE, isProvider, startInput, startOAuth } from '@/lib/oauth';
import { APP_SHEET_COOKIE, APP_SHEET_MAX_AGE } from '@/lib/hostSplit';
import { appUrl } from '@/lib/mail';

/** V29 소셜 로그인 시작: 서명한 상태 쿠키(10분) + 제공자 로그인 화면으로 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  // 앱에서 시작한 로그인(시스템 브라우저 창)이면 그 창에 '앱에서 옴' 표시 — 시작이 실패해 로그인 화면으로 돌아가도 앱 모양으로
  const fromApp = ['ios', 'android'].includes(req.nextUrl.searchParams.get('client') ?? '');
  const mark = (r: NextResponse) => { if (fromApp) r.cookies.set({ name: APP_SHEET_COOKIE, value: '1', path: '/', sameSite: 'lax', secure: req.nextUrl.protocol === 'https:', httpOnly: false, maxAge: APP_SHEET_MAX_AGE }); return r; };
  const back = (msg: string) => mark(NextResponse.redirect(new URL(`/login?oauth_error=${encodeURIComponent(msg)}`, req.nextUrl.origin), 303));
  if (!isProvider(provider)) return back('지원하지 않는 로그인 방법입니다');
  // 콜백(redirect_uri)은 늘 APP_URL 로 돌아오는데 상태 쿠키는 시작한 호스트에만 생김 → 다른 주소(dagym-workspace.vercel.app·미리 보기·주소 분리 때 www 등)에서
  // 시작하면 첫 시도가 '로그인 요청이 만료'(로컬 11/21 #1101 확인) → 먼저 APP_URL 의 같은 시작 주소로 보낸 뒤 시작(198차 주소 분리 처리도 이것으로 함께)
  //   계정 연결(mode=link)은 로그인 세션이 그 주소에만 있으므로 APP_URL 의 설정 화면으로(거기서 로그인한 상태로 [연결하기]를 다시 누르게)
  const canon = (() => { try { return new URL(appUrl()); } catch { return null; } })();
  const host = (req.headers.get('host') ?? '').toLowerCase();
  if (canon && host && host !== canon.host.toLowerCase()) {
    if (req.nextUrl.searchParams.get('mode') === 'link') return NextResponse.redirect(`${canon.origin}/settings?relink=${provider}`, 303);
    return NextResponse.redirect(`${canon.origin}${req.nextUrl.pathname}${req.nextUrl.search}`, 307);
  }
  try {
    const { url, cookie } = startOAuth(provider, startInput.parse(Object.fromEntries(req.nextUrl.searchParams)));
    const res = NextResponse.redirect(url, 303);
    res.cookies.set({ name: STATE_COOKIE, value: cookie, httpOnly: true, sameSite: 'lax', secure: req.nextUrl.protocol === 'https:', path: '/api/auth/oauth', maxAge: 600 });
    return mark(res);
  } catch (e: any) { return back(e?.message ?? '로그인을 시작하지 못했습니다'); }
}
