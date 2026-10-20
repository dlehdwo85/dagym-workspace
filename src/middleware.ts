import { NextResponse, type NextRequest } from 'next/server';

/** 앱(Capacitor WebView)인지: 앱이 붙이는 표시(WorkinApp) 또는 안드로이드 WebView(; wv)·iOS WKWebView(Safari/ 없음) */
function isApp(ua: string) {
  if (/WorkinApp/i.test(ua) || /; wv\)/.test(ua)) return true;
  return /(iPhone|iPad|iPod)/.test(ua) && /AppleWebKit/.test(ua) && !/Safari\//.test(ua);
}

/** V15: 로그인 안 한 사람이 첫 주소(/)로 오면 소개(랜딩) 화면. 로그인한 사람은 홈, 앱은 지금처럼 로그인 화면 */
export function middleware(req: NextRequest) {
  // 소개 사이트(대표 10/20 16:45): www.work-in.dev → work-in.dev (주소 하나로)
  const host = req.headers.get('host') ?? '';
  if (/^www\.work-in\.dev$/i.test(host)) { const u = new URL(req.url); u.host = 'work-in.dev'; u.protocol = 'https:'; return NextResponse.redirect(u, 308); }
  if (req.nextUrl.pathname === '/' && !req.cookies.get('wos_session')?.value && !req.headers.get('authorization') && !isApp(req.headers.get('user-agent') ?? '')) {
    return NextResponse.rewrite(new URL('/welcome', req.url));
  }
  // V41 공간 주소: 앱 레이아웃이 화면을 그리기 전에 공간 권한을 보고 404(상태 코드까지)로 막을 수 있게 주소를 넘김
  if (req.nextUrl.pathname.startsWith('/s/')) {
    const h = new Headers(req.headers); h.set('x-wos-path', req.nextUrl.pathname);
    return NextResponse.next({ request: { headers: h } });
  }
  return NextResponse.next();
}
export const config = { matcher: ['/', '/s/:path*', '/welcome', '/login', '/signup'] };
