import { NextResponse, type NextRequest } from 'next/server';

/** V15: 로그인 안 한 사람이 첫 주소(/)로 오면 소개(랜딩) 화면 — 공개 가입이 열렸을 때만 */
export function middleware(req: NextRequest) {
  if (process.env.PUBLIC_SIGNUP === '1' && req.nextUrl.pathname === '/' && !req.cookies.get('wos_session')?.value && !req.headers.get('authorization')) {
    return NextResponse.rewrite(new URL('/welcome', req.url));
  }
  return NextResponse.next();
}
export const config = { matcher: ['/'] };
