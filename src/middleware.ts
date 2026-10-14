import { NextResponse, type NextRequest } from 'next/server';

/** 앱(Capacitor WebView)인지: 앱이 붙이는 표시(WorkinApp) 또는 안드로이드 WebView(; wv)·iOS WKWebView(Safari/ 없음) */
function isApp(ua: string) {
  if (/WorkinApp/i.test(ua) || /; wv\)/.test(ua)) return true;
  return /(iPhone|iPad|iPod)/.test(ua) && /AppleWebKit/.test(ua) && !/Safari\//.test(ua);
}

/** V15: 로그인 안 한 사람이 첫 주소(/)로 오면 소개(랜딩) 화면. 로그인한 사람은 홈, 앱은 지금처럼 로그인 화면 */
export function middleware(req: NextRequest) {
  if (req.nextUrl.pathname === '/' && !req.cookies.get('wos_session')?.value && !req.headers.get('authorization') && !isApp(req.headers.get('user-agent') ?? '')) {
    return NextResponse.rewrite(new URL('/welcome', req.url));
  }
  return NextResponse.next();
}
export const config = { matcher: ['/'] };
