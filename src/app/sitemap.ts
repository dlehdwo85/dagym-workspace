import type { MetadataRoute } from 'next';

/** 소개 사이트(대표 10/20): 공개 화면만 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.work-in.dev';
  return [{ url: `${base}/`, changeFrequency: 'weekly', priority: 1 }, { url: `${base}/signup`, priority: 0.8 }, { url: `${base}/privacy`, priority: 0.3 }, { url: `${base}/terms`, priority: 0.3 }, { url: `${base}/account-deletion`, priority: 0.2 }];
}
