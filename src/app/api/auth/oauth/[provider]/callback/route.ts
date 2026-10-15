import { NextResponse, type NextRequest } from 'next/server';
import { createSession, currentUser, sessionCookie } from '@/lib/auth';
import { clientIp } from '@/lib/api';
import { HttpError } from '@/lib/errors';
import { STATE_COOKIE, createHandoff, isProvider, oauthCallback, stateAppChallenge } from '@/lib/oauth';

/** V29 소셜 로그인 콜백 — 결과: 로그인(2단계 인증이면 코드 화면) · 계정 연결 · 처음이면 회사 만들기 · 오류는 로그인 화면에 안내 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  const go = (path: string) => { const r = NextResponse.redirect(new URL(path, req.nextUrl.origin), 303); r.cookies.set({ name: STATE_COOKIE, value: '', path: '/api/auth/oauth', maxAge: 0 }); return r; };
  if (!isProvider(provider)) return go('/login');
  const q = req.nextUrl.searchParams;
  // 앱(시스템 브라우저)에서 시작했으면 결과를 앱으로 넘기는 화면(/auth/app-return → workos://)으로 — 세션 쿠키는 브라우저가 아니라 앱이 받는다
  const ac = stateAppChallenge(req.cookies.get(STATE_COOKIE)?.value);
  const toApp = (p: Record<string, string>) => go(`/auth/app-return?${new URLSearchParams(p)}`);
  try {
    const me = await currentUser().catch(() => null);
    const r = await oauthCallback(provider, { code: q.get('code'), state: q.get('state'), error: q.get('error') }, req.cookies.get(STATE_COOKIE)?.value, me, clientIp(req));
    if (ac) {
      if (r.kind === 'error') return toApp({ error: r.message });
      if (r.kind === 'pending') return toApp({ pending: r.token });
      if (r.kind === 'login') return toApp({ t: await createHandoff(r.userId, r.mfa, r.client, ac) });
    }
    if (r.kind === 'error') return go(`/login?oauth_error=${encodeURIComponent(r.message)}${r.code ? `&code=${r.code}` : ''}`);
    if (r.kind === 'linked') return go(`/settings?linked=${provider}`);
    if (r.kind === 'pending') return go(`/signup/social?t=${encodeURIComponent(r.token)}`);
    const { token, maxAge } = await createSession(r.userId, r.client, req.headers.get('user-agent'), { ip: clientIp(req), mfaPending: r.mfa });
    const res = go(r.mfa ? '/login?mfa=1' : '/');
    res.cookies.set(sessionCookie(token, r.mfa ? 600 : maxAge));
    return res;
  } catch (e) {
    const msg = e instanceof HttpError ? e.message : '로그인 중 오류가 났습니다. 다시 시도해 주세요.';
    if (!(e instanceof HttpError)) console.error('[oauth]', provider, e);
    return ac ? toApp({ error: msg }) : go(`/login?oauth_error=${encodeURIComponent(msg)}`);
  }
}
