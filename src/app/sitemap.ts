import type { MetadataRoute } from 'next';
import { LANDING_PAGES, LANDING_UPDATED, SITE } from '@/lib/landingPages';

/** 소개 사이트(대표 10/20): 색인되는 공개 화면만 — #627: noindex 화면(가입·약관·개인정보·계정 삭제)은 빼고 키워드 소개 페이지 3개 + lastmod, 주소는 NEXT_PUBLIC_SITE_URL(기본 www) */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE}/`, lastModified: new Date(LANDING_UPDATED), changeFrequency: 'weekly', priority: 1 },
    ...LANDING_PAGES.map((p) => ({ url: `${SITE}/landing/${p.slug}`, lastModified: new Date(p.updated), changeFrequency: 'monthly' as const, priority: 0.9 })),
  ];
}
