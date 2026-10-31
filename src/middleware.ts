import { NextResponse, type NextRequest } from 'next/server';
import { hostDecision, hostSplit } from '@/lib/hostSplit';

/** 카카오톡·인스타그램·페이스북·네이버·라인·밴드 등 다른 앱 안 브라우저 — WebView 지만 우리 앱이 아님(광고·공유 링크로 온 사람은 소개 화면) */
const OTHER_IN_APP = /KAKAOTALK|Instagram|FBAN|FBAV|FBIOS|FB_IAB|NAVER\(inapp|Line\/|DaumApps|BAND\/|Twitter|everytimeApp|Snapchat/i;
/** 앱(Capacitor WebView)인지: 앱이 붙이는 표시(WorkinApp) 또는 안드로이드 WebView(; wv)·iOS WKWebView(Safari/ 없음) — 다른 앱 안 브라우저는 제외(#839 점검 중 발견) */
function isApp(ua: string) {
  if (/WorkinApp/i.test(ua)) return true;
  if (OTHER_IN_APP.test(ua)) return false;
  if (/; wv\)/.test(ua)) return true;
  return /(iPhone|iPad|iPod)/.test(ua) && /AppleWebKit/.test(ua) && !/Safari\//.test(ua);
}
/** #839 아이폰 앱(App Store 4.8·3.1.1 거절 10/28): 로그인만 — 가입·회사 만들기·소개(요금·무료 체험) 주소는 로그인으로. 표시 'WorkInApp' + 안드로이드 아님(아이패드는 맥 표시) */
const isIosApp = (ua: string) => /WorkinApp/i.test(ua) && !/Android/i.test(ua);
const IOS_APP_LOGIN_ONLY = /^\/(signup|welcome|landing)(\/|$)/;

/**
 * V15: 로그인 안 한 사람이 첫 주소(/)로 오면 소개(랜딩) 화면. 로그인한 사람은 홈, 앱은 지금처럼 로그인 화면
 * 198차 결정 15-29 주소 분리(APP_HOST_SPLIT=1 일 때만, src/lib/hostSplit.ts): www = 소개·약관만, 그 밖은 app. 으로 308 · app. 의 소개 화면은 www 로 · app. 은 검색 제외
 */
export function middleware(req: NextRequest) {
  // 도메인 방향(www ↔ apex)은 코드가 아니라 Vercel 도메인 설정에서만 정한다 — 10/20 20:40 양방향 308 루프 롤백(28ce95f)
  const ua = req.headers.get('user-agent') ?? '';
  const app = isApp(ua);
  if (isIosApp(ua) && IOS_APP_LOGIN_ONLY.test(req.nextUrl.pathname)) { const u = req.nextUrl.clone(); u.pathname = '/login'; u.search = ''; return NextResponse.redirect(u, 307); }
  const signedIn = !!req.cookies.get('wos_session')?.value || !!req.headers.get('authorization');
  const d = hostDecision(hostSplit(), req.headers.get('host') ?? req.nextUrl.host, req.nextUrl.pathname, req.nextUrl.search, { isApp: app, signedIn });
  if (d && 'redirect' in d) return NextResponse.redirect(d.redirect, d.status);
  if (d && 'robots' in d) return new NextResponse('User-agent: *\nDisallow: /\n', { headers: { 'content-type': 'text/plain; charset=utf-8', 'x-robots-tag': 'noindex, nofollow' } });
  if (d && 'rewrite' in d) return NextResponse.rewrite(new URL(d.rewrite, req.url));
  let res: NextResponse;
  if (d && 'loginRedirect' in d && d.loginRedirect) { const u = req.nextUrl.clone(); u.pathname = d.loginRedirect; u.search = ''; res = NextResponse.redirect(u, 307); }
  else if (req.nextUrl.pathname === '/' && !signedIn && !app) res = NextResponse.rewrite(new URL('/welcome', req.url));
  // V41 공간 주소: 앱 레이아웃이 화면을 그리기 전에 공간 권한을 보고 404(상태 코드까지)로 막을 수 있게 주소를 넘김
  else if (req.nextUrl.pathname.startsWith('/s/')) { const h = new Headers(req.headers); h.set('x-wos-path', req.nextUrl.pathname); res = NextResponse.next({ request: { headers: h } }); }
  else res = NextResponse.next();
  if (d && 'noindex' in d && d.noindex) res.headers.set('X-Robots-Tag', 'noindex, nofollow'); // app. 은 검색 제외(로그인 뒤 화면)
  return res;
}
// 198차: 주소 분리 갈림이 모든 화면 주소에 필요해 넓힘(API·Next 정적 파일 제외 — 두 호스트 모두 그대로 응답)
export const config = { matcher: ['/((?!api/|_next/static|_next/image).*)'] };
