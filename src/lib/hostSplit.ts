/**
 * 198차 결정 15-29(#664·#683) 주소 분리 A안 — www.work-in.dev = 소개·요금·가입 안내, app.work-in.dev = 로그인 뒤 전부(설계 docs/research/WWW_APP_HOST_SPLIT_2026-10-25.md).
 * 같은 배포가 두 호스트를 받고 미들웨어가 호스트 이름으로 가른다. 스위치(APP_HOST_SPLIT=1)를 켜기 전에는 지금과 똑같이 동작한다.
 * 미들웨어(엣지)에서도 쓰므로 Node 전용 모듈을 들이지 않는다. 환경 변수는 이름만:
 * - APP_HOST_SPLIT=1 : 켜는 스위치 · APP_URL : CRM 주소(https://app.work-in.dev) · NEXT_PUBLIC_SITE_URL : 소개 사이트(https://www.work-in.dev)
 * - APP_HOST_SPLIT_APP_GRACE_UNTIL=YYYY-MM-DD : 그날까지(서울) 옛 앱(1.1.3 이하, www 를 엶)은 www 에서 그대로 쓰게 둠 — 새 앱이 퍼질 동안
 */
export type HostSplit = { on: boolean; site: string; app: string; graceUntil: string | null };

const hostOf = (u: string | undefined, d: string) => { try { return new URL(u || d).host.toLowerCase(); } catch { return new URL(d).host; } };
export function hostSplit(env: Record<string, string | undefined> = process.env): HostSplit {
  const site = hostOf(env.NEXT_PUBLIC_SITE_URL, 'https://www.work-in.dev');
  const app = hostOf(env.APP_URL, 'https://www.work-in.dev');
  const g = (env.APP_HOST_SPLIT_APP_GRACE_UNTIL ?? '').trim();
  return { on: env.APP_HOST_SPLIT === '1' && site !== app, site, app, graceUntil: /^\d{4}-\d{2}-\d{2}$/.test(g) ? g : null };
}

/** 소개 사이트(www)에 남는 화면 — 로그인 없이 보는 홍보·약관 화면 */
const SITE_PAGES = ['/welcome', '/landing', '/privacy', '/terms', '/account-deletion', '/data-deletion', '/ai-notice'];
export const isSitePage = (p: string) => p === '/' || SITE_PAGES.some((x) => p === x || p.startsWith(`${x}/`));
/** 두 호스트 모두 그대로 응답하는 것: API(외부 연동·콘솔 콜백·비콘·ICS) · 앱 링크 파일 · Next 정적 파일 · 확장자가 있는 정적 파일(아이콘·sw.js·manifest) */
export const isShared = (p: string) => p.startsWith('/api/') || p.startsWith('/_next/') || p.startsWith('/.well-known/') || /\/[^/]+\.[a-z0-9]{2,12}$/i.test(p) || p === '/apple-app-site-association';
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
/** 옛 앱(WebView) 유예: 그날까지는 www 에서 앱 화면을 그대로 */
export const appGrace = (cfg: HostSplit, isApp: boolean, day = today()) => isApp && !!cfg.graceUntil && day <= cfg.graceUntil;

export type HostDecision = { redirect: string; status: 307 | 308 } | { robots: true } | { rewrite: string } | { noindex: boolean; loginRedirect?: string } | null;
/**
 * 요청 하나의 갈림: null = 손대지 않음(스위치 꺼짐·다른 호스트·같은 화면). 주소는 경로·검색어를 그대로 옮긴다.
 * - www: 소개 화면·공용(API 등)만 그대로(첫 화면 / 는 로그인했어도 소개), 그 밖(로그인·업무·영업 …) → app. 308. 옛 앱은 유예 기간에 그대로, 지나면 / 도 app.
 * - app.: 소개 화면(/ 제외) → www 308 · robots.txt = 전부 막음 · 그 밖은 noindex, / 는 로그인 전이면 /login
 */
export function hostDecision(cfg: HostSplit, host: string, path: string, search: string, o: { isApp: boolean; signedIn: boolean; day?: string }): HostDecision {
  if (!cfg.on) return null;
  const h = host.toLowerCase().split(':')[0];
  if (h === cfg.site.split(':')[0]) {
    if (isShared(path) || path === '/robots.txt' || path === '/sitemap.xml') return null;
    if (appGrace(cfg, o.isApp, o.day)) return null; // 옛 앱은 www 에서 그대로(앱이 여는 / 는 로그인·홈)
    if (path === '/' && !o.isApp) return { rewrite: '/welcome' }; // www 첫 화면은 로그인과 상관없이 소개
    if (isSitePage(path) && path !== '/') return null;
    return { redirect: `https://${cfg.app}${path}${search}`, status: 308 };
  }
  if (h === cfg.app.split(':')[0]) {
    if (path === '/robots.txt') return { robots: true };
    if (isShared(path)) return null;
    if (path !== '/' && isSitePage(path)) return { redirect: `https://${cfg.site}${path}${search}`, status: 308 };
    if (path === '/' && !o.signedIn && !o.isApp) return { noindex: true, loginRedirect: '/login' };
    return { noindex: true };
  }
  return null;
}
