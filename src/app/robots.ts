import type { MetadataRoute } from 'next';
import { SITE } from '@/lib/landingPages';

/**
 * #627(SEO_AUDIT_2026-10-25 2-1): 예전 public/robots.txt 는 'Disallow: /' 에 홈만 '$' 예외라 CSS·JS(/_next/static)·로고까지 막고,
 * '$' 를 못 읽는 검색엔진은 홈도 막았다 → 공개 화면은 전부 열고 로그인이 필요한 앱 화면만 막는다. 주소는 NEXT_PUBLIC_SITE_URL(기본 www).
 */
const APP_PATHS = ['/api/', '/s/', '/admin/', '/approvals', '/assistant', '/automations', '/calendar', '/contacts', '/contracts', '/forms', '/help', '/insights', '/library', '/messages',
  '/notices', '/notifications', '/plan', '/platform', '/projects', '/quotes', '/reports', '/revenue', '/settings', '/share', '/tasks', '/teams', '/templates', '/workload',
  '/d/', '/r/', '/sign/', '/invite', '/verify', '/reset', '/setup', '/status', '/auth/'];

export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: '*', allow: '/', disallow: APP_PATHS }], sitemap: `${SITE}/sitemap.xml`, host: SITE };
}
