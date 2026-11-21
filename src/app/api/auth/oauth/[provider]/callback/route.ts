import { NextResponse, type NextRequest } from 'next/server';
import { createSession, currentUser, sessionCookie } from '@/lib/auth';
import { clientIp } from '@/lib/api';
import { HttpError } from '@/lib/errors';
import { STATE_COOKIE, createHandoff, isProvider, oauthCallback, stateAppChallenge } from '@/lib/oauth';
import { APP_SHEET_COOKIE } from '@/lib/hostSplit';
import { db } from '@/lib/db';
import { audit } from '@/lib/log';

/** 299차 Apple: 처음 한 번 오는 이름을 GET 으로 넘길 때 잠깐 담는 쿠키(주소에 개인정보를 싣지 않음) */
const NAME_COOKIE = 'wos_oauth_name';
/** 안드로이드 앱 패키지(mobile/android/app/build.gradle applicationId) */
const ANDROID_APP_ID = 'kr.co.dagym.workos';

/** V29 소셜 로그인 콜백 — 결과: 로그인(2단계 인증이면 코드 화면) · 계정 연결 · 처음이면 회사 만들기 · 오류는 로그인 화면에 안내 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  const go = (path: string) => { const r = NextResponse.redirect(new URL(path, req.nextUrl.origin), 303); r.cookies.set({ name: STATE_COOKIE, value: '', path: '/api/auth/oauth', maxAge: 0 });
    if (req.cookies.get(NAME_COOKIE)) r.cookies.set({ name: NAME_COOKIE, value: '', path: '/api/auth/oauth', maxAge: 0 }); return r; };
  if (!isProvider(provider)) return go('/login');
  const q = req.nextUrl.searchParams;
  // 앱(시스템 브라우저)에서 시작했으면 결과를 앱으로 넘기는 화면(/auth/app-return → workos://)으로 — 세션 쿠키는 브라우저가 아니라 앱이 받는다
  const ac = stateAppChallenge(req.cookies.get(STATE_COOKIE)?.value);
  // #1107(대표 안드로이드 실기기): 안드로이드는 서버가 바로 intent:// 로 넘김(크롬은 화면이 뜬 뒤 스크립트로 여는 외부 앱 이동을 막을 수 있음) — 앱을 못 열면 크롬이 app-return 화면(큰 단추)으로
  const android = /Android/i.test(req.headers.get('user-agent') ?? '');
  const toApp = (p: Record<string, string>) => {
    const q = new URLSearchParams(p);
    console.info('[oauth] 앱으로 넘김', provider, Object.keys(p)[0], android ? 'intent' : 'page');
    if (!android) return go(`/auth/app-return?${q}`);
    const fallback = new URL(`/auth/app-return?${q}`, req.nextUrl.origin).toString();
    const r = go('/auth/app-return');
    r.headers.set('location', `intent://open/auth/app?${q}#Intent;scheme=workos;package=${ANDROID_APP_ID};S.browser_fallback_url=${encodeURIComponent(fallback)};end`);
    return r;
  };
  // 애플 11/15 반려: 앱이 띄운 창인데 상태 쿠키를 못 읽은 경우(만료 등)에도 웹 로그인 화면을 그 창에 띄우지 않고 앱으로 돌려보냄
  //   (앱 화면 안(WebView — 표시 WorkInApp)에서 끝나는 옛 방식 로그인·계정 연결은 예전 그대로)
  const sheet = req.cookies.get(APP_SHEET_COOKIE)?.value === '1' && !/WorkInApp/i.test(req.headers.get('user-agent') ?? '');
  try {
    const me = await currentUser().catch(() => null);
    const nameC = req.cookies.get(NAME_COOKIE)?.value;
    const name = nameC ? (() => { try { return Buffer.from(nameC, 'base64url').toString('utf8').slice(0, 50) || null; } catch { return null; } })() : null;
    const r = await oauthCallback(provider, { code: q.get('code'), state: q.get('state'), error: q.get('error'), name }, req.cookies.get(STATE_COOKIE)?.value, me, clientIp(req));
    if (ac) {
      if (r.kind === 'error') return toApp({ error: r.message });
      if (r.kind === 'pending') return toApp({ pending: r.token });
      if (r.kind === 'login') return toApp({ t: await createHandoff(r.userId, r.mfa, r.client, ac) });
    }
    if (sheet && r.kind !== 'linked') return toApp({ error: r.kind === 'error' ? r.message : '로그인을 마치지 못했습니다. 앱에서 다시 시도해 주세요.' });
    if (r.kind === 'error') console.warn('[oauth] 실패', provider, r.code ?? 'error'); // 로컬 11/21 #1094: 운영 기록에 코드만(이메일이 든 문구는 남기지 않음)
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
    else {
      const host = (req.headers.get('host') ?? '').toLowerCase();
      console.warn('[oauth] 실패', provider, e.status, e.code, `host=${host}`, e.message.slice(0, 80)); // 이 단계 문구에는 이메일·비밀값이 없음(상태 만료 하위 이유·코드 없음·Apple 실패 이유 코드)
      if (e.code.startsWith('state_')) await audit(db(), null, 'auth.oauth_failed', null, null, { provider, reason: e.code, host }, clientIp(req)).catch(() => {}); // 로컬 11/21 #1101: '만료' 하위 이유
    }
    return ac || sheet ? toApp({ error: msg }) : go(`/login?oauth_error=${encodeURIComponent(msg)}`);
  }
}

/**
 * 299차 #858 Apple(response_mode=form_post): Apple 화면이 이 주소로 POST — 다른 사이트에서 온 POST 라 로그인 세션 쿠키가 안 실림(설정 › 연결 등).
 * 코드·상태는 같은 주소 GET 으로 넘기고(최상위 이동이라 쿠키가 실림), 처음 한 번 오는 이름은 5분짜리 쿠키로 넘김.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  if (provider !== 'apple') return NextResponse.redirect(new URL('/login', req.nextUrl.origin), 303);
  const f = await req.formData().catch(() => null);
  const pick = (k: string) => { const v = f?.get(k); return typeof v === 'string' && v.length <= 4096 ? v : null; };
  const q = new URLSearchParams();
  for (const k of ['code', 'state', 'error']) { const v = pick(k); if (v) q.set(k, v); }
  const res = NextResponse.redirect(new URL(`/api/auth/oauth/apple/callback?${q}`, req.nextUrl.origin), 303);
  const name = (await import('@/lib/oauthApple')).appleName(pick('user'));
  if (name) res.cookies.set({ name: NAME_COOKIE, value: Buffer.from(name, 'utf8').toString('base64url'), httpOnly: true, sameSite: 'lax', secure: req.nextUrl.protocol === 'https:', path: '/api/auth/oauth', maxAge: 300 });
  return res;
}
